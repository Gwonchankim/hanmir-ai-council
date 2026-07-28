'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { StateStore, defaultState } = require('../state');
const { createApp } = require('../server');
const { roleToMarkdown, markdownToRole } = require('../harnesses');

function fixture(t, { autoLoad = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-council-backend-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const snapshotPath = path.join(dir, 'session.json');
  return { dir, snapshotPath, store: new StateStore({ snapshotPath, autoLoad }) };
}

function inertEngine() {
  return {
    setEmitter(fn) { this.emitter = fn; },
    cancel() {},
    retry() { throw new Error('not used'); },
    runPlanning() { throw new Error('not used'); },
  };
}

async function startFixtureServer(t, store) {
  const app = createApp({ store, engine: inertEngine() });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => {
    app.locals.closeStreams();
    server.close(resolve);
  }));
  return { app, server, base: `http://127.0.0.1:${server.address().port}` };
}

async function jsonRequest(base, method, route, body, { sessionId, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined) requestHeaders['content-type'] = 'application/json';
  if (sessionId) requestHeaders['x-ai-council-session'] = sessionId;
  return fetch(`${base}${route}`, {
    method,
    headers: requestHeaders,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function rawGetStatus(url, hostHeader) {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.get({
      hostname: parsed.hostname,
      port: parsed.port,
      path: parsed.pathname,
      headers: { Host: hostHeader },
    }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
  });
}

test('legacy session.json migrates without losing sessions or the current plan', (t) => {
  const { dir, snapshotPath } = fixture(t);
  const legacy = defaultState();
  legacy.stateVersion = 1;
  legacy.sessionTitle = 'New AI Council session';
  legacy.lastInstruction = 'Legacy planning session request';
  legacy.sessions.orchestrator = 'legacy-orchestrator-session';
  legacy.currentPlan = { title: 'Preserved plan', requiredQuestions: [], optionalQuestions: [] };
  delete legacy.harnesses;
  delete legacy.harnessRevision;
  delete legacy.harnessRoleVersions;
  delete legacy.harnessRoleMeta;
  delete legacy.harnessHistory;
  fs.writeFileSync(snapshotPath, JSON.stringify(legacy), 'utf8');

  const migrated = new StateStore({ snapshotPath, autoLoad: true });
  assert.equal(migrated.get().sessions.orchestrator, 'legacy-orchestrator-session');
  assert.equal(migrated.get().sessionTitle, 'Legacy planning session request');
  assert.equal(migrated.get().currentPlan.title, 'Preserved plan');
  assert.equal(migrated.get().harnesses.artifactType, 'harness_set');
  migrated.snapshot();
  assert.equal(fs.existsSync(path.join(dir, 'sessions-index.json')), true);
  assert.equal(fs.readdirSync(path.join(dir, 'sessions')).length, 1);
});

test('full A/B session snapshots survive restart and activate round trips', (t) => {
  const { dir, snapshotPath, store } = fixture(t);
  store.get().sessionTitle = 'Session A';
  store.get().currentPlan = { title: 'Plan A', requiredQuestions: [], optionalQuestions: [] };
  store.snapshot();
  const sessionA = store.get().sessionKey;

  store.configure(store.get().config, { reset: true });
  store.get().sessionTitle = 'Session B';
  store.get().currentPlan = { title: 'Plan B', requiredQuestions: [], optionalQuestions: [] };
  store.snapshot();
  const sessionB = store.get().sessionKey;

  assert.notEqual(sessionA, sessionB);
  assert.equal(fs.readdirSync(path.join(dir, 'sessions')).length, 2);
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'sessions-index.json'), 'utf8'));
  assert.equal(index.sessions.length, 2);

  const restarted = new StateStore({ snapshotPath, autoLoad: true });
  assert.equal(restarted.get().sessionKey, sessionB);
  assert.equal(restarted.listSessions().length, 2);
  restarted.activateSession(sessionA);
  assert.equal(restarted.get().sessionTitle, 'Session A');
  assert.equal(restarted.get().currentPlan.title, 'Plan A');
  restarted.activateSession(sessionB);
  assert.equal(restarted.get().sessionTitle, 'Session B');
  assert.equal(restarted.get().currentPlan.title, 'Plan B');
});

