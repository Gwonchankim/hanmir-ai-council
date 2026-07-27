'use strict';

const fs = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const SAFE_CHILD_ENV_KEYS = Object.freeze([
  'PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'COMSPEC',
  'USERPROFILE', 'HOME', 'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA',
  'PROGRAMDATA', 'TEMP', 'TMP', 'TMPDIR', 'USERNAME', 'LOGNAME',
  'LANG', 'LANGUAGE', 'LC_ALL', 'TERM', 'COLORTERM', 'NO_COLOR', 'TZ',
  'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME',
  'CODEX_HOME', 'CLAUDE_CONFIG_DIR', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS',
]);

class ProcessRunnerError extends Error {
  constructor(message, code, details) {
    super(message);
    this.name = 'ProcessRunnerError';
    this.code = code;
    if (details) Object.assign(this, details);
  }
}

function isUsableFile(candidate) {
  if (!candidate || typeof candidate !== 'string') return false;
  try {
    return fs.statSync(candidate).isFile();
  } catch (_) {
    return false;
  }
}

/**
 * The model CLIs authenticate from their own local config directories. Passing
 * the server's complete environment would unnecessarily expose unrelated PATs,
 * API keys and connector secrets to a prompt-influenced child process.
 */
function sanitizeChildEnv(source = process.env) {
  const clean = {};
  for (const key of SAFE_CHILD_ENV_KEYS) {
    const value = source[key];
    if (typeof value === 'string' && value.length) clean[key] = value;
  }
  return clean;
}

/**
 * Resolve a native executable without invoking a shell. An explicit environment
 * override always wins; named PATH lookup is used only after native candidates.
 */
function resolveExecutable({ envVar, candidates = [], names = [], env = process.env }) {
  const override = String(env[envVar] || '').trim();
  if (override) return override;

  for (const candidate of candidates) {
    if (isUsableFile(candidate)) return path.resolve(candidate);
  }

  const pathEntries = String(env.PATH || '')
    .split(path.delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);

  for (const entry of pathEntries) {
    for (const name of names) {
      const candidate = path.join(entry, name);
      if (isUsableFile(candidate)) return path.resolve(candidate);
    }
  }

  throw new ProcessRunnerError(
    `${envVar}가 설정되지 않았고 네이티브 CLI 실행 파일을 찾지 못했습니다.`,
    'ENOEXECUTABLE',
    { envVar, candidates: candidates.filter(Boolean), names }
  );
}

function createJsonlParser({ onValue, onMalformed }) {
  let buffer = '';
  let lineNumber = 0;

  function parseLine(rawLine) {
    lineNumber += 1;
    const line = rawLine.replace(/\r$/, '').trim();
    if (!line) return;
    try {
      onValue(JSON.parse(line), lineNumber);
    } catch (error) {
      if (onMalformed) onMalformed({ line, lineNumber, error });
    }
  }

  return {
    push(chunk) {
      buffer += String(chunk);
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        parseLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    },
    end() {
      if (buffer.length) parseLine(buffer);
      buffer = '';
    },
  };
}

function terminateProcessTree(child, { platform = process.platform, execFileImpl = execFile } = {}) {
  if (!child || !child.pid) return Promise.resolve();

  if (platform === 'win32') {
    return new Promise((resolve) => {
      execFileImpl(
        'taskkill.exe',
        ['/pid', String(child.pid), '/T', '/F'],
        { windowsHide: true },
        () => {
          try { child.kill('SIGKILL'); } catch (_) {}
          resolve();
        }
      );
    });
  }

  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch (_) {
    try { child.kill('SIGKILL'); } catch (_) {}
  }
  return Promise.resolve();
}

/**
 * Spawn a non-interactive CLI, write the prompt to stdin, bound all output,
 * and tear down the complete process tree on timeout/cancellation.
 */
