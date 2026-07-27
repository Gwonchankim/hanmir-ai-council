'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const defaultStore = require('./state');
const defaultEngine = require('./engine');
const { resolveClaudeBin } = require('./adapters/claude');
const { resolveCodexBin } = require('./adapters/codex');
const { ModelCapacityService } = require('./lib/model-capacity');
const {
  RemoteMutationGuard,
  authenticateRequest,
  isLoopback,
  normalizeAccessPolicy,
} = require('./lib/access-security');

function preflight() {
  const result = {};
  for (const [key, resolver] of [['claude', resolveClaudeBin], ['codex', resolveCodexBin]]) {
    try {
      const executable = resolver();
      result[key] = { ready: fs.existsSync(executable), executable };
    } catch (error) {
      result[key] = { ready: false, error: error.message };
    }
  }
  return result;
}

function modelReadiness() {
  const providers = preflight();
  return Object.fromEntries(['claude', 'codex'].map((brain) => [brain, {
    cliReady: Boolean(providers[brain]?.ready),
    verification: providers[brain]?.ready ? 'ready_for_first_call' : 'cli_unavailable',
    note: providers[brain]?.ready
      ? '계정 권한·사용량 한도는 첫 호출에서 확인되며, 가용성 오류는 configured fallback으로 전환됩니다.'
      : 'CLI를 찾을 수 없어 이 Provider의 모델을 실행할 수 없습니다.',
  }]));
}

