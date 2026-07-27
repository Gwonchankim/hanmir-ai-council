'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  ModelCapacityService,
  normalizeCodexRateLimits,
  parseClaudeUsage,
} = require('../lib/model-capacity');

test('Claude usage parser keeps only public limit windows', () => {
  const windows = parseClaudeUsage([
    'Current session: 48% used · resets Jul 27, 7pm (Asia/Seoul)',
    'Current week (all models): 56% used · resets Jul 30, 2am (Asia/Seoul)',
    'Current week (Fable): 26% used · resets Jul 30, 2am (Asia/Seoul)',
    'Last 24h · 871 requests · 14 sessions',
  ].join('\n'));

  assert.deepEqual(windows.map((item) => [item.label, item.remainingPercent]), [
    ['현재 세션', 52], ['주간 전체', 44], ['주간 Fable', 74],
  ]);
  assert.equal(windows.some((item) => /requests|sessions/.test(item.label)), false);
});

test('Codex rate-limit normalizer excludes reset-credit identifiers', () => {
  const normalized = normalizeCodexRateLimits({
    rateLimits: { limitId: 'codex', primary: { usedPercent: 35, resetsAt: 1_785_635_592, windowDurationMins: 10_080 } },
    rateLimitsByLimitId: {
      codex: { limitId: 'codex', primary: { usedPercent: 35, resetsAt: 1_785_635_592, windowDurationMins: 10_080 } },
      codex_special: { limitId: 'codex_special', limitName: 'Special model', primary: { usedPercent: 0, resetsAt: 1_785_745_691 } },
    },
    rateLimitResetCredits: { availableCount: 2, credits: [{ id: 'secret-credit-id', title: 'Full reset' }] },
  });

  assert.equal(normalized.state, 'available');
  assert.equal(normalized.resetCreditCount, 2);
  assert.deepEqual(normalized.windows.map((item) => item.remainingPercent), [65, 100]);
  assert.doesNotMatch(JSON.stringify(normalized), /secret-credit-id|Full reset/);
});

test('capacity service applies backoff without discarding the last verified windows', async () => {
  let now = Date.parse('2026-07-27T00:00:00.000Z');
  let shouldFail = false;
  const service = new ModelCapacityService({
    clock: () => now,
    refreshMs: 60_000,
    maxBackoffMs: 10 * 60_000,
    collectors: {
      claude: async () => {
        if (shouldFail) throw new Error('provider unavailable');
        return { source: 'test', state: 'available', windows: [{ id: 'claude-session', remainingPercent: 70 }], resetCreditCount: 0 };
      },
      codex: async () => ({ source: 'test', state: 'available', windows: [{ id: 'codex-primary', remainingPercent: 60 }], resetCreditCount: 0 }),
    },
  });
  try {
    await service.refresh({ force: true });
    shouldFail = true;
    now += 1_000;
    const snapshot = await service.refresh({ force: true });
    assert.equal(snapshot.providers.claude.state, 'stale');
    assert.equal(snapshot.providers.claude.windows[0].remainingPercent, 70);
    assert.equal(Date.parse(snapshot.providers.claude.nextRetryAt) - now, 120_000);
  } finally {
    service.stop();
  }
});