test('load() recovers the freshest completed snapshot when legacy session.json lags after a mid-write crash', (t) => {
  // snapshot() writes per-session file -> registry -> legacy session.json as
  // three separate atomic writes. If the process dies after the per-session
  // write but before the legacy write completes, legacy is left holding an
  // older, already-superseded copy of the same session. load() must still
  // recover the most recently *completed* snapshot() call, not the stale
  // legacy file, regardless of exactly where the crash landed.
  const { dir, snapshotPath, store } = fixture(t);
  store.get().phase = 'awaiting_approval';
  store.get().sessionTitle = 'Before crash';
  store.appendEvent({ type: 'status', role: 'system', message: 'checkpoint 1' });
  store.snapshot();
  const sessionKey = store.get().sessionKey;
  const perSessionFile = store._snapshotFile(sessionKey);
  const staleLegacyContent = fs.readFileSync(snapshotPath, 'utf8');
  const staleSeq = JSON.parse(staleLegacyContent).snapshotSeq;

  // A later, fully completed snapshot() call: both files agree here.
  store.get().sessionTitle = 'After crash';
  store.appendEvent({ type: 'status', role: 'system', message: 'checkpoint 2 (latest committed work)' });
  store.snapshot();
  const freshSeq = JSON.parse(fs.readFileSync(perSessionFile, 'utf8')).snapshotSeq;
  assert.ok(freshSeq > staleSeq);
  assert.equal(JSON.parse(fs.readFileSync(snapshotPath, 'utf8')).snapshotSeq, freshSeq);

  // Simulate the crash: only the legacy file failed to pick up the latest
  // completed write (per-session file already reflects it, as above).
  fs.writeFileSync(snapshotPath, staleLegacyContent, 'utf8');
  assert.equal(JSON.parse(fs.readFileSync(snapshotPath, 'utf8')).sessionTitle, 'Before crash');
  assert.equal(JSON.parse(fs.readFileSync(perSessionFile, 'utf8')).sessionTitle, 'After crash');

  const recovered = new StateStore({ snapshotPath, autoLoad: true });
  assert.equal(recovered.get().sessionKey, sessionKey);
  assert.equal(recovered.get().sessionTitle, 'After crash');
  assert.equal(recovered.get().transcript.length, 2);
  assert.equal(recovered.get().transcript.at(-1).message, 'checkpoint 2 (latest committed work)');
  assert.equal(recovered.get().snapshotSeq, freshSeq);
  // load() self-heals legacy so a second restart (or another reader of
  // data/session.json) also sees the recovered content immediately.
  assert.equal(JSON.parse(fs.readFileSync(snapshotPath, 'utf8')).sessionTitle, 'After crash');

  const dirEntries = fs.readdirSync(path.join(dir, 'sessions'));
  assert.equal(dirEntries.length, 1);
});

