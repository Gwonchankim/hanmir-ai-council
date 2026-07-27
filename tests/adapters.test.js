'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  buildClaudeArgs,
  resolveClaudeBin,
  safeEventError,
  runClaude,
} = require('../adapters/claude');
const {
  buildCodexArgs,
  resolveCodexBin,
  runCodex,
} = require('../adapters/codex');
const {
  createJsonlParser,
  runProcess,
  sanitizeChildEnv,
} = require('../lib/process-runner');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-council-adapter-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function fakeRunner(chunks, result = { code: 0, signal: null, stderr: '' }, capture) {
  return async (options) => {
    if (capture) Object.assign(capture, options);
    for (const chunk of chunks) options.onStdout(chunk);
    return result;
  };
}

test('native executable environment overrides win before candidate lookup', () => {
  assert.equal(resolveClaudeBin({ CLAUDE_BIN: 'X:\\native\\claude.exe' }), 'X:\\native\\claude.exe');
  assert.equal(resolveCodexBin({ CODEX_BIN: 'X:\\native\\codex.exe' }), 'X:\\native\\codex.exe');
});

test('child CLI environment keeps runtime paths but strips unrelated secrets', async () => {
  const source = {
    ...process.env,
    CODEX_HOME: 'X:\\codex-home',
    SECRET_CANARY: 'must-not-cross-boundary',
    OPENAI_API_KEY: 'must-not-cross-boundary',
    ANTHROPIC_API_KEY: 'must-not-cross-boundary',
    GH_TOKEN: 'must-not-cross-boundary',
  };
  const clean = sanitizeChildEnv(source);
  assert.equal(clean.CODEX_HOME, 'X:\\codex-home');
  assert.equal(clean.SECRET_CANARY, undefined);
  assert.equal(clean.OPENAI_API_KEY, undefined);
  assert.equal(clean.ANTHROPIC_API_KEY, undefined);
  assert.equal(clean.GH_TOKEN, undefined);

  const result = await runProcess({
    command: process.execPath,
    args: ['-e', 'process.stdout.write(JSON.stringify(process.env))'],
    env: source,
    timeoutMs: 5000,
  });
  const childEnv = JSON.parse(result.stdout);
  assert.equal(childEnv.CODEX_HOME, 'X:\\codex-home');
  assert.equal(childEnv.SECRET_CANARY, undefined);
  assert.equal(childEnv.OPENAI_API_KEY, undefined);
  assert.equal(childEnv.ANTHROPIC_API_KEY, undefined);
  assert.equal(childEnv.GH_TOKEN, undefined);
});

test('Claude argv disables tools, slash commands and MCP while preserving model/effort/resume', () => {
  const args = buildClaudeArgs({ model: 'opus', effort: 'xhigh', sessionId: 'session-1' });
  assert.deepEqual(args.slice(0, 5), ['-p', '--input-format', 'text', '--output-format', 'stream-json']);
  assert.equal(args[args.indexOf('--tools') + 1], '');
  assert.ok(args.includes('--disable-slash-commands'));
  assert.ok(args.includes('--strict-mcp-config'));
  assert.equal(args[args.indexOf('--permission-mode') + 1], 'dontAsk');
  assert.equal(args[args.indexOf('--model') + 1], 'opus');
  assert.equal(args[args.indexOf('--effort') + 1], 'xhigh');
  assert.equal(args[args.indexOf('--resume') + 1], 'session-1');
});

