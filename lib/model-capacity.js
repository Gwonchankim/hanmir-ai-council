'use strict';

const { spawn } = require('child_process');
const { resolveClaudeBin } = require('../adapters/claude');
const { resolveCodexBin } = require('../adapters/codex');
const { sanitizeChildEnv, terminateProcessTree } = require('./process-runner');

const DEFAULT_REFRESH_MS = 5 * 60 * 1000;
const DEFAULT_MAX_BACKOFF_MS = 30 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 15 * 1000;
const MAX_OUTPUT_BYTES = 96 * 1024;

function safeError(error) {
  return String(error?.message || error || 'Usage telemetry is unavailable.')
    .replace(/[\r\n\0]/g, ' ')
    .replace(/(?:session|thread|token|credit)[^,;]{0,120}/gi, 'private detail')
    .trim()
    .slice(0, 180) || 'Usage telemetry is unavailable.';
}

function parseResetAt(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const source = value.trim().replace(/\s*\([^)]*\)\s*$/, '');
  const named = source.match(/^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/i);
  if (named) {
    const month = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
      .indexOf(named[1].toLowerCase());
    if (month >= 0) {
      const now = new Date();
      let hour = Number(named[3]) % 12;
      if (named[5].toLowerCase() === 'pm') hour += 12;
      const date = new Date(now.getFullYear(), month, Number(named[2]), hour, Number(named[4] || 0), 0, 0);
      if (date.getTime() < now.getTime() - 24 * 60 * 60 * 1000) date.setFullYear(date.getFullYear() + 1);
      return date.toISOString();
    }
  }
  const parsed = Date.parse(source);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function parseClaudeUsage(text) {
  const rows = [];
  const patterns = [
    { pattern: /^Current session:\s*(\d{1,3})% used\s*[·•]\s*resets\s*(.+)$/im, label: () => '현재 세션' },
    { pattern: /^Current week \(all models\):\s*(\d{1,3})% used\s*[·•]\s*resets\s*(.+)$/im, label: () => '주간 전체' },
    { pattern: /^Current week \((?!all models\))([^)]+)\):\s*(\d{1,3})% used\s*[·•]\s*resets\s*(.+)$/gim, label: (match) => `주간 ${match[1]}`, offset: 1 },
  ];
  for (const { pattern, label, offset = 0 } of patterns) {
    const matches = pattern.global ? String(text || '').matchAll(pattern) : [String(text || '').match(pattern)];
    for (const match of matches) {
      if (!match) continue;
      const usedPercent = Math.max(0, Math.min(100, Number(match[1 + offset])));
      const resetText = String(match[2 + offset] || '').trim().slice(0, 100);
      rows.push({
        id: `claude-${label(match)}`,
        label: label(match),
        usedPercent,
        remainingPercent: 100 - usedPercent,
        resetsAt: parseResetAt(resetText),
        resetLabel: resetText,
      });
    }
  }
  if (!rows.length) throw new Error('Claude usage output format was not recognized.');
  return rows;
}

function normalizeCodexRateLimits(payload) {
  const snapshots = (payload?.rateLimitsByLimitId && typeof payload.rateLimitsByLimitId === 'object'
    ? Object.values(payload.rateLimitsByLimitId)
    : [payload?.rateLimits])
    .filter(Boolean)
    .sort((left, right) => Number(right?.limitId === 'codex') - Number(left?.limitId === 'codex'));
  const windows = [];
  for (const snapshot of snapshots) {
    const label = String(snapshot.limitName || snapshot.limitId || 'Codex');
    for (const [kind, value] of [['primary', snapshot.primary], ['secondary', snapshot.secondary]]) {
      if (!value || !Number.isFinite(Number(value.usedPercent))) continue;
      const usedPercent = Math.max(0, Math.min(100, Number(value.usedPercent)));
      const resetsAt = Number.isFinite(Number(value.resetsAt))
        ? new Date(Number(value.resetsAt) * 1000).toISOString() : null;
      windows.push({
        id: `codex-${snapshot.limitId || label}-${kind}`,
        label: snapshots.length > 1 ? label : (kind === 'primary' ? '기본 한도' : '보조 한도'),
        usedPercent,
        remainingPercent: 100 - usedPercent,
        resetsAt,
        resetLabel: null,
        durationMins: Number.isFinite(Number(value.windowDurationMins)) ? Number(value.windowDurationMins) : null,
      });
    }
  }
  if (!windows.length) throw new Error('Codex rate-limit response did not contain a usage window.');
  const credits = Number(payload?.rateLimitResetCredits?.availableCount);
  return {
    state: windows.some((window) => window.remainingPercent <= 0) ? 'limited' : 'available',
    windows,
    resetCreditCount: Number.isSafeInteger(credits) && credits > 0 ? credits : 0,
  };
}