test('harness delivery cache tracks per-session digests, survives restart, and evicts oldest entries', (t) => {
  const { snapshotPath, store } = fixture(t);
  const digestA = 'a'.repeat(64);
  const digestB = 'b'.repeat(64);

  assert.equal(store.hasHarnessDelivery('session-1', digestA, 1), false);
  store.recordHarnessDelivery('session-1', digestA, 'claudeWorker', 1);
  assert.equal(store.hasHarnessDelivery('session-1', digestA, 1), true);
  // A different digest for the same session (harness revision changed) is a
  // miss -- the caller must resend the full harness.
  assert.equal(store.hasHarnessDelivery('session-1', digestB, 1), false);
  // A different session id for the same digest (new session/fork/recovery)
  // is also a miss.
  assert.equal(store.hasHarnessDelivery('session-2', digestA, 1), false);
  // A new cycle is a miss even for the same session and digest: the evidence
  // gate requires one full-harness prompt per role per cycle, so the cache
  // must not span cycle boundaries.
  assert.equal(store.hasHarnessDelivery('session-1', digestA, 2), false);
  // Missing arguments never produce a false "hit".
  assert.equal(store.hasHarnessDelivery(null, digestA, 1), false);
  assert.equal(store.hasHarnessDelivery('session-1', null, 1), false);
  store.snapshot();

  const restarted = new StateStore({ snapshotPath, autoLoad: true });
  assert.equal(restarted.hasHarnessDelivery('session-1', digestA, 1), true);

  // Bounded cache: once more than HARNESS_DELIVERY_MAX_ENTRIES (64) distinct
  // sessions have been recorded, the oldest entries are pruned so a
  // long-running conversation cannot grow this map without bound.
  for (let i = 0; i < 80; i += 1) {
    restarted.recordHarnessDelivery(`bulk-session-${i}`, digestA, 'claudeWorker', 1);
  }
  const keys = Object.keys(restarted.get().harnessDelivery);
  assert.ok(keys.length <= 64);
  assert.equal(restarted.hasHarnessDelivery('bulk-session-79', digestA, 1), true);
  assert.equal(restarted.hasHarnessDelivery('bulk-session-0', digestA, 1), false);
});

test('activate validates snapshot identity before commit and rolls back on mismatch', (t) => {
  const { snapshotPath, store } = fixture(t);
  store.get().sessionTitle = 'Session A';
  store.snapshot();
  const sessionA = store.get().sessionKey;
  store.configure(store.get().config, { reset: true });
  store.get().sessionTitle = 'Session B';
  store.snapshot();
  const sessionB = store.get().sessionKey;

  const tamperedFile = store._snapshotFile(sessionA);
  const tampered = JSON.parse(fs.readFileSync(tamperedFile, 'utf8'));
  tampered.sessionKey = 'tampered-session-id';
  fs.writeFileSync(tamperedFile, JSON.stringify(tampered), 'utf8');

  assert.throws(() => store.activateSession(sessionA), { status: 409 });
  assert.equal(store.get().sessionKey, sessionB);
  assert.equal(store.get().sessionTitle, 'Session B');
  assert.equal(JSON.parse(fs.readFileSync(snapshotPath, 'utf8')).sessionKey, sessionB);
});

test('canonical Markdown harnesses round-trip with bounded delta-only history', (t) => {
  const { store } = fixture(t);
  const initial = store.get().harnesses.orchestrator;
  const canonical = roleToMarkdown(initial);
  assert.deepEqual(markdownToRole(canonical, initial), initial);

  const edited = canonical.replace(initial.mission, 'Lead a focused, testable planning council.');
  const result = store.updateHarnessContent('orchestrator', edited, {
    expectedRevision: 0,
    expectedRoleVersion: 0,
  });
  assert.equal(result.harness.version, 1);
  assert.equal(store.get().harnesses.orchestrator.mission, 'Lead a focused, testable planning council.');
  assert.throws(() => store.updateHarnessContent('orchestrator', edited, { expectedRoleVersion: 0 }), {
    status: 409,
  });

  for (let index = 0; index < 22; index += 1) {
    store.patchHarness('orchestrator', { mission: `Mission revision ${index}` }, {
      expectedRoleVersion: store.get().harnessRoleVersions.orchestrator,
    });
  }
  assert.equal(store.get().harnessHistory.length, 20);
  assert.ok(store.get().harnessHistory.every((entry) => !Object.hasOwn(entry, 'harnesses')));
});