test('Codex argv wires model/effort and isolation on new and resumed turns', () => {
  const fresh = buildCodexArgs({ model: 'gpt-test', effort: 'high' });
  assert.equal(fresh[0], 'exec');
  assert.equal(fresh[fresh.indexOf('-m') + 1], 'gpt-test');
  assert.ok(fresh.includes('model_reasoning_effort="high"'));
  assert.ok(fresh.includes('sandbox_mode="read-only"'));
  assert.ok(fresh.includes('--ignore-user-config'));
  assert.ok(fresh.includes('--ignore-rules'));
  assert.equal(fresh[fresh.indexOf('-s') + 1], 'read-only');
  assert.equal(fresh.at(-1), '-');

  const resumed = buildCodexArgs({ model: 'gpt-next', effort: 'medium', threadId: 'thread-1' });
  assert.deepEqual(resumed.slice(0, 2), ['exec', 'resume']);
  assert.equal(resumed[resumed.indexOf('-m') + 1], 'gpt-next');
  assert.ok(resumed.includes('sandbox_mode="read-only"'));
  assert.ok(!resumed.includes('-s'));
  assert.deepEqual(resumed.slice(-2), ['thread-1', '-']);
});

test('JSONL parser handles CRLF, split chunks and a final record without newline', () => {
  const values = [];
  const malformed = [];
  const parser = createJsonlParser({
    onValue: (value) => values.push(value),
    onMalformed: (value) => malformed.push(value),
  });
  parser.push('{"a":1}\r\n{"b"');
  parser.push(':2}\n{"c":3}');
  parser.end();
  assert.deepEqual(values, [{ a: 1 }, { b: 2 }, { c: 3 }]);
  assert.deepEqual(malformed, []);
});

test('Claude passes prompt via stdin, resumes the role session and discards private thinking', async (t) => {
  const cwd = tempDir(t);
  const capture = {};
  const events = [];
  const chunks = [
    '{"type":"system","subtype":"init","session_id":"claude-session"}\r\n',
    '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"SECRET_REASONING_CANARY"},',
    '{"type":"redacted_thinking","data":"SECRET_REASONING_CANARY"},{"type":"text","text":"공개 답변"}]}}\n',
    '{"type":"result","subtype":"success","is_error":false,"session_id":"claude-session","result":"공개 답변"}',
  ];

  const result = await runClaude({
    prompt: '한글\n지시 $() `test`',
    model: 'sonnet',
    effort: 'high',
    sessionId: 'prior-session',
    cwd,
    env: { CLAUDE_BIN: 'fake-claude' },
    onEvent: (kind, content) => events.push({ kind, content }),
    runner: fakeRunner(chunks, undefined, capture),
  });

  assert.equal(capture.input, '한글\n지시 $() `test`');
  assert.ok(!capture.args.includes(capture.input));
  assert.equal(capture.captureStdout, false);
  assert.equal(result.text, '공개 답변');
  assert.equal(result.sessionId, 'claude-session');
  assert.deepEqual(result.execution, {
    provider: 'claude', executable: 'fake-claude', exitCode: 0,
    completionEvent: 'result', resumed: true, model: 'sonnet', effort: 'high',
    forked: false, freshRecovery: false, recovery: null,
  });
  assert.deepEqual(events, [{ kind: 'text', content: '공개 답변' }]);
  assert.doesNotMatch(JSON.stringify({ result, events }), /SECRET_REASONING_CANARY/);
});

test('Claude strictly rejects nonzero exit, malformed JSONL and error result', async (t) => {
  const cwd = tempDir(t);
  const base = { prompt: 'test', cwd, env: { CLAUDE_BIN: 'fake-claude' } };

  await assert.rejects(
    runClaude({
      ...base,
      runner: fakeRunner([
        '{"type":"assistant","message":{"content":[{"type":"text","text":"partial"}]}}\n',
        '{"type":"result","subtype":"success","is_error":false}\n',
      ], { code: 7, signal: null, stderr: 'failed' }),
    }),
    /종료 코드 7/
  );

  await assert.rejects(
    runClaude({
      ...base,
      runner: fakeRunner(['not-json\n{"type":"result","subtype":"success","result":"ok"}\n']),
    }),
    /올바른 JSON/
  );

  await assert.rejects(
    runClaude({
      ...base,
      runner: fakeRunner(['{"type":"result","subtype":"error","is_error":true,"result":"denied"}\n']),
    }),
    /Claude CLI 오류/
  );
});