function createApp({
  store = defaultStore,
  engine = defaultEngine,
  accessPolicy = config.access,
  accessGuardOptions = {},
  modelCapacity = null,
} = {}) {
  const app = express();
  const clients = new Set();
  const normalizedAccessPolicy = normalizeAccessPolicy(accessPolicy);
  const mutationGuard = new RemoteMutationGuard(normalizedAccessPolicy, accessGuardOptions);
  const modelCapacityService = modelCapacity || new ModelCapacityService({
    cwd: process.cwd(),
    env: process.env,
  });

  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.use(express.json({ limit: config.limits.requestBytes }));

  app.use((req, res, next) => {
    if (req.path === '/stream' || req.path.startsWith('/api/')) {
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Vary', 'Origin, Sec-Fetch-Site');
    }
    try {
      req.aiCouncilAccess = authenticateRequest(req, normalizedAccessPolicy);
    } catch (error) {
      return next(error);
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.is('application/json')) {
      return res.status(415).json({ error: { message: 'Mutating requests require application/json.' } });
    }
    return next();
  });

  app.use((req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    try {
      mutationGuard.authorizeMutation(req, req.aiCouncilAccess);
    } catch (error) {
      return next(error);
    }
    const requestedSessionId = String(req.get('x-ai-council-session') || req.body?.sessionId || '').trim();
    if (!requestedSessionId) {
      return res.status(428).json({
        error: {
          message: 'X-AI-Council-Session (or body.sessionId) is required for mutations.',
          activeSessionId: store.get().sessionKey,
        },
      });
    }
    if (requestedSessionId !== store.get().sessionKey) {
      return res.status(409).json({
        error: {
          message: 'The active session changed. Reload before retrying the mutation.',
          activeSessionId: store.get().sessionKey,
        },
      });
    }
    const sessionMetadataMutation = req.method === 'PATCH'
      && /^\/api\/sessions\/[^/]+$/.test(req.path);
    const sessionActivation = req.method === 'POST'
      && /^\/api\/sessions\/[^/]+\/activate$/.test(req.path);
    const sessionCreation = req.method === 'POST' && ['/api/session', '/session'].includes(req.path);
    if (store.get().archivedAt && !sessionMetadataMutation && !sessionActivation && !sessionCreation) {
      return res.status(423).json({
        error: {
          message: 'Archived sessions are read-only. Restore the session before making changes.',
          archivedAt: store.get().archivedAt,
          activeSessionId: store.get().sessionKey,
        },
      });
    }
    return next();
  });

  function writeEvent(res, event) {
    res.write(`id: ${event.id}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  function broadcast(event) {
    for (const client of [...clients]) {
      if (client.sessionId !== event.sessionId) continue;
      try { writeEvent(client.res, event); } catch (_) { clients.delete(client); }
    }
  }

  function closeSessionStreams(sessionId) {
    for (const client of [...clients]) {
      if (client.sessionId !== sessionId) continue;
      try { client.res.end(); } catch (_) {}
      clients.delete(client);
    }
  }

  function publish(event) {
    const envelope = store.appendEvent(event);
    broadcast(envelope);
    store.snapshot();
    return envelope;
  }

  engine.setEmitter(broadcast);

  const streamHandler = (req, res) => {
    const sessionId = String(req.query.sessionId || store.get().sessionKey);
    const metadata = store.sessionMetadata(sessionId);
    if (!metadata) return res.status(404).json({ error: { message: `Unknown session: ${sessionId}` } });
    if (metadata.archivedAt) {
      return res.status(409).json({
        error: {
          message: 'Archived sessions do not open live event streams.',
          archivedAt: metadata.archivedAt,
          sessionId,
        },
      });
    }
    const events = store.sessionEvents(sessionId);
    if (!events) return res.status(410).json({ error: { message: `Session snapshot is unavailable: ${sessionId}` } });
    res.status(200).set({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();
    const requested = Number(req.get('last-event-id') || req.query.lastEventId || 0);
    const lastEventId = Number.isFinite(requested) ? requested : 0;
    for (const event of events) {
      if (Number(event.id) > lastEventId) writeEvent(res, event);
    }
    res.write(': connected\n\n');
    const client = { res, sessionId };
    clients.add(client);
    const heartbeat = setInterval(() => {
      try { res.write(': heartbeat\n\n'); } catch (_) { clearInterval(heartbeat); clients.delete(client); }
    }, 20_000);
    req.on('close', () => { clearInterval(heartbeat); clients.delete(client); });
    return undefined;
  };

  app.get(['/stream', '/api/stream'], streamHandler);
  app.get('/api/health', (req, res) => res.json({ ok: true, phase: store.get().phase }));
  const securityContextHandler = (req, res) => {
    const access = mutationGuard.accessPayload(req.aiCouncilAccess);
    res.json({
      accessMode: access.mode,
      remote: access.remote,
      remoteIdentity: access.identity?.login
        ? { login: access.identity.login, name: null }
        : null,
      origin: access.origin || null,
      csrfRequired: Boolean(access.csrf?.required),
      csrfToken: access.csrf?.token || null,
      csrfHeader: access.csrf?.header || 'X-AI-Council-CSRF',
    });
  };
  app.get(['/api/security-context', '/api/access'], securityContextHandler);
  app.get('/api/config', (req, res) => res.json({
    options: config.options,
    defaults: config.cloneDefaults(),
    config: store.get().config,
    access: {
      mode: normalizedAccessPolicy.mode,
      remoteEnabled: normalizedAccessPolicy.mode === 'tailscale',
      tailnetHostname: normalizedAccessPolicy.tailnetHostname,
    },
    preflight: preflight(),
    modelReadiness: modelReadiness(),
  }));
  app.get('/api/model-capacity', async (req, res, next) => {
    if (req.aiCouncilAccess?.kind === 'tailscale') {
      return res.json({
        visibility: 'private',
        providers: {},
        message: '계정 사용량은 원격 화면에 표시되지 않습니다.',
      });
    }
    try {
      const force = String(req.query.refresh || '') === '1';
      const snapshot = await modelCapacityService.refresh({ force });
      return res.json(snapshot);
    } catch (error) {
      return next(error);
    }
  });
  app.get('/api/state', (req, res) => res.json(store.publicState()));
  app.get('/api/council/artifacts/:name', (req, res, next) => {
    try {
      const name = String(req.params.name || '');
      if (!/^(?:council-report-[A-Za-z0-9-]+\.html|council-transcript-[A-Za-z0-9-]+\.md)$/.test(name)
        || path.basename(name) !== name) {
        return res.status(400).json({ error: { message: 'Invalid council artifact name.' } });
      }
      const allowed = new Set((store.get().councilReports || []).flatMap((entry) => [
        entry?.html?.name,
        entry?.transcript?.name,
      ]).filter(Boolean));
      if (!allowed.has(name)) {
        return res.status(404).json({ error: { message: 'Council artifact not found for the active session.' } });
      }
      const filePath = path.join(store.dataDir, 'council-artifacts', store.get().sessionKey, name);
      if (!fs.existsSync(filePath)) {
        return res.status(410).json({ error: { message: 'Council artifact file is unavailable.' } });
      }
      res.type(name.endsWith('.html') ? 'html' : 'text/markdown; charset=utf-8');
      return res.sendFile(filePath);
    } catch (error) {
      return next(error);
    }
  });

  function expectedHarnessRevision(req) {
    if (req.body?.expectedRevision !== undefined) return Number(req.body.expectedRevision);
    const header = String(req.get('if-match') || '').trim();
    if (!header || header === '*') return undefined;
    const match = header.match(/(?:harness-)?(\d+)/i);
    return match ? Number(match[1]) : Number.NaN;
  }

  function requiredExactHarnessRevision(req) {
    const header = String(req.get('if-match') || '').trim();
    if (!header) {
      const error = new Error('If-Match with the current Harness revision is required.');
      error.status = 428;
      throw error;
    }
    const match = header.match(/^(?:harness-(\d+)|"harness-(\d+)")$/i);
    if (!match) {
      const error = new Error('If-Match must use the exact format "harness-N".');
      error.status = 400;
      throw error;
    }
    return Number(match[1] || match[2]);
  }

  function sendHarnessState(res, payload = store.getHarnessState()) {
    res.setHeader('ETag', `"harness-${payload.revision}"`);
    return res.json(payload);
  }

  function expectedSessionMetadataVersion(req) {
    const header = String(req.get('if-match') || '').trim();
    if (!header) return undefined;
    const match = header.match(/^(?:W\/)?"?session-(\d+)"?$/i);
    return match ? Number(match[1]) : Number.NaN;
  }

  app.get('/api/sessions', (req, res, next) => {
    try {
      const q = String(req.query.q || '').trim();
      const scope = String(req.query.scope || 'active').toLowerCase();
      if (q.length > 120) {
        const error = new Error('Session search must be 120 characters or fewer.');
        error.status = 400;
        error.field = 'q';
        throw error;
      }
      if (!['active', 'archived', 'all'].includes(scope)) {
        const error = new Error('scope must be active, archived, or all.');
        error.status = 400;
        error.field = 'scope';
        throw error;
      }
      const sessions = store.listSessions({ q, scope }).map((entry) => ({
        id: entry.id || entry.sessionKey,
        title: entry.title,
        phase: entry.phase,
        cycle: entry.cycle,
        updatedAt: entry.updatedAt,
        archivedAt: entry.archivedAt || null,
        metadataVersion: Math.max(1, Number(entry.metadataVersion) || 1),
        active: Boolean(entry.active),
      }));
      res.json({ sessions, activeSessionId: store.get().sessionKey, q, scope });
    } catch (error) { next(error); }
  });

  app.get('/api/sessions/:id', (req, res, next) => {
    try {
      const metadata = store.sessionMetadata(req.params.id);
      if (!metadata) {
        const error = new Error(`Unknown session: ${req.params.id}`);
        error.status = 404;
        throw error;
      }
      res.setHeader('ETag', `"session-${Math.max(1, Number(metadata.metadataVersion) || 1)}"`);
      res.json({ session: metadata, activeSessionId: store.get().sessionKey });
    } catch (error) { next(error); }
  });

  app.patch('/api/sessions/:id', (req, res, next) => {
    try {
      const expectedVersion = expectedSessionMetadataVersion(req);
      if (expectedVersion === undefined) {
        const error = new Error('If-Match with the session metadata version is required.');
        error.status = 428;
        throw error;
      }
      if (!Number.isInteger(expectedVersion)) {
        const error = new Error('If-Match must use the format "session-N".');
        error.status = 400;
        throw error;
      }
      const unknownFields = Object.keys(req.body || {})
        .filter((key) => !['title', 'archived', 'sessionId'].includes(key));
      if (unknownFields.length) {
        const error = new Error(`Unsupported session metadata field: ${unknownFields[0]}`);
        error.status = 400;
        error.field = unknownFields[0];
        throw error;
      }
      const patch = {};
      if (Object.hasOwn(req.body || {}, 'title')) patch.title = req.body.title;
      if (Object.hasOwn(req.body || {}, 'archived')) patch.archived = req.body.archived;
      const session = store.updateSessionMetadata(req.params.id, patch, { expectedVersion });
      const isActive = req.params.id === store.get().sessionKey;
      if (session.archivedAt) closeSessionStreams(req.params.id);
      res.setHeader('ETag', `"session-${session.metadataVersion}"`);
      res.json({
        ok: true,
        session,
        activeSessionId: store.get().sessionKey,
        ...(isActive ? { state: store.publicState() } : {}),
      });
    } catch (error) { next(error); }
  });

  app.post('/api/sessions/:id/activate', (req, res, next) => {
    try {
      store.activateSession(req.params.id);
      if (!store.get().archivedAt) publish({ type: 'config', role: 'system', message: 'Session activated.' });
      res.json({ ok: true, state: store.publicState() });
    } catch (error) { next(error); }
  });

  app.get('/api/harnesses', (req, res) => sendHarnessState(res));

  app.get('/api/harnesses/history', (req, res, next) => {
    try {
      const payload = store.getHarnessHistory();
      res.setHeader('ETag', `"harness-${payload.currentRevision}"`);
      res.json(payload);
    } catch (error) { next(error); }
  });

  app.get('/api/harnesses/diff', (req, res, next) => {
    try {
      const role = String(req.query.role || 'all');
      const currentRevision = store.get().harnessRevision;
      const fromRevision = String(req.query.from || '').toLowerCase() === 'current'
        ? currentRevision : req.query.from;
      const toRevision = req.query.to === undefined
        || String(req.query.to).toLowerCase() === 'current'
        ? currentRevision : req.query.to;
      const payload = store.diffHarnessRevisions(fromRevision, toRevision, { role });
      res.setHeader('ETag', `"harness-${store.get().harnessRevision}"`);
      res.json(payload);
    } catch (error) { next(error); }
  });

  app.post('/api/harnesses/rollback', (req, res, next) => {
    try {
      const expectedRevision = requiredExactHarnessRevision(req);
      const targetRevision = req.body?.revision ?? req.body?.targetRevision;
      if (targetRevision === undefined) {
        const error = new Error('revision is required.');
        error.status = 400;
        error.field = 'revision';
        throw error;
      }
      const payload = store.rollbackHarnesses(targetRevision, {
        role: String(req.body?.role || 'all'),
        expectedRevision,
      });
      publish({
        type: 'config',
        role: 'system',
        message: `Harness ${payload.rollback.role} content restored from revision ${payload.rollback.targetRevision} as revision ${payload.revision}.`,
      });
      res.setHeader('ETag', `"harness-${payload.revision}"`);
      res.json({
        ok: true,
        ...payload,
        state: store.publicState(),
      });
    } catch (error) { next(error); }
  });

  app.get('/api/harnesses/:role', (req, res, next) => {
    try {
      const payload = store.getHarnessState();
      const harness = payload.harnesses[req.params.role];
      if (!harness) {
        const error = new Error(`Unknown harness role: ${req.params.role}`);
        error.status = 404;
        throw error;
      }
      res.setHeader('ETag', `"harness-${payload.revision}"`);
      res.json({ harness, revision: payload.revision, sessionId: payload.sessionId });
    } catch (error) { next(error); }
  });

  app.put('/api/harnesses', (req, res, next) => {
    try {
      const input = req.body?.structuredHarnesses || req.body?.harnesses || req.body;
      const payload = store.replaceHarnesses(input, {
        source: 'user', expectedRevision: expectedHarnessRevision(req), requireAll: true,
      });
      publish({ type: 'config', role: 'system', message: `Harness set updated to revision ${payload.revision}.` });
      sendHarnessState(res, payload);
    } catch (error) { next(error); }
  });

  app.put('/api/harnesses/:role', (req, res, next) => {
    try {
      if (req.body?.version === undefined) {
        const error = new Error('Harness role version is required.');
        error.status = 428;
        error.field = 'version';
        throw error;
      }
      const payload = store.updateHarnessContent(req.params.role, req.body?.content, {
        source: 'user',
        expectedRevision: expectedHarnessRevision(req),
        expectedRoleVersion: req.body?.version,
      });
      publish({ type: 'config', role: 'system', message: `${req.params.role} harness updated.` });
      res.setHeader('ETag', `"harness-${payload.revision}"`);
      res.json({
        ok: true,
        harness: payload.harness,
        revision: payload.revision,
        state: store.publicState(),
      });
    } catch (error) { next(error); }
  });

  app.patch('/api/harnesses/:role', (req, res, next) => {
    try {
      if (req.body?.version === undefined) {
        const error = new Error('Harness role version is required.');
        error.status = 428;
        error.field = 'version';
        throw error;
      }
      const directPatch = { ...(req.body || {}) };
      delete directPatch.version;
      delete directPatch.expectedRevision;
      delete directPatch.sessionId;
      const payload = req.body?.content !== undefined
        ? store.updateHarnessContent(req.params.role, req.body.content, {
          source: 'user', expectedRevision: expectedHarnessRevision(req), expectedRoleVersion: req.body?.version,
        })
        : store.patchHarness(req.params.role, req.body?.patch || req.body?.harness || directPatch, {
          source: 'user', expectedRevision: expectedHarnessRevision(req), expectedRoleVersion: req.body?.version,
        });
      publish({ type: 'config', role: 'system', message: `${req.params.role} harness updated.` });
      const current = store.getHarnessState();
      res.setHeader('ETag', `"harness-${current.revision}"`);
      res.json({
        ok: true,
        harness: current.harnesses[req.params.role],
        revision: current.revision,
        state: store.publicState(),
      });
    } catch (error) { next(error); }
  });

  app.post(['/api/session', '/session'], (req, res, next) => {
    try {
      const selected = store.configure(req.body?.config, { reset: req.body?.reset !== false });
      publish({ type: 'config', role: 'system', message: '세션 설정을 적용했습니다.' });
      res.json({ ok: true, config: selected, phase: store.get().phase, state: store.publicState() });
    } catch (error) { next(error); }
  });

  app.post(['/api/instruct', '/instruct'], (req, res, next) => {
    try {
      const instruction = String(req.body?.instruction || '').trim();
      const run = typeof engine.runInstruction === 'function'
        ? engine.runInstruction(instruction, false)
        : engine.runPlanning(instruction, false);
      run.promise.catch(() => {});
      res.status(202).json({ ok: true, runId: run.runId, cycle: run.cycle, phase: store.get().phase });
    } catch (error) { next(error); }
  });

  app.post(['/api/feedback', '/feedback'], (req, res, next) => {
    try {
      const currentVersion = store.get().planVersion;
      if (req.body?.planVersion !== undefined && Number(req.body.planVersion) !== currentVersion) {
        const error = new Error(`기획안 버전이 변경되었습니다. 현재 버전은 ${currentVersion}입니다.`);
        error.status = 409;
        throw error;
      }
      const feedback = String(req.body?.feedback || '').trim();
      const run = typeof engine.runInstruction === 'function'
        ? engine.runInstruction(feedback, true)
        : engine.runPlanning(feedback, true);
      run.promise.catch(() => {});
      res.status(202).json({ ok: true, runId: run.runId, cycle: run.cycle, phase: store.get().phase });
    } catch (error) { next(error); }
  });

  app.post(['/api/approve', '/approve'], (req, res, next) => {
    try {
      const state = store.get();
      if (state.phase !== 'awaiting_approval' || state.currentPlan?.status !== 'ready_for_approval') {
        const error = new Error('필수 질문이 모두 해결된 승인 대기 상태에서만 승인할 수 있습니다.');
        error.status = 409;
        throw error;
      }
      if (state.currentPlan.requiredQuestions.length) {
        const error = new Error('필수 질문이 남아 있어 승인할 수 없습니다.');
        error.status = 409;
        throw error;
      }
      if (req.body?.planVersion !== undefined && Number(req.body.planVersion) !== state.planVersion) {
        const error = new Error(`기획안 버전이 일치하지 않습니다. 현재 버전은 ${state.planVersion}입니다.`);
        error.status = 409;
        throw error;
      }
      if (state.currentEvaluation && state.currentEvaluation.passed === false) {
        const error = new Error('프로토콜 자동 게이트를 통과하지 못해 승인할 수 없습니다.');
        error.status = 409;
        throw error;
      }
      if (state.config.mode !== 'decision_council') {
        const currentCycleHarnessRevision = store.currentCycle()?.harnessRevision ?? null;
        if (currentCycleHarnessRevision === null
          || Number(currentCycleHarnessRevision) !== Number(state.harnessRevision)) {
          const error = new Error(
            `Harness revision changed after this plan was produced (plan: ${currentCycleHarnessRevision ?? 'none'}, current: ${state.harnessRevision}). Re-run the Council before approval.`,
          );
          error.status = 409;
          error.currentVersion = state.harnessRevision;
          throw error;
        }
      }
      state.phase = 'approved';
      state.approvedAt = new Date().toISOString();
      const cycle = store.currentCycle();
      if (cycle) cycle.status = 'approved';
      const decisionCouncil = state.config.mode === 'decision_council';
      publish({
        type: 'approved',
        role: 'system',
        message: decisionCouncil
          ? `Council 최종 판단 v${state.planVersion}을 승인했습니다.`
          : `통합 기획안 v${state.planVersion}을 승인했습니다. MVP 기획 루프가 종료됩니다.`,
      });
      res.json({ ok: true, phase: state.phase, planVersion: state.planVersion });
    } catch (error) { next(error); }
  });

  app.post('/api/cancel', (req, res, next) => {
    try {
      engine.cancel();
      res.status(202).json({ ok: true, phase: store.get().phase });
    } catch (error) { next(error); }
  });

  app.post('/api/retry', (req, res, next) => {
    try {
      const run = engine.retry();
      run.promise.catch(() => {});
      res.status(202).json({ ok: true, runId: run.runId, cycle: run.cycle, phase: store.get().phase });
    } catch (error) { next(error); }
  });

  app.use(express.static(path.join(__dirname, 'public'), {
    etag: true,
    maxAge: 0,
    setHeaders: (res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'");
    },
  }));

  app.use('/api', (req, res) => res.status(404).json({ error: { message: 'API 경로를 찾을 수 없습니다.' } }));

  app.use((error, req, res, next) => { // eslint-disable-line no-unused-vars
    const status = error.status || (error.name === 'ConfigValidationError' ? 400 : 400);
    if (error.retryAfter) res.setHeader('Retry-After', String(error.retryAfter));
    res.status(status).json({
      error: {
        name: error.name || 'Error',
        message: error.message || String(error),
        field: error.field,
        code: error.code,
        currentVersion: error.currentVersion,
      },
    });
  });

  app.locals.closeStreams = () => {
    for (const client of clients) { try { client.res.end(); } catch (_) {} }
    clients.clear();
  };
  return app;
}

function startServer({ host = config.host, port = config.port } = {}) {
  if (!isLoopback(host)) {
    throw new Error(`AI Council refuses non-loopback binding: ${host || '(empty)'}`);
  }
  const app = createApp();
  const server = app.listen(port, host, () => {
    console.log(`AI Council 실행 중: http://${host}:${port}`);
  });
  server.on('close', () => app.locals.closeStreams());
  return server;
}

if (require.main === module) startServer();

module.exports = { createApp, startServer, isLoopback, modelReadiness, preflight };