test('public state recursively removes private reasoning fields but preserves analysisModules', (t) => {
  const { store } = fixture(t);
  store.get().currentPlan = {
    title: 'Safe title',
    reasoning: 'CANARY_REASONING',
    nested: { analysis: 'CANARY_ANALYSIS', analysisModules: ['keep-me'] },
    raw_prompt: 'CANARY_PROMPT',
    requiredQuestions: [],
    optionalQuestions: [],
  };
  store.get().currentEvaluation = { safe: true, raw_response: 'CANARY_RESPONSE' };
  store.get().lastError = { message: 'safe error', system_prompt: 'CANARY_SYSTEM' };
  store.appendEvent({
    type: 'artifact', role: 'orchestrator', message: 'safe',
    artifact: { nested: { chain_of_thought: 'CANARY_COT', safe: 'visible' } },
  });
  const serialized = JSON.stringify(store.publicState());
  assert.doesNotMatch(serialized, /CANARY_/);
  assert.match(serialized, /analysisModules/);
  assert.match(serialized, /keep-me/);
  assert.match(serialized, /visible/);
});

test('session and harness APIs enforce local security, revisions, and stale-tab session preconditions', async (t) => {
  const { store } = fixture(t);
  store.snapshot();
  const firstSession = store.get().sessionKey;
  const { base, server } = await startFixtureServer(t, store);

  const stateResponse = await fetch(`${base}/api/state`);
  assert.equal(stateResponse.status, 200);
  assert.match(stateResponse.headers.get('cache-control'), /no-store/);
  assert.equal(await rawGetStatus(`${base}/api/state`, 'attacker.example'), 403);
  const wrongOrigin = await fetch(`${base}/api/state`, {
    headers: { origin: 'http://127.0.0.1:4000' },
  });
  assert.equal(wrongOrigin.status, 403);
  const crossSite = await fetch(`${base}/api/state`, {
    headers: { 'sec-fetch-site': 'cross-site' },
  });
  assert.equal(crossSite.status, 403);
  const noJson = await fetch(`${base}/api/cancel`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain', 'x-ai-council-session': firstSession },
    body: 'cancel',
  });
  assert.equal(noJson.status, 415);

  const harnessList = await fetch(`${base}/api/harnesses`);
  const harnessState = await harnessList.json();
  const orchestrator = harnessState.harnesses.orchestrator;
  const content = orchestrator.content.replace(
    'Translate the user request into a decision-complete planning process and integrate both workers fairly.',
    'Coordinate an evidence-led planning process.',
  );
  const missingVersion = await jsonRequest(base, 'PUT', '/api/harnesses/orchestrator', {
    content,
  }, { sessionId: firstSession });
  assert.equal(missingVersion.status, 428);
  const update = await jsonRequest(base, 'PUT', '/api/harnesses/orchestrator', {
    content,
    version: orchestrator.version,
  }, { sessionId: firstSession, headers: { 'if-match': `"harness-${harnessState.revision}"` } });
  assert.equal(update.status, 200);
  const updated = await update.json();
  assert.equal(updated.harness.version, 1);
  assert.match(updated.harness.content, /Coordinate an evidence-led/);

  const staleRole = await jsonRequest(base, 'PUT', '/api/harnesses/orchestrator', {
    content,
    version: 0,
  }, { sessionId: firstSession });
  assert.equal(staleRole.status, 409);
  const staleGlobal = await jsonRequest(base, 'PUT', '/api/harnesses/orchestrator', {
    content,
    version: 1,
  }, { sessionId: firstSession, headers: { 'if-match': '"harness-0"' } });
  assert.equal(staleGlobal.status, 409);

  const created = await jsonRequest(base, 'POST', '/api/session', { config: {} }, { sessionId: firstSession });
  assert.equal(created.status, 200);
  const createdBody = await created.json();
  const secondSession = createdBody.state.sessionId;
  assert.notEqual(secondSession, firstSession);
  const staleTab = await jsonRequest(base, 'POST', '/api/approve', {}, { sessionId: firstSession });
  assert.equal(staleTab.status, 409);
  assert.equal((await staleTab.json()).error.activeSessionId, secondSession);

  const sessions = await (await fetch(`${base}/api/sessions`)).json();
  assert.equal(sessions.activeSessionId, secondSession);
  assert.deepEqual(Object.keys(sessions.sessions[0]).sort(), [
    'active', 'archivedAt', 'cycle', 'id', 'metadataVersion', 'phase', 'title', 'updatedAt',
  ]);
  assert.equal(sessions.sessions.length, 2);
  const activated = await jsonRequest(
    base, 'POST', `/api/sessions/${firstSession}/activate`, {}, { sessionId: secondSession },
  );
  assert.equal(activated.status, 200);
  assert.equal((await activated.json()).state.sessionId, firstSession);
  assert.ok(server.listening);
});