test('Claude 공개 오류는 세션 ID와 사용량 원문을 노출하지 않는다', () => {
  const message = safeEventError({
    type: 'result', subtype: 'error',
    error: { message: 'session limit reached' },
    session_id: 'secret-session-id', modelUsage: { input: 1234 },
  });
  assert.equal(message, 'session limit reached');
  assert.doesNotMatch(message, /secret-session-id|modelUsage|1234/);
});

test('Claude resumed session execution failure forks once and preserves context continuity', async (t) => {
  const calls = [];
  const result = await runClaude({
    prompt: 'recover this turn',
    model: 'haiku',
    effort: 'low',
    sessionId: 'damaged-session',
    cwd: tempDir(t),
    env: { CLAUDE_BIN: 'fake-claude' },
    runner: async (options) => {
      calls.push([...options.args]);
      if (calls.length === 1) {
        options.onStdout('{"type":"result","subtype":"error","is_error":true,"result":"error_during_execution"}\n');
        return { code: 1, signal: null, stderr: '' };
      }
      options.onStdout('{"type":"system","subtype":"init","session_id":"forked-session"}\n');
      options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"forked-session","result":"recovered"}\n');
      return { code: 0, signal: null, stderr: '' };
    },
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].includes('--fork-session'), false);
  assert.equal(calls[1].includes('--fork-session'), true);
  assert.equal(result.text, 'recovered');
  assert.equal(result.sessionId, 'forked-session');
  assert.equal(result.execution.forked, true);
  assert.equal(result.execution.recovery, 'fork_session');
});

test('Claude starts one fresh self-contained turn only when resume and fork both fail identically', async (t) => {
  const calls = [];
  const result = await runClaude({
    prompt: 'the complete active task and Harness',
    model: 'haiku',
    effort: 'low',
    sessionId: 'unreadable-session',
    cwd: tempDir(t),
    env: { CLAUDE_BIN: 'fake-claude' },
    runner: async (options) => {
      calls.push([...options.args]);
      if (calls.length < 3) {
        options.onStdout('{"type":"result","subtype":"error","is_error":true,"result":"error_during_execution"}\n');
        return { code: 1, signal: null, stderr: '' };
      }
      options.onStdout('{"type":"system","subtype":"init","session_id":"fresh-recovery-session"}\n');
      options.onStdout('{"type":"result","subtype":"success","is_error":false,"session_id":"fresh-recovery-session","result":"recovered fresh"}\n');
      return { code: 0, signal: null, stderr: '' };
    },
  });

  assert.equal(calls.length, 3);
  assert.equal(calls[0].includes('--resume'), true);
  assert.equal(calls[1].includes('--fork-session'), true);
  assert.equal(calls[2].includes('--resume'), false);
  assert.equal(result.text, 'recovered fresh');
  assert.equal(result.sessionId, 'fresh-recovery-session');
  assert.equal(result.execution.resumed, false);
  assert.equal(result.execution.freshRecovery, true);
  assert.equal(result.execution.recovery, 'fresh_session_after_fork_failure');
});

test('Codex passes prompt via stdin, resumes thread and discards reasoning items', async (t) => {
  const cwd = tempDir(t);
  const capture = {};
  const events = [];
  const chunks = [
    '{"type":"thread.started","thread_id":"thread-new"}\n',
    '{"type":"item.completed","item":{"type":"reasoning","text":"SECRET_REASONING_CANARY"}}\n',
    '{"type":"item.completed","item":{"type":"agent_message","text":"최종 기획안"}}\r\n',
    '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}',
  ];

  const result = await runCodex({
    prompt: '한글\n지시 & | < >',
    model: 'gpt-test',
    effort: 'medium',
    threadId: 'thread-old',
    cwd,
    env: { CODEX_BIN: 'fake-codex' },
    onEvent: (kind, content) => events.push({ kind, content }),
    runner: fakeRunner(chunks, undefined, capture),
  });

  assert.equal(capture.input, '한글\n지시 & | < >');
  assert.ok(!capture.args.includes(capture.input));
  assert.equal(capture.captureStdout, false);
  assert.equal(capture.args[capture.args.indexOf('-m') + 1], 'gpt-test');
  assert.equal(result.text, '최종 기획안');
  assert.equal(result.threadId, 'thread-new');
  assert.deepEqual(result.execution, {
    provider: 'codex', executable: 'fake-codex', exitCode: 0,
    completionEvent: 'turn.completed', resumed: true, model: 'gpt-test', effort: 'medium',
  });
  assert.deepEqual(events, [{ kind: 'text', content: '최종 기획안' }]);
  assert.doesNotMatch(JSON.stringify({ result, events }), /SECRET_REASONING_CANARY/);
});

