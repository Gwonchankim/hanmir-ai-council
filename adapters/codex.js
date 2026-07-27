'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_TIMEOUT_MS,
  createJsonlParser,
  resolveExecutable,
  runProcess,
} = require('../lib/process-runner');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const DEFAULT_RUNTIME_CWD = path.join(PROJECT_ROOT, 'runtime', 'agent-workspace');

function codexNativeCandidates(env = process.env) {
  const home = env.USERPROFILE || os.homedir();
  const appData = env.APPDATA || path.join(home, 'AppData', 'Roaming');
  const localAppData = env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  return [
    path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    path.join(localAppData, 'OpenAI', 'Codex', 'bin', 'codex.exe'),
    path.join(
      appData, 'npm', 'node_modules', '@openai', 'codex', 'node_modules',
      '@openai', 'codex-win32-x64', 'vendor', 'x86_64-pc-windows-msvc', 'bin', 'codex.exe'
    ),
    process.platform !== 'win32' ? '/usr/local/bin/codex' : null,
    process.platform !== 'win32' ? '/usr/bin/codex' : null,
  ].filter(Boolean);
}

function resolveCodexBin(env = process.env) {
  return resolveExecutable({
    envVar: 'CODEX_BIN',
    candidates: codexNativeCandidates(env),
    names: process.platform === 'win32' ? ['codex.exe'] : ['codex'],
    env,
  });
}

function ensureRuntimeCwd(cwd) {
  const resolved = path.resolve(cwd || DEFAULT_RUNTIME_CWD);
  fs.mkdirSync(resolved, { recursive: true });
  return resolved;
}

function toCodexStrictSchema(schema) {
  if (!schema || typeof schema !== 'object') return schema;
  const cloned = JSON.parse(JSON.stringify(schema));
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object' && node.properties && typeof node.properties === 'object') {
      node.additionalProperties = false;
      // Codex response_format uses OpenAI strict structured outputs: every
      // declared property must appear in required. Locally optional fields
      // remain optional in Ajv; the provider-facing copy only asks the model
      // to emit a valid value (for example, an empty customInstructions string).
      node.required = Object.keys(node.properties);
      Object.values(node.properties).forEach(visit);
    }
    if (node.items) visit(node.items);
    for (const keyword of ['anyOf', 'oneOf', 'allOf']) {
      if (Array.isArray(node[keyword])) node[keyword].forEach(visit);
    }
  };
  visit(cloned);
  return cloned;
}

function tomlString(value) {
  return JSON.stringify(String(value));
}

function defaultCodexModel() {
  try {
    const config = require('../config');
    return config.options.codex.defaultModel;
  } catch (_) {
    return null;
  }
}