test('SSE replay is pinned to the requested session and carries sessionId', async (t) => {
  const { store } = fixture(t);
  store.appendEvent({ type: 'status', role: 'system', message: 'ONLY_SESSION_A' });
  store.snapshot();
  const sessionA = store.get().sessionKey;
  store.configure(store.get().config, { reset: true });
  store.appendEvent({ type: 'status', role: 'system', message: 'ONLY_SESSION_B' });
  store.snapshot();
  const sessionB = store.get().sessionKey;
  const { base } = await startFixtureServer(t, store);

  async function replay(sessionId) {
    const controller = new AbortController();
    const response = await fetch(`${base}/api/stream?sessionId=${sessionId}`, { signal: controller.signal });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const chunk = await reader.read();
    const text = Buffer.from(chunk.value).toString('utf8');
    controller.abort();
    try { await reader.cancel(); } catch (_) {}
    return text;
  }

  const replayA = await replay(sessionA);
  assert.match(replayA, /ONLY_SESSION_A/);
  assert.doesNotMatch(replayA, /ONLY_SESSION_B/);
  assert.match(replayA, new RegExp(sessionA));
  const replayB = await replay(sessionB);
  assert.match(replayB, /ONLY_SESSION_B/);
  assert.doesNotMatch(replayB, /ONLY_SESSION_A/);
  assert.match(replayB, new RegExp(sessionB));
});

test('session metadata remains backward compatible and persists rename/archive versions', (t) => {
  const { dir, snapshotPath, store } = fixture(t);
  store.get().sessionTitle = 'Legacy-style metadata';
  delete store.get().archivedAt;
  delete store.get().metadataVersion;
  store.snapshot();
  const sessionId = store.get().sessionKey;

  const registryPath = path.join(dir, 'sessions-index.json');
  const registry = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  delete registry.sessions[0].archivedAt;
  delete registry.sessions[0].metadataVersion;
  registry.version = 1;
  fs.writeFileSync(registryPath, JSON.stringify(registry), 'utf8');

  const migrated = new StateStore({ snapshotPath, autoLoad: true });
  assert.equal(migrated.get().archivedAt, null);
  assert.equal(migrated.get().metadataVersion, 1);
  const renamed = migrated.updateSessionMetadata(sessionId, { title: 'Renamed session' }, { expectedVersion: 1 });
  assert.equal(renamed.title, 'Renamed session');
  assert.equal(renamed.metadataVersion, 2);
  const archived = migrated.updateSessionMetadata(sessionId, { archived: true }, { expectedVersion: 2 });
  assert.ok(archived.archivedAt);
  assert.equal(archived.metadataVersion, 3);

  const restarted = new StateStore({ snapshotPath, autoLoad: true });
  assert.equal(restarted.get().sessionTitle, 'Renamed session');
  assert.ok(restarted.get().archivedAt);
  assert.equal(restarted.get().metadataVersion, 3);
  assert.equal(restarted.listSessions().length, 0);
  assert.equal(restarted.listSessions({ scope: 'archived' }).length, 1);
  assert.equal(restarted.listSessions({ scope: 'all', q: 'RENAMED' }).length, 1);
});

