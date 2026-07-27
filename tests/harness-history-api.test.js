'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StateStore } = require('../state');
const { createApp } = require('../server');

function fixture(t, options = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-council-harness-history-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const snapshotPath = path.join(dir, 'session.json');
  return {
    dir,
    snapshotPath,
    store: new StateStore({ snapshotPath, autoLoad: false, ...options }),
  };
}

function inertEngine() {
  return {
    setEmitter() {},
    cancel() {},
    retry() { throw new Error('not used'); },
    runPlanning() { throw new Error('not used'); },
  };
}

async function startServer(t, store) {
  const app = createApp({ store, engine: inertEngine() });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => {
    app.locals.closeStreams();
    server.close(resolve);
  }));
  return `http://127.0.0.1:${server.address().port}`;
}

async function request(base, store, method, route, body, headers = {}) {
  return fetch(`${base}${route}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(!['GET', 'HEAD'].includes(method)
        ? { 'x-ai-council-session': store.get().sessionKey }
        : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function replaceAsOrchestrator(store, patch) {
  const next = JSON.parse(JSON.stringify(store.get().harnesses));
  for (const [role, fields] of Object.entries(patch)) Object.assign(next[role], fields);
  return store.replaceHarnesses(next, { source: 'orchestrator' });
}

test('legacy current Harness is seeded and history exposes verified metadata but no revision bodies', (t) => {
  const { dir, snapshotPath, store } = fixture(t);
  const initial = store.getHarnessHistory();
  assert.equal(initial.currentRevision, 0);
  assert.deepEqual(initial.revisions.map((entry) => entry.revision), [0]);
  assert.equal(initial.revisions[0].integrity, 'verified');
  assert.equal(Object.hasOwn(initial.revisions[0], 'harnesses'), false);

  store.patchHarness('orchestrator', { mission: 'OLD_HISTORY_BODY_CANARY' }, {
    expectedRevision: 0,
    expectedRoleVersion: 0,
  });
  store.patchHarness('orchestrator', { mission: 'Current public mission.' }, {
    expectedRevision: 1,
    expectedRoleVersion: 1,
  });

  const history = store.getHarnessHistory();
  assert.deepEqual(history.revisions.map((entry) => entry.revision), [2, 1, 0]);
  assert.equal(history.revisions.every((entry) => !Object.hasOwn(entry, 'harnesses')), true);
  assert.doesNotMatch(JSON.stringify(store.publicState()), /OLD_HISTORY_BODY_CANARY/);
  assert.equal(fs.readdirSync(path.join(dir, 'harness-revisions', store.get().sessionKey)).length, 3);

  const diff = store.diffHarnessRevisions(1, 2, { role: 'orchestrator' });
  assert.deepEqual(diff.changedRoles, ['orchestrator']);
  assert.equal(diff.changes.some((change) => (
    change.path === '/mission'
      && change.before === 'OLD_HISTORY_BODY_CANARY'
      && change.after === 'Current public mission.'
  )), true);

  const restarted = new StateStore({ snapshotPath, autoLoad: true });
  assert.deepEqual(restarted.getHarnessHistory().revisions.map((entry) => entry.revision), [2, 1, 0]);
  assert.deepEqual(
    restarted.diffHarnessRevisions(1, 2, { role: 'orchestrator' }).changedRoles,
    ['orchestrator'],
  );
});

test('role rollback creates a new revision, keeps other overlays, and locks restored fields', (t) => {
  const { store } = fixture(t);
  replaceAsOrchestrator(store, {
    orchestrator: { mission: 'Historical orchestrator mission.' },
  });
  store.patchHarness('orchestrator', { customInstructions: 'Persistent same-role overlay.' }, {
    expectedRoleVersion: 1,
  });
  store.patchHarness('claudeWorker', { mission: 'Persistent Claude user overlay.' }, {
    expectedRoleVersion: 0,
  });
  replaceAsOrchestrator(store, {
    orchestrator: { mission: 'Newest orchestrator mission.' },
  });

  const rollback = store.rollbackHarnesses(1, {
    role: 'orchestrator',
    expectedRevision: 4,
  });
  assert.equal(rollback.rollback.newRevision, 5);
  assert.equal(rollback.rollback.targetRevision, 1);
  assert.deepEqual(rollback.rollback.changedRoles, ['orchestrator']);
  assert.equal(store.get().harnesses.orchestrator.mission, 'Historical orchestrator mission.');
  assert.equal(store.get().harnesses.orchestrator.customInstructions, 'Persistent same-role overlay.');
  assert.equal(store.get().harnesses.claudeWorker.mission, 'Persistent Claude user overlay.');
  assert.equal(
    store.get().harnessUserOverlays.orchestrator.mission,
    'Historical orchestrator mission.',
  );
  assert.equal(
    store.get().harnessUserOverlays.orchestrator.customInstructions,
    'Persistent same-role overlay.',
  );
  assert.equal(
    store.get().harnessUserOverlays.claudeWorker.mission,
    'Persistent Claude user overlay.',
  );
  assert.match(store.get().harnessHistory.at(-1).source, /^rollback:r1:orchestrator$/);

  const orchestrated = JSON.parse(JSON.stringify(store.get().harnesses));
  orchestrated.orchestrator.mission = 'Orchestrator attempted overwrite.';
  orchestrated.orchestrator.customInstructions = 'Attempted same-role overlay overwrite.';
  orchestrated.claudeWorker.mission = 'Claude attempted overwrite.';
  store.replaceHarnesses(orchestrated, { source: 'orchestrator' });
  assert.equal(store.get().harnesses.orchestrator.mission, 'Historical orchestrator mission.');
  assert.equal(store.get().harnesses.orchestrator.customInstructions, 'Persistent same-role overlay.');
  assert.equal(store.get().harnesses.claudeWorker.mission, 'Persistent Claude user overlay.');
});

test('rollback rejects no-op, running, and archived sessions', (t) => {
  const { store } = fixture(t);
  store.patchHarness('orchestrator', { mission: 'Revision one.' }, { expectedRoleVersion: 0 });

  assert.throws(
    () => store.rollbackHarnesses(1, { role: 'all', expectedRevision: 1 }),
    (error) => error.status === 409 && error.code === 'HARNESS_ROLLBACK_NOOP',
  );
  store.get().phase = 'drafting';
  assert.throws(
    () => store.rollbackHarnesses(0, { role: 'all', expectedRevision: 1 }),
    (error) => error.status === 409,
  );
  store.get().phase = 'idle';
  store.get().archivedAt = '2026-07-15T12:00:00.000Z';
  assert.throws(
    () => store.rollbackHarnesses(0, { role: 'all', expectedRevision: 1 }),
    (error) => error.status === 423,
  );
});

test('revision persistence failure leaves in-memory and snapshot Harness state unchanged', (t) => {
  const storageError = new Error('simulated revision disk failure');
  const revisionStore = {
    seedLegacyCurrent() { return { seeded: false }; },
    saveRevision() { throw storageError; },
  };
  const { snapshotPath, store } = fixture(t, { harnessRevisionStore: revisionStore });
  store.snapshot();
  const beforeState = JSON.stringify(store.get());
  const beforeSnapshot = fs.readFileSync(snapshotPath, 'utf8');

  assert.throws(
    () => store.patchHarness('orchestrator', { mission: 'Must not commit.' }, {
      expectedRevision: 0,
      expectedRoleVersion: 0,
    }),
    storageError,
  );
  assert.equal(JSON.stringify(store.get()), beforeState);
  assert.equal(fs.readFileSync(snapshotPath, 'utf8'), beforeSnapshot);
});

test('history, diff, and rollback APIs require exact concurrency and stale Harness blocks approval', async (t) => {
  const { store } = fixture(t);
  replaceAsOrchestrator(store, { orchestrator: { mission: 'API historical mission.' } });
  replaceAsOrchestrator(store, { orchestrator: { mission: 'API current mission.' } });
  store.get().cycle = 1;
  store.get().cycles = [{ number: 1, harnessRevision: 2, status: 'awaiting_approval' }];
  store.get().phase = 'awaiting_approval';
  store.get().planVersion = 1;
  store.get().currentPlan = {
    status: 'ready_for_approval', requiredQuestions: [], optionalQuestions: [],
  };
  store.get().currentEvaluation = { passed: true };
  const base = await startServer(t, store);

  const historyResponse = await request(base, store, 'GET', '/api/harnesses/history');
  assert.equal(historyResponse.status, 200);
  assert.equal(historyResponse.headers.get('etag'), '"harness-2"');
  const history = await historyResponse.json();
  assert.deepEqual(history.revisions.map((entry) => entry.revision), [2, 1, 0]);
  assert.equal(history.revisions.every((entry) => !Object.hasOwn(entry, 'harnesses')), true);

  const diffResponse = await request(
    base, store, 'GET', '/api/harnesses/diff?from=1&to=current&role=orchestrator',
  );
  assert.equal(diffResponse.status, 200);
  assert.deepEqual((await diffResponse.json()).changedRoles, ['orchestrator']);

  const missingMatch = await request(base, store, 'POST', '/api/harnesses/rollback', {
    revision: 1, role: 'orchestrator',
  });
  assert.equal(missingMatch.status, 428);
  const malformedMatch = await request(base, store, 'POST', '/api/harnesses/rollback', {
    revision: 1, role: 'orchestrator',
  }, { 'if-match': '2' });
  assert.equal(malformedMatch.status, 400);
  const staleMatch = await request(base, store, 'POST', '/api/harnesses/rollback', {
    revision: 1, role: 'orchestrator',
  }, { 'if-match': 'harness-1' });
  assert.equal(staleMatch.status, 409);

  const rolledBack = await request(base, store, 'POST', '/api/harnesses/rollback', {
    revision: 1, role: 'orchestrator',
  }, { 'if-match': '"harness-2"' });
  assert.equal(rolledBack.status, 200);
  assert.equal(rolledBack.headers.get('etag'), '"harness-3"');
  const body = await rolledBack.json();
  assert.equal(body.rollback.newRevision, 3);
  assert.equal(body.state.harnessPlanStale, true);
  assert.equal(body.state.currentCycleHarnessRevision, 2);
  assert.equal(body.state.harnessRevision, 3);

  const approval = await request(base, store, 'POST', '/api/approve', { planVersion: 1 });
  assert.equal(approval.status, 409);
  assert.match((await approval.json()).error.message, /Harness revision changed/);

  const noOp = await request(base, store, 'POST', '/api/harnesses/rollback', {
    revision: 3, role: 'all',
  }, { 'if-match': 'harness-3' });
  assert.equal(noOp.status, 409);
  assert.equal((await noOp.json()).error.code, 'HARNESS_ROLLBACK_NOOP');
});