function buildCodexArgs({ model, effort, threadId, outputSchemaPath }) {
  const effectiveModel = model || defaultCodexModel();
  const common = [
    '--json',
    '--skip-git-repo-check',
    '--ignore-user-config',
    '--ignore-rules',
  ];

  if (effectiveModel) common.push('-m', String(effectiveModel));
  if (effort) common.push('-c', `model_reasoning_effort=${tomlString(effort)}`);
  // exec resume has no -s flag, so this override is deliberately applied to
  // both new and resumed turns. New turns additionally receive -s read-only.
  common.push('-c', 'sandbox_mode="read-only"');
  if (outputSchemaPath) common.push('--output-schema', path.resolve(outputSchemaPath));

  if (threadId) {
    return ['exec', 'resume', ...common, String(threadId), '-'];
  }
  return ['exec', ...common, '--color', 'never', '-s', 'read-only', '-'];
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

function agentMessageText(item) {
  if (!item || item.type !== 'agent_message') return '';
  if (typeof item.text === 'string') return item.text;
  if (!Array.isArray(item.content)) return '';
  return item.content
    .filter((block) => block && ['text', 'output_text'].includes(block.type) && typeof block.text === 'string')
    .map((block) => block.text)
    .join('');
}

/**
 * Execute Codex in a read-only, config-isolated workspace. Reasoning items are
 * intentionally ignored and raw stdout is not retained by the process runner.
 */
async function runCodex({
  prompt,
  model,
  effort,
  threadId,
  cwd,
  onEvent,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  signal,
  env = process.env,
  outputSchemaPath,
  schema,
  runner = runProcess,
}) {
  if (typeof prompt !== 'string' || !prompt.trim()) {
    throw new TypeError('Codex prompt는 비어 있지 않은 문자열이어야 합니다.');
  }

  const runtimeCwd = ensureRuntimeCwd(cwd);
  const command = resolveCodexBin(env);
  let generatedSchemaPath = null;
  if (!outputSchemaPath && schema) {
    generatedSchemaPath = path.join(runtimeCwd, `.output-schema-${crypto.randomUUID()}.json`);
    fs.writeFileSync(generatedSchemaPath, JSON.stringify(toCodexStrictSchema(schema)), 'utf8');
  }
  const effectiveSchemaPath = outputSchemaPath || generatedSchemaPath;
  const args = buildCodexArgs({ model, effort, threadId, outputSchemaPath: effectiveSchemaPath });
  let text = '';
  let currentThreadId = threadId || null;
  let sawTurnCompleted = false;
  let fatalStreamError = '';
  let transientStreamError = '';
  let malformedError = '';
  let usage = null;

  const emitText = (chunk) => {
    if (!chunk) return;
    text += chunk;
    if (onEvent) onEvent('text', chunk);
  };

  const parser = createJsonlParser({
    onValue(event) {
      if (!event || typeof event !== 'object') return;

      if (event.type === 'thread.started' && event.thread_id) {
        currentThreadId = String(event.thread_id);
        return;
      }

      if (event.type === 'item.completed' && event.item) {
        const publicText = agentMessageText(event.item);
        if (publicText) emitText(publicText);
        // reasoning and all non-agent-message item types are discarded.
        return;
      }

      if (event.type === 'turn.completed') {
        sawTurnCompleted = true;
        if (event.usage && typeof event.usage === 'object') usage = event.usage;
        return;
      }

      if (event.type === 'turn.failed') {
        fatalStreamError = printableError(event.error || event.message || event);
        return;
      }

      if (event.type === 'error') {
        // Codex는 WebSocket 재연결 중에도 error 이벤트를 보낼 수 있다.
        // 이후 turn.completed가 오면 복구된 실행으로 간주한다.
        transientStreamError = printableError(event.error || event.message || event);
      }
    },
    onMalformed({ lineNumber }) {
      if (!malformedError) malformedError = `Codex JSONL ${lineNumber}번째 줄이 올바른 JSON이 아닙니다.`;
    },
  });

  let result;
  try {
    result = await runner({
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
  } finally {
    if (generatedSchemaPath) {
      try { fs.rmSync(generatedSchemaPath, { force: true }); } catch (_) {}
    }
  }
  parser.end();

  if (result.code !== 0) {
    const detail = fatalStreamError || transientStreamError || stderrTail(result.stderr);
    throw new Error(`Codex CLI가 종료 코드 ${result.code}로 실패했습니다${detail ? `: ${detail}` : ''}`);
  }
  if (malformedError) throw new Error(malformedError);
  if (fatalStreamError) throw new Error(`Codex CLI 오류: ${fatalStreamError}`);
  if (!sawTurnCompleted) {
    const detail = transientStreamError ? `: ${transientStreamError}` : '';
    throw new Error(`Codex CLI가 turn.completed 이벤트 없이 종료되었습니다${detail}`);
  }
  if (!text.trim()) throw new Error('Codex CLI가 공개 응답 텍스트를 반환하지 않았습니다.');

  return {
    text: text.trim(),
    threadId: currentThreadId,
    usage,
    execution: {
      provider: 'codex', executable: command, exitCode: result.code,
      completionEvent: 'turn.completed', resumed: Boolean(threadId),
      model: model || defaultCodexModel(), effort: effort || null,
    },
  };
}

const exported = {
  DEFAULT_RUNTIME_CWD,
  agentMessageText,
  buildCodexArgs,
  codexNativeCandidates,
  ensureRuntimeCwd,
  resolveCodexBin,
  runCodex,
  toCodexStrictSchema,
};
Object.defineProperty(exported, 'CODEX_BIN', { enumerable: true, get: () => resolveCodexBin() });
// Backward-compatible alias for code that imported the old constant name.
Object.defineProperty(exported, 'CODEX_JS', { enumerable: true, get: () => resolveCodexBin() });
module.exports = exported;