test('Codex strictly rejects turn.failed, nonzero exit and malformed final JSONL', async (t) => {
  const cwd = tempDir(t);
  const base = { prompt: 'test', cwd, env: { CODEX_BIN: 'fake-codex' } };

  await assert.rejects(
    runCodex({
      ...base,
      runner: fakeRunner([
        '{"type":"item.completed","item":{"type":"agent_message","text":"partial"}}\n',
        '{"type":"turn.failed","error":{"message":"model failed"}}\n',
        '{"type":"turn.completed"}\n',
      ]),
    }),
    /Codex CLI 오류.*model failed/
  );

  await assert.rejects(
    runCodex({
      ...base,
      runner: fakeRunner([
        '{"type":"item.completed","item":{"type":"agent_message","text":"partial"}}\n',
        '{"type":"turn.completed"}\n',
      ], { code: 9, signal: null, stderr: 'failed' }),
    }),
    /종료 코드 9/
  );

  await assert.rejects(
    runCodex({
      ...base,
      runner: fakeRunner([
        '{"type":"item.completed","item":{"type":"agent_message","text":"partial"}}\n',
        '{bad-json}',
      ]),
    }),
    /올바른 JSON/
  );
});

test('process runner enforces maximum combined output', async () => {
  await assert.rejects(
    runProcess({
      command: process.execPath,
      args: ['-e', 'process.stdout.write("x".repeat(4096));'],
      maxOutputBytes: 128,
      timeoutMs: 5000,
    }),
    (error) => error && error.code === 'EMAXOUTPUT'
  );
});

