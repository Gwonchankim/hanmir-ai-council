'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  HarnessRevisionStore,
  HarnessRevisionIntegrityError,
  HarnessRevisionValidationError,
  revisionFilename,
} = require('../lib/harness-revision-store');
const { defaultHarnessSet } = require('../harnesses');

function fixture(t, options = {}) {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-council-harness-revisions-'));
  t.after(() => fs.rmSync(rootDir, { recursive: true, force: true }));
  return {
    rootDir,
    store: new HarnessRevisionStore({
      rootDir,
      maxEntries: options.maxEntries || 20,
      clock: options.clock || (() => '2026-07-15T12:00:00.000Z'),
    }),
  };
}

function harness(cycle, overrides = {}) {
  const value = defaultHarnessSet(cycle);
  for (const [role, fields] of Object.entries(overrides)) {
    Object.assign(value[role], fields);
  }
  return value;
}

function save(store, sessionId, revision, harnesses, options = {}) {
  return store.saveRevision({
    sessionId,
    revision,
    harnesses,
    source: options.source || 'user',
    cycle: harnesses.cycle,
    updatedAt: options.updatedAt || `2026-07-15T12:00:${String(revision).padStart(2, '0')}.000Z`,
    changedRoles: options.changedRoles || ['orchestrator', 'claudeWorker', 'codexWorker'],
  });
}

test('stores immutable revision files per session with verified metadata and no temporary residue', (t) => {
  const { rootDir, store } = fixture(t);
  const first = save(store, 'session-A', 1, harness(1));
  const second = save(store, 'session-B', 1, harness(1, {
    claudeWorker: { mission: 'A session-specific Claude mission.' },
  }));

  assert.equal(first.created, true);
  assert.equal(second.created, true);
  assert.equal(first.record.available, true);
  assert.equal(first.record.integrity, 'verified');
  assert.match(first.record.digest, /^[a-f0-9]{64}$/);
  assert.equal(store.getRevision('session-A', 1).harnesses.claudeWorker.mission.includes('market'), true);
  assert.equal(store.getRevision('session-B', 1).harnesses.claudeWorker.mission, 'A session-specific Claude mission.');

  const repeated = store.saveRevision({
    sessionId: 'session-A',
    revision: 1,
    harnesses: harness(1),
    source: 'user',
    cycle: 1,
    changedRoles: ['orchestrator', 'claudeWorker', 'codexWorker'],
  });
  assert.equal(repeated.created, false, 'an identical retry is idempotent even when updatedAt is omitted');
  assert.throws(
    () => save(store, 'session-A', 1, harness(1, {
      orchestrator: { mission: 'Conflicting immutable content.' },
    })),
    (error) => error.code === 'HARNESS_REVISION_CONFLICT' && error.status === 409,
  );

  const files = fs.readdirSync(path.join(rootDir, 'session-A'));
  assert.deepEqual(files, [revisionFilename(1)]);
  assert.equal(files.some((name) => name.endsWith('.tmp')), false);
  assert.equal(Object.hasOwn(first.record, 'harnesses'), false, 'list/save metadata must not expose revision bodies');
});

test('validates record schema, storage session, filename revision, and digest before returning a body', (t) => {
  const cases = [
    ['schema', (record) => { record.schemaVersion = 99; }],
    ['session', (record) => { record.sessionId = 'different-session'; }],
    ['revision', (record) => { record.revision = 7; }],
    ['digest', (record) => { record.harnesses.orchestrator.mission = 'Tampered mission'; }],
  ];
  for (const [label, mutate] of cases) {
    const child = path.join(fixture(t).rootDir, label);
    const store = new HarnessRevisionStore({ rootDir: child });
    save(store, 'secure-session', 1, harness(1));
    const filePath = path.join(child, 'secure-session', revisionFilename(1));
    const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    mutate(record);
    fs.writeFileSync(filePath, JSON.stringify(record), 'utf8');

    assert.throws(
      () => store.getRevision('secure-session', 1),
      (error) => error instanceof HarnessRevisionIntegrityError
        && error.code === 'HARNESS_REVISION_TAMPERED',
      `${label} tampering must be rejected`,
    );
    const listed = store.listRevisions('secure-session');
    assert.deepEqual(listed, [{
      sessionId: 'secure-session',
      revision: 1,
      available: false,
      integrity: 'invalid',
      digest: null,
    }]);
  }
});