function runProcess({
  command,
  args = [],
  cwd,
  input = '',
  env = process.env,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  signal,
  onStdout,
  onStderr,
  captureStdout = true,
  captureStderr = true,
  spawnImpl = spawn,
  terminateImpl = terminateProcessTree,
}) {
  if (!command || typeof command !== 'string') {
    return Promise.reject(new ProcessRunnerError('실행할 CLI 경로가 없습니다.', 'EINVAL'));
  }
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return Promise.reject(new ProcessRunnerError('timeoutMs는 양수여야 합니다.', 'EINVAL'));
  }
  if (!Number.isFinite(maxOutputBytes) || maxOutputBytes <= 0) {
    return Promise.reject(new ProcessRunnerError('maxOutputBytes는 양수여야 합니다.', 'EINVAL'));
  }
  if (signal && signal.aborted) {
    return Promise.reject(new ProcessRunnerError('CLI 실행이 취소되었습니다.', 'ABORT_ERR'));
  }

  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let terminating = false;
    let totalOutputBytes = 0;
    let stdout = '';
    let stderr = '';
    let stdinError = null;

    const cleanup = () => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', abortHandler);
    };

    const finishReject = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const terminateAndReject = async (error) => {
      if (settled || terminating) return;
      terminating = true;
      try { await terminateImpl(child); } catch (_) {}
      finishReject(error);
    };

    const abortHandler = () => {
      void terminateAndReject(new ProcessRunnerError('CLI 실행이 취소되었습니다.', 'ABORT_ERR'));
    };

    const timer = setTimeout(() => {
      void terminateAndReject(new ProcessRunnerError(
        `CLI 실행 시간이 ${timeoutMs}ms를 초과했습니다.`,
        'ETIMEDOUT',
        { timeoutMs }
      ));
    }, timeoutMs);

    try {
      child = spawnImpl(command, args, {
        cwd,
        env: sanitizeChildEnv(env),
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      finishReject(new ProcessRunnerError(
        `CLI 프로세스를 시작하지 못했습니다: ${error.message}`,
        'ESPAWN',
        { cause: error }
      ));
      return;
    }

    if (signal) signal.addEventListener('abort', abortHandler, { once: true });

    const consume = (streamName, chunk) => {
      if (settled || terminating) return;
      const stringChunk = String(chunk);
      totalOutputBytes += Buffer.byteLength(stringChunk, 'utf8');
      if (totalOutputBytes > maxOutputBytes) {
        void terminateAndReject(new ProcessRunnerError(
          `CLI 출력이 제한(${maxOutputBytes} bytes)을 초과했습니다.`,
          'EMAXOUTPUT',
          { maxOutputBytes }
        ));
        return;
      }
      if (streamName === 'stdout') {
        if (captureStdout) stdout += stringChunk;
        if (onStdout) {
          try {
            onStdout(stringChunk);
          } catch (error) {
            void terminateAndReject(new ProcessRunnerError(
              `CLI stdout 처리에 실패했습니다: ${error.message}`,
              'EOUTPUTPARSE',
              { cause: error }
            ));
          }
        }
      } else {
        if (captureStderr) stderr += stringChunk;
        if (onStderr) {
          try {
            onStderr(stringChunk);
          } catch (error) {
            void terminateAndReject(new ProcessRunnerError(
              `CLI stderr 처리에 실패했습니다: ${error.message}`,
              'EOUTPUTPARSE',
              { cause: error }
            ));
          }
        }
      }
    };

    child.on('error', (error) => {
      finishReject(new ProcessRunnerError(
        `CLI 실행에 실패했습니다: ${error.message}`,
        'ESPAWN',
        { cause: error }
      ));
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => consume('stdout', chunk));
    child.stderr.on('data', (chunk) => consume('stderr', chunk));

    child.stdin.on('error', (error) => { stdinError = error; });
    child.stdin.end(input, 'utf8');

    child.on('close', (code, closeSignal) => {
      if (settled || terminating) return;
      settled = true;
      cleanup();
      if (stdinError && code !== 0) {
        reject(new ProcessRunnerError(
          `CLI stdin 전달에 실패했습니다: ${stdinError.message}`,
          'ESTDIN',
          { code, signal: closeSignal, stderr }
        ));
        return;
      }
      resolve({ code, signal: closeSignal, stdout, stderr, outputBytes: totalOutputBytes });
    });
  });
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  DEFAULT_MAX_OUTPUT_BYTES,
  ProcessRunnerError,
  SAFE_CHILD_ENV_KEYS,
  createJsonlParser,
  resolveExecutable,
  runProcess,
  sanitizeChildEnv,
  terminateProcessTree,
};