function runCommand({ command, args, cwd, env, timeoutMs = DEFAULT_TIMEOUT_MS, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    let child;
    let settled = false;
    let outputBytes = 0;
    let stdout = '';
    let stderr = '';
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    };
    const stop = (error) => {
      void Promise.resolve(terminateProcessTree(child)).finally(() => finish(error));
    };
    const timer = setTimeout(() => stop(new Error('Usage telemetry command timed out.')), timeoutMs);
    try {
      child = spawnImpl(command, args, {
        cwd,
        env: sanitizeChildEnv(env),
        windowsHide: true,
        shell: false,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      finish(error);
      return;
    }
    const receive = (target, chunk) => {
      const text = String(chunk || '');
      outputBytes += Buffer.byteLength(text, 'utf8');
      if (outputBytes > MAX_OUTPUT_BYTES) return stop(new Error('Usage telemetry output exceeded its safety limit.'));
      if (target === 'stdout') stdout += text;
      else stderr += text;
      return undefined;
    };
    child.on('error', (error) => finish(error));
    child.stdout?.on('data', (chunk) => receive('stdout', chunk));
    child.stderr?.on('data', (chunk) => receive('stderr', chunk));
    child.on('close', (code) => {
      if (code !== 0) return finish(new Error(stderr.trim() || `Usage telemetry command exited with ${code}.`));
      return finish(null, { stdout, stderr });
    });
  });
}

function readClaudeUsage({ cwd, env = process.env, command = resolveClaudeBin(env), runner = runCommand }) {
  return runner({
    command,
    args: ['-p', '--output-format', 'json', '--max-turns', '0', '--no-session-persistence', '--no-chrome', '/usage'],
    cwd,
    env,
  }).then(({ stdout }) => {
    const result = JSON.parse(stdout);
    if (result?.is_error) throw new Error(result?.result || 'Claude usage command failed.');
    return {
      source: 'claude-cli',
      state: 'available',
      windows: parseClaudeUsage(result?.result),
      resetCreditCount: 0,
    };
  });
}

function readCodexRateLimits({ cwd, env = process.env, command = resolveCodexBin(env), spawnImpl = spawn, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  return new Promise((resolve, reject) => {
    let child;
    let buffer = '';
    let outputBytes = 0;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child?.stdin?.end(); } catch (_) {}
      void Promise.resolve(terminateProcessTree(child));
      if (error) reject(error); else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Codex rate-limit request timed out.')), timeoutMs);
    const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
    try {
      child = spawnImpl(command, ['app-server', '--stdio'], {
        cwd,
        env: sanitizeChildEnv(env),
        windowsHide: true,
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      });
    } catch (error) {
      finish(error);
      return;
    }
    child.on('error', (error) => finish(error));
    child.stderr?.on('data', (chunk) => {
      outputBytes += Buffer.byteLength(String(chunk || ''), 'utf8');
      if (outputBytes > MAX_OUTPUT_BYTES) finish(new Error('Codex telemetry output exceeded its safety limit.'));
    });
    child.stdout?.on('data', (chunk) => {
      outputBytes += Buffer.byteLength(String(chunk || ''), 'utf8');
      if (outputBytes > MAX_OUTPUT_BYTES) return finish(new Error('Codex telemetry output exceeded its safety limit.'));
      buffer += String(chunk || '');
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch (_) { continue; }
        if (message.id === 1) {
          send({ id: 2, method: 'account/rateLimits/read', params: null });
        } else if (message.id === 2) {
          if (message.error) return finish(new Error(message.error.message || 'Codex rate-limit request failed.'));
          try { return finish(null, { source: 'codex-app-server', ...normalizeCodexRateLimits(message.result) }); }
          catch (error) { return finish(error); }
        }
      }
      return undefined;
    });
    child.on('close', (code) => {
      if (!settled) finish(new Error(`Codex rate-limit service closed before responding (${code}).`));
    });
    send({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'Hanmir AI Council telemetry', version: '0.3.0' }, capabilities: {} },
    });
  });
}