test('process runner cancellation kills the descendant process tree', async (t) => {
  const dir = tempDir(t);
  const marker = path.join(dir, 'orphan-marker.txt');
  const childScript = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'orphan'), 700);`;
  const parentScript = [
    "const { spawn } = require('child_process');",
    `spawn(process.execPath, ['-e', ${JSON.stringify(childScript)}], { stdio: 'ignore' });`,
    "setInterval(() => {}, 1000);",
  ].join('');
  const controller = new AbortController();
  const pending = runProcess({
    command: process.execPath,
    args: ['-e', parentScript],
    timeoutMs: 5000,
    signal: controller.signal,
  });
  setTimeout(() => controller.abort(), 100);

  await assert.rejects(pending, (error) => error && error.code === 'ABORT_ERR');
  await new Promise((resolve) => setTimeout(resolve, 900));
  assert.equal(fs.existsSync(marker), false, 'descendant survived cancellation');
});

test('process runner timeout rejects with ETIMEDOUT', async () => {
  await assert.rejects(
    runProcess({
      command: process.execPath,
      args: ['-e', 'setInterval(() => {}, 1000);'],
      timeoutMs: 100,
    }),
    (error) => error && error.code === 'ETIMEDOUT'
  );
});

test('Claude structured schema is wired into argv', () => {
  const schema = { type: 'object', properties: { ok: { type: 'boolean' } } };
  const args = buildClaudeArgs({ model: 'haiku', effort: 'low', jsonSchema: schema });
  const index = args.indexOf('--json-schema');
  assert.ok(index >= 0);
  assert.deepEqual(JSON.parse(args[index + 1]), schema);
});

test('Claude schema 호출은 일반 assistant 텍스트보다 structured_output을 우선한다', async (t) => {
  const result = await runClaude({
    prompt: 'structured', model: 'haiku', effort: 'low', cwd: tempDir(t),
    env: { ...process.env, CLAUDE_BIN: process.execPath },
    jsonSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
    runner: fakeRunner([
      '{"type":"system","subtype":"init","session_id":"session-structured"}\n',
      '{"type":"assistant","message":{"content":[{"type":"text","text":"일반 안내문"}]}}\n',
      '{"type":"result","subtype":"success","session_id":"session-structured","structured_output":{"ok":true}}\n',
    ]),
  });
  assert.equal(result.text, '{"ok":true}');
});

test('Codex object schema is materialized for the process and removed afterward', async (t) => {
  const cwd = tempDir(t);
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['ok'], properties: { ok: { type: 'boolean' } },
  };
  let schemaPath;
  let schemaDuringRun;
  const result = await runCodex({
    prompt: 'structured output', model: 'gpt-5.4', effort: 'low', schema, cwd,
    env: { ...process.env, CODEX_BIN: process.execPath },
    runner: async (options) => {
      const flag = options.args.indexOf('--output-schema');
      assert.ok(flag >= 0);
      schemaPath = options.args[flag + 1];
      assert.equal(fs.existsSync(schemaPath), true);
      schemaDuringRun = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      options.onStdout('{"type":"thread.started","thread_id":"thread-schema"}\n');
      options.onStdout('{"type":"item.completed","item":{"type":"agent_message","text":"{\\"ok\\":true}"}}\n');
      options.onStdout('{"type":"turn.completed"}\n');
      return { code: 0, signal: null, stderr: '' };
    },
  });
  assert.deepEqual(schemaDuringRun, schema);
  assert.equal(result.text, '{"ok":true}');
  assert.equal(fs.existsSync(schemaPath), false);
});

test('Codex provider schema recursively requires every declared property without mutating the local schema', async (t) => {
  const cwd = tempDir(t);
  const schema = {
    type: 'object', additionalProperties: false,
    required: ['role'],
    properties: {
      role: { type: 'string' },
      optionalNote: { type: 'string' },
      nested: {
        type: 'object',
        properties: { requiredValue: { type: 'boolean' }, optionalValue: { type: 'string' } },
        required: ['requiredValue'],
      },
    },
  };
  let schemaDuringRun;
  await runCodex({
    prompt: 'strict structured output', model: 'gpt-5.4', effort: 'low', schema, cwd,
    env: { ...process.env, CODEX_BIN: process.execPath },
    runner: async (options) => {
      const schemaPath = options.args[options.args.indexOf('--output-schema') + 1];
      schemaDuringRun = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
      options.onStdout('{"type":"thread.started","thread_id":"thread-strict-schema"}\n');
      options.onStdout('{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}\n');
      options.onStdout('{"type":"turn.completed"}\n');
      return { code: 0, signal: null, stderr: '' };
    },
  });

  assert.deepEqual(schema.required, ['role']);
  assert.deepEqual(schemaDuringRun.required, ['role', 'optionalNote', 'nested']);
  assert.equal(schemaDuringRun.additionalProperties, false);
  assert.deepEqual(schemaDuringRun.properties.nested.required, ['requiredValue', 'optionalValue']);
  assert.equal(schemaDuringRun.properties.nested.additionalProperties, false);
});

test('Codex transient reconnect error 뒤 turn.completed가 오면 성공으로 처리한다', async (t) => {
  const result = await runCodex({
    prompt: 'resume after reconnect', model: 'gpt-5.4', effort: 'low', cwd: tempDir(t),
    env: { ...process.env, CODEX_BIN: process.execPath },
    runner: fakeRunner([
      '{"type":"thread.started","thread_id":"thread-reconnect"}\n',
      '{"type":"error","message":"Reconnecting... 2/5"}\n',
      '{"type":"item.completed","item":{"type":"agent_message","text":"recovered"}}\n',
      '{"type":"turn.completed"}\n',
    ]),
  });
  assert.equal(result.text, 'recovered');
  assert.equal(result.threadId, 'thread-reconnect');
});
