'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  createJsonlParser,
  resolveExecutable,
  runProcess,
} = require('../lib/process-runner');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_RUNTIME_CWD = path.join(PROJECT_ROOT, 'runtime', 'agent-workspace');
const EMPTY_MCP_CONFIG = JSON.stringify({ mcpServers: {} });

function claudeNativeCandidates(env = process.env) {
  const home = env.USERPROFILE || os.homedir();
  const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return [
    path.join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe'),
    path.join(localAppData, 'Programs', 'Claude', 'claude.exe'),
    path.join(localAppData, 'AnthropicClaude', 'claude.exe'),
    process.platform !== 'win32' ? '/usr/local/bin/claude' : null,
    process.platform !== 'win32' ? '/usr/bin/claude' : null,
  ].filter(Boolean);
}

function resolveClaudeBin(env = process.env) {
  return resolveExecutable({
    envVar: 'CLAUDE_BIN',
    candidates: claudeNativeCandidates(env),
    names: process.platform === 'win32' ? ['claude.exe'] : ['claude'],
    env,
  });
}

function ensureRuntimeCwd(cwd) {
  const resolved = path.resolve(cwd || DEFAULT_RUNTIME_CWD);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function buildClaudeArgs({ model, effort, sessionId, jsonSchema, forkSession = false }) {
  const args = [
    '-p',
    '--input-format', 'text',
    '--output-format', 'stream-json',
    '--verbose',
    '--tools', '',
    '--disable-slash-commands',
    '--mcp-config', EMPTY_MCP_CONFIG,
    '--strict-mcp-config',
    '--permission-mode', 'dontAsk',
    '--no-chrome',
  ];

  if (model) args.push('--model', String(model));
  if (effort) args.push('--effort', String(effort));
  if (jsonSchema) {
    args.push('--json-schema', typeof jsonSchema === 'string' ? jsonSchema : JSON.stringify(jsonSchema));
  }
  if (sessionId) {
    if (forkSession) args.push('--fork-session');
    args.push('--resume', String(sessionId));
  }
  return args;
}

function printableError(value) {
  let text;
  if (typeof value === 'string') text = value;
  else {
    try { text = JSON.stringify(value); } catch (_) { text = String(value); }
  }
  return text.replace(/\0/g, '').trim().slice(0, 1200);
}

function stderrTail(value) {
  return String(value || '').replace(/\0/g, '').trim().slice(-1600);
}

function safeEventError(event) {
  const candidates = [
    event?.error?.message,
    typeof event?.error === 'string' ? event.error : '',
    event?.result?.message,
    typeof event?.result === 'string' ? event.result : '',
    typeof event?.message === 'string' ? event.message : '',
    event?.subtype,
  ];
  return printableError(candidates.find((value) => value) || 'Claude CLI stream error');
}

/**
 * Execute Claude in text-only mode. Thinking/redacted-thinking/tool blocks are
 * intentionally ignored and never forwarded to application callbacks.
 */
async function runClaude({
  prompt,
  model,
  effort,
  sessionId,
  onEvent,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  signal,
  cwd,
  env = process.env,
  jsonSchema,
  forkSession = false,
  allowForkRecovery = true,
  allowFreshRecovery = true,
  runner = runProcess,
}) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new TypeError('Claude prompt는 비어 있지 않은 문자열이어야 합니다.');
  }

  const command = resolveClaudeBin(env);
  const args = buildClaudeArgs({ model, effort, sessionId, jsonSchema, forkSession });
  const runtimeCwd = ensureRuntimeCwd(cwd);
  let text = '';
  let structuredText = '';
  let currentSessionId = sessionId || null;
  let sawResult = false;
  let streamError = '';
  let malformedError = '';

  const emitText = (chunk) => {
    if (!chunk) return;
    text += chunk;
    if (onEvent) onEvent('text', chunk);
  };

  const parser = createJsonlParser({
    onValue(event) {
      if (!event || typeof event !== 'object') return;

      if (event.type === 'system' && event.subtype === 'init' && event.session_id) {
        currentSessionId = String(event.session_id);
        return;
      }

      if (event.type === 'assistant' && event.message && Array.isArray(event.message.content)) {
        for (const block of event.message.content) {
          // Only public final text crosses the adapter boundary. In particular,
          // thinking, redacted_thinking and tool blocks are discarded here.
          if (block && block.type === 'text' && typeof block.text === 'string') {
            emitText(block.text);
          }
        }
        return;
      }

      if (event.type === 'result') {
        sawResult = true;
        if (event.session_id) currentSessionId = String(event.session_id);
        if (event.is_error === true || ['error', 'failed'].includes(event.subtype)) {
          streamError = safeEventError(event);
          return;
        }
        if (!text && typeof event.result === 'string') emitText(event.result);
        if (event.structured_output !== undefined) {
          structuredText = JSON.stringify(event.structured_output);
        }
        return;
      }

      if (event.type === 'error') {
        streamError = safeEventError(event);
      }
    },
    onMalformed({ lineNumber }) {
      if (!malformedError) malformedError = `Claude JSONL ${lineNumber}번째 줄이 올바른 JSON이 아닙니다.`;
    },
  });

  const result = await runner({
    command,
    args,
    cwd: runtimeCwd,
    input: prompt,
    env,
    timeoutMs,
    maxOutputBytes,
    signal,
    captureStdout: false,
    captureStderr: true,
    onStdout: (chunk) => parser.push(chunk),
  });
  parser.end();

  if (result.code !== 0) {
    const detail = streamError || stderrTail(result.stderr);
    if (
      allowForkRecovery
      && sessionId
      && !forkSession
      && detail === 'error_during_execution'
      && !signal?.aborted
    ) {
      try {
        const recovered = await runClaude({
          prompt,
          model,
          effort,
          sessionId,
          onEvent,
          timeoutMs,
          maxOutputBytes,
          signal,
          cwd: runtimeCwd,
          env,
          jsonSchema,
          forkSession: true,
          allowForkRecovery: false,
          allowFreshRecovery: false,
          runner,
        });
        recovered.execution = {
          ...recovered.execution,
          forked: true,
          recovery: 'fork_session',
        };
        return recovered;
      } catch (forkError) {
        if (
          allowFreshRecovery
          && /error_during_execution/.test(String(forkError?.message || forkError))
          && !signal?.aborted
        ) {
          const recovered = await runClaude({
            prompt,
            model,
            effort,
            sessionId: null,
            onEvent,
            timeoutMs,
            maxOutputBytes,
            signal,
            cwd: runtimeCwd,
            env,
            jsonSchema,
            forkSession: false,
            allowForkRecovery: false,
            allowFreshRecovery: false,
            runner,
          });
          recovered.execution = {
            ...recovered.execution,
            freshRecovery: true,
            recovery: 'fresh_session_after_fork_failure',
          };
          return recovered;
        }
        throw forkError;
      }
    }
    throw new Error(`Claude CLI가 종료 코드 ${result.code}로 실패했습니다${detail ? `: ${detail}` : ''}`);
  }
  if (malformedError) throw new Error(malformedError);
  if (streamError) throw new Error(`Claude CLI 오류: ${streamError}`);
  if (!sawResult) throw new Error('Claude CLI가 완료 result 이벤트 없이 종료되었습니다.');
  const finalText = structuredText || text;
  if (!finalText.trim()) throw new Error('Claude CLI가 공개 응답 텍스트를 반환하지 않았습니다.');

  return {
    text: finalText.trim(),
    sessionId: currentSessionId,
    execution: {
      provider: 'claude', executable: command, exitCode: result.code,
      completionEvent: 'result', resumed: Boolean(sessionId), model: model || null, effort: effort || null,
      forked: Boolean(forkSession),
      freshRecovery: false,
      recovery: forkSession ? 'fork_session' : null,
    },
  };
}

const exported = {
  DEFAULT_RUNTIME_CWD,
  EMPTY_MCP_CONFIG,
  buildClaudeArgs,
  claudeNativeCandidates,
  ensureRuntimeCwd,
  resolveClaudeBin,
  safeEventError,
  runClaude,
};
Object.defineProperty(exported, 'CLAUDE_BIN', { enumerable: true, get: () => resolveClaudeBin() });
module.exports = exported;