test('seeds the legacy current revision once and marks pruned or missing history as unavailable', (t) => {
  const { store } = fixture(t, { maxEntries: 2 });
  const seeded = store.seedLegacyCurrent({
    sessionId: 'legacy-session',
    revision: 4,
    harnesses: harness(4),
    cycle: 4,
    updatedAt: '2026-07-15T11:00:00.000Z',
  });
  const repeated = store.seedLegacyCurrent({
    sessionId: 'legacy-session',
    revision: 4,
    harnesses: harness(4),
    cycle: 4,
    updatedAt: '2026-07-15T11:00:00.000Z',
  });

  assert.equal(seeded.seeded, true);
  assert.equal(seeded.record.source, 'legacy-seed');
  assert.equal(repeated.seeded, false);

  save(store, 'legacy-session', 5, harness(5));
  const latest = save(store, 'legacy-session', 6, harness(6));
  assert.deepEqual(latest.pruned, [4]);
  const history = store.listRevisions('legacy-session', {
    history: [
      { revision: 3, source: 'legacy', cycle: 3, digest: 'metadata-only' },
      { revision: 4, source: 'legacy-seed', cycle: 4, digest: seeded.record.digest },
      { revision: 5, source: 'user', cycle: 5 },
      { revision: 6, source: 'user', cycle: 6 },
    ],
  });

  assert.deepEqual(history.map((item) => [item.revision, item.available, item.integrity]), [
    [6, true, 'verified'],
    [5, true, 'verified'],
    [4, false, 'missing'],
    [3, false, 'missing'],
  ]);
  assert.equal(history.some((entry) => Object.hasOwn(entry, 'harnesses')), false);
});

test('produces explicit role and all-role diffs without loading bodies into history metadata', (t) => {
  const { store } = fixture(t);
  save(store, 'diff-session', 1, harness(1));
  save(store, 'diff-session', 2, harness(2, {
    orchestrator: { mission: 'Coordinate a measurable launch decision.' },
    codexWorker: {
      qualityChecks: ['Every gate has a named owner.', 'Every claim has a validation source.'],
    },
  }), { changedRoles: ['orchestrator', 'codexWorker'] });

  const roleDiff = store.diffRevisions('diff-session', 1, 2, { role: 'orchestrator' });
  assert.deepEqual(roleDiff.changedRoles, ['orchestrator']);
  assert.equal(roleDiff.changes.length, 1);
  assert.deepEqual(roleDiff.changes[0], {
    path: '/mission',
    type: 'modified',
    before: 'Translate the user request into a decision-complete planning process and integrate both workers fairly.',
    after: 'Coordinate a measurable launch decision.',
  });

  const allDiff = store.diffRevisions('diff-session', 1, 2);
  assert.deepEqual(allDiff.changedRoles, ['orchestrator', 'codexWorker']);
  assert.equal(allDiff.changesByRole.claudeWorker.length, 0);
  assert.equal(allDiff.changesByRole.codexWorker[0].path, '/qualityChecks');
});

test('bounded pruning retains only the newest configured revision files', (t) => {
  const { rootDir, store } = fixture(t, { maxEntries: 3 });
  for (let revision = 0; revision < 8; revision += 1) {
    save(store, 'bounded-session', revision, harness(revision));
  }

  assert.deepEqual(store.listRevisions('bounded-session').map((item) => item.revision), [7, 6, 5]);
  assert.deepEqual(
    fs.readdirSync(path.join(rootDir, 'bounded-session')).sort(),
    [revisionFilename(5), revisionFilename(6), revisionFilename(7)],
  );
  assert.throws(
    () => store.getRevision('bounded-session', 4),
    (error) => error.code === 'HARNESS_REVISION_NOT_FOUND' && error.status === 404,
  );
});

test('rejects path traversal and unsafe session identifiers before filesystem access', (t) => {
  const { rootDir, store } = fixture(t);
  const attempts = ['../escape', '..\\escape', '/absolute', 'C:\\escape', '.', '', 'space name'];
  for (const sessionId of attempts) {
    assert.throws(
      () => save(store, sessionId, 1, harness(1)),
      (error) => error instanceof HarnessRevisionValidationError
        && error.code === 'HARNESS_REVISION_UNSAFE_SESSION',
      sessionId,
    );
  }
  assert.equal(fs.existsSync(path.resolve(rootDir, '..', 'escape')), false);
});