test('session management API searches, renames, archives, restores, and locks archived work', async (t) => {
  const { store } = fixture(t);
  store.get().sessionTitle = 'Market entry alpha';
  store.snapshot();
  const sessionA = store.get().sessionKey;
  store.configure(store.get().config, { reset: true });
  store.get().sessionTitle = 'Product roadmap beta';
  store.snapshot();
  const sessionB = store.get().sessionKey;
  const { base } = await startFixtureServer(t, store);

  const search = await (await fetch(`${base}/api/sessions?scope=all&q=MARKET`)).json();
  assert.equal(search.sessions.length, 1);
  assert.equal(search.sessions[0].id, sessionA);
  assert.equal(search.sessions[0].metadataVersion, 1);

  const missingMatch = await jsonRequest(base, 'PATCH', `/api/sessions/${sessionA}`, {
    title: 'Market entry renamed',
  }, { sessionId: sessionB });
  assert.equal(missingMatch.status, 428);

  const renamed = await jsonRequest(base, 'PATCH', `/api/sessions/${sessionA}`, {
    title: 'Market entry renamed',
  }, { sessionId: sessionB, headers: { 'if-match': '"session-1"' } });
  assert.equal(renamed.status, 200);
  assert.equal(renamed.headers.get('etag'), '"session-2"');
  assert.equal((await renamed.json()).session.title, 'Market entry renamed');

  const stale = await jsonRequest(base, 'PATCH', `/api/sessions/${sessionA}`, {
    archived: true,
  }, { sessionId: sessionB, headers: { 'if-match': '"session-1"' } });
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.currentVersion, 2);

  const streamController = new AbortController();
  const liveStream = await fetch(`${base}/api/stream?sessionId=${sessionA}`, { signal: streamController.signal });
  assert.equal(liveStream.status, 200);
  const liveReader = liveStream.body.getReader();
  await liveReader.read();
  const archived = await jsonRequest(base, 'PATCH', `/api/sessions/${sessionA}`, {
    archived: true,
  }, { sessionId: sessionB, headers: { 'if-match': '"session-2"' } });
  assert.equal(archived.status, 200);
  const archivedBody = await archived.json();
  assert.ok(archivedBody.session.archivedAt);
  assert.equal(archivedBody.session.metadataVersion, 3);
  let closeTimer;
  const closedStream = await Promise.race([
    liveReader.read(),
    new Promise((_, reject) => {
      closeTimer = setTimeout(() => reject(new Error('archived SSE did not close')), 1_000);
    }),
  ]);
  clearTimeout(closeTimer);
  assert.equal(closedStream.done, true);
  streamController.abort();
  const activeList = await (await fetch(`${base}/api/sessions?scope=active`)).json();
  assert.equal(activeList.sessions.some((entry) => entry.id === sessionA), false);
  const archivedList = await (await fetch(`${base}/api/sessions?scope=archived`)).json();
  assert.equal(archivedList.sessions.some((entry) => entry.id === sessionA), true);

  const activated = await jsonRequest(
    base, 'POST', `/api/sessions/${sessionA}/activate`, {}, { sessionId: sessionB },
  );
  assert.equal(activated.status, 200);
  assert.ok((await activated.json()).state.archivedAt);
  const stream = await fetch(`${base}/api/stream?sessionId=${sessionA}`);
  assert.equal(stream.status, 409);
  const lockedHarness = await jsonRequest(base, 'PUT', '/api/harnesses/orchestrator', {
    content: 'cannot edit archived harness', version: 0,
  }, { sessionId: sessionA });
  assert.equal(lockedHarness.status, 423);
  const lockedInstruction = await jsonRequest(base, 'POST', '/api/instruct', {
    instruction: 'cannot run archived session',
  }, { sessionId: sessionA });
  assert.equal(lockedInstruction.status, 423);

  const restored = await jsonRequest(base, 'PATCH', `/api/sessions/${sessionA}`, {
    archived: false,
  }, { sessionId: sessionA, headers: { 'if-match': '"session-3"' } });
  assert.equal(restored.status, 200);
  const restoredBody = await restored.json();
  assert.equal(restoredBody.session.archivedAt, null);
  assert.equal(restoredBody.session.metadataVersion, 4);
  assert.equal(restoredBody.state.archivedAt, null);
});