function emptyProvider(provider) {
  return { provider, state: 'unknown', source: null, windows: [], resetCreditCount: 0, updatedAt: null, nextRetryAt: null, message: '아직 사용량을 확인하지 않았습니다.' };
}

class ModelCapacityService {
  constructor({ cwd = process.cwd(), env = process.env, collectors, clock = () => Date.now(), refreshMs = DEFAULT_REFRESH_MS, maxBackoffMs = DEFAULT_MAX_BACKOFF_MS } = {}) {
    this.cwd = cwd;
    this.env = env;
    this.clock = clock;
    this.refreshMs = refreshMs;
    this.maxBackoffMs = maxBackoffMs;
    this.collectors = collectors || {
      claude: () => readClaudeUsage({ cwd: this.cwd, env: this.env }),
      codex: () => readCodexRateLimits({ cwd: this.cwd, env: this.env }),
    };
    this.providers = { claude: emptyProvider('claude'), codex: emptyProvider('codex') };
    this.failures = { claude: 0, codex: 0 };
    this.timer = null;
    this.inFlight = null;
  }

  snapshot() {
    return {
      visibility: 'local',
      refreshIntervalMs: this.refreshMs,
      providers: JSON.parse(JSON.stringify(this.providers)),
    };
  }

  _schedule(delay = this.refreshMs) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { void this.refresh(); }, delay);
    this.timer.unref?.();
  }

  async refresh({ force = false } = {}) {
    if (this.inFlight) return this.inFlight;
    const now = this.clock();
    if (!force && Object.values(this.providers).every((provider) => provider.nextRetryAt && Date.parse(provider.nextRetryAt) > now)) {
      return this.snapshot();
    }
    this.inFlight = Promise.all(Object.entries(this.collectors).map(async ([provider, collect]) => {
      const previous = this.providers[provider] || emptyProvider(provider);
      if (!force && previous.nextRetryAt && Date.parse(previous.nextRetryAt) > this.clock()) return;
      try {
        const result = await collect();
        this.failures[provider] = 0;
        this.providers[provider] = {
          provider,
          state: result.state || 'available',
          source: result.source || null,
          windows: Array.isArray(result.windows) ? result.windows : [],
          resetCreditCount: Number.isSafeInteger(Number(result.resetCreditCount)) ? Number(result.resetCreditCount) : 0,
          updatedAt: new Date(this.clock()).toISOString(),
          nextRetryAt: new Date(this.clock() + this.refreshMs).toISOString(),
          message: null,
        };
      } catch (error) {
        const failureCount = (this.failures[provider] || 0) + 1;
        this.failures[provider] = failureCount;
        const delay = Math.min(this.refreshMs * (2 ** failureCount), this.maxBackoffMs);
        this.providers[provider] = {
          ...previous,
          provider,
          state: previous.windows?.length ? 'stale' : 'unavailable',
          updatedAt: previous.updatedAt || null,
          nextRetryAt: new Date(this.clock() + delay).toISOString(),
          message: safeError(error),
        };
      }
    })).then(() => this.snapshot()).finally(() => {
      this.inFlight = null;
      const next = Math.min(...Object.values(this.providers).map((provider) => Math.max(1_000, Date.parse(provider.nextRetryAt || '') - this.clock())).filter(Number.isFinite), this.refreshMs);
      this._schedule(next);
    });
    return this.inFlight;
  }

  stop() { clearTimeout(this.timer); this.timer = null; }
}

module.exports = {
  DEFAULT_MAX_BACKOFF_MS,
  DEFAULT_REFRESH_MS,
  DEFAULT_TIMEOUT_MS,
  ModelCapacityService,
  normalizeCodexRateLimits,
  parseClaudeUsage,
  readClaudeUsage,
  readCodexRateLimits,
  runCommand,
};
