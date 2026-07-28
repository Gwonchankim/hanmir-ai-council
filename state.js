'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('./config');
const { HarnessRevisionStore } = require('./lib/harness-revision-store');
const {
  ROLE_KEYS,
  clone: cloneHarnesses,
  defaultHarnessSet,
  normalizeHarnessSet,
  patchHarnessRole,
  roleToMarkdown,
  markdownToRole,
} = require('./harnesses');

const DATA_DIR = path.join(__dirname, 'data');
const SNAPSHOT = path.join(DATA_DIR, 'session.json');
const STATE_VERSION = 4;
// 세션당(=CLI 프로세스당) 하네스 재전송 캐시의 최대 보관 항목 수.
// 세션 ID 하나당 한 항목만 쓰므로 롱런 대화에서도 작게 유지된다.
const HARNESS_DELIVERY_MAX_ENTRIES = 64;
const RUNNING_PHASES = new Set([
  'harnessing', 'dispatching', 'drafting', 'critiquing', 'revising', 'synthesizing',
  'framing', 'independent_analysis', 'anonymous_peer_review', 'chair_synthesis',
]);
const PUBLIC_EVENT_TYPES = new Set([
  'status', 'stage', 'artifact', 'checkpoint', 'user', 'error', 'evaluation', 'approved', 'config',
]);
const SENSITIVE_PUBLIC_KEY = /^(?:thinking|reasoning|analysis|chain[_-]?of[_-]?thought|hidden[_-]?(?:reasoning|thoughts?)|internal[_-]?(?:reasoning|thoughts?)|raw[_-]?(?:prompt|response)|system[_-]?prompt)$/i;
const HARNESS_ROLE_FIELDS = Object.freeze([
  'mission', 'responsibilities', 'operatingRules', 'qualityChecks',
  'boundaries', 'outputContract', 'customInstructions',
]);

function now() { return new Date().toISOString(); }

function inferSessionTitle(source, fallback = 'New AI Council session') {
  if (source?.sessionTitle && source.sessionTitle !== 'New AI Council session') return source.sessionTitle;
  if (source?.title && source.title !== 'New AI Council session') return source.title;
  // 세션 제목은 "그 세션이 무엇을 하려던 것인가"이므로 최신 피드백이 아니라
  // 최초 지시를 쓴다. (reverse()를 쓰면 제목이 마지막 피드백으로 덮인다.)
  const firstUserMessage = Array.isArray(source?.transcript)
    ? source.transcript.find((event) => event?.role === 'user')?.message
    : null;
  const instruction = firstUserMessage || source?.lastInstruction;
  if (!instruction) return fallback;
  const normalized = String(instruction).replace(/\s+/g, ' ').trim();
  return normalized.length > 48 ? `${normalized.slice(0, 47)}…` : normalized;
}

function atomicWriteJson(filePath, value) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(value, null, 2), 'utf8');
  try {
    fs.renameSync(temp, filePath);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
    throw error;
  }
}

function publicProjection(value, depth = 0, seen = new WeakSet(), budget = { bytes: 0 }) {
  if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
  if (typeof value === 'string') {
    const remaining = Math.max(0, config.limits.publicProjectionBytes - budget.bytes);
    if (!remaining) return '[truncated]';
    const raw = Buffer.from(value, 'utf8');
    budget.bytes += Math.min(raw.length, remaining);
    return raw.length <= remaining ? value : `${raw.subarray(0, remaining).toString('utf8')}...[truncated]`;
  }
  if (depth >= config.limits.publicProjectionDepth) return '[max-depth]';
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.slice(0, 200).map((item) => publicProjection(item, depth + 1, seen, budget));
    seen.delete(value);
    return result;
  }
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 200)) {
    if (SENSITIVE_PUBLIC_KEY.test(key)) continue;
    if (budget.bytes >= config.limits.publicProjectionBytes) break;
    result[key] = publicProjection(item, depth + 1, seen, budget);
  }
  seen.delete(value);
  return result;
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function normalizeUsage(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const aliases = {
    input_tokens: 'inputTokens',
    inputTokens: 'inputTokens',
    output_tokens: 'outputTokens',
    outputTokens: 'outputTokens',
    cached_input_tokens: 'cachedInputTokens',
    cache_read_input_tokens: 'cacheReadInputTokens',
    cache_creation_input_tokens: 'cacheCreationInputTokens',
    total_cost_usd: 'costUsd',
    cost_usd: 'costUsd',
    duration_ms: 'durationMs',
  };
  const normalized = {};
  for (const [key, target] of Object.entries(aliases)) {
    const number = Number(value[key]);
    if (Number.isFinite(number) && number >= 0) normalized[target] = number;
  }
  return Object.keys(normalized).length ? normalized : null;
}

function defaultState(sessionConfig = config.cloneDefaults()) {
  const createdAt = now();
  return {
    stateVersion: STATE_VERSION,
    sessionKey: crypto.randomUUID(),
    sessionTitle: 'New AI Council session',
    archivedAt: null,
    metadataVersion: 1,
    config: config.normalizeSessionConfig(sessionConfig),
    sessions: { orchestrator: null, claudeWorker: null, codexWorker: null },
    routeSessions: {},
    routeHealth: {},
    sessionAudit: [],
    phase: 'idle',
    cycle: 0,
    round: 0,
    planVersion: 0,
    runId: null,
    eventSeq: 0,
    transcript: [],
    cycles: [],
    currentPlan: null,
    currentEvaluation: null,
    councilReports: [],
    lastInstruction: null,
    lastError: null,
    approvedAt: null,
    harnesses: defaultHarnessSet(0),
    harnessRevision: 0,
    harnessSource: 'default',
    harnessUpdatedAt: createdAt,
    harnessRoleVersions: { orchestrator: 0, claudeWorker: 0, codexWorker: 0 },
    harnessRoleMeta: {
      orchestrator: { updatedAt: createdAt, updatedBy: 'default' },
      claudeWorker: { updatedAt: createdAt, updatedBy: 'default' },
      codexWorker: { updatedAt: createdAt, updatedBy: 'default' },
    },
    harnessUserOverlays: { orchestrator: {}, claudeWorker: {}, codexWorker: {} },
    harnessHistory: [],
    // 역할별 CLI 세션이 "현재 하네스 리비전 전문을 이미 받았는지" 추적하는
    // 캐시. 키는 실제 CLI 세션/스레드 ID이므로 새 세션·fork·복구는 자동으로
    // 캐시 미스가 되어 전문이 다시 전달된다.
    harnessDelivery: {},
    // snapshot()이 호출될 때마다 증가하는 단조 카운터. per-session 파일과
    // legacy data/session.json 중 어느 쪽이 더 최근에 완료된 snapshot()
    // 호출을 반영하는지 재시작 시 판별하는 데 쓴다.
    snapshotSeq: 0,
    createdAt,
    updatedAt: createdAt,
  };
}

function sanitizeEvent(event) {
  if (!event || !PUBLIC_EVENT_TYPES.has(event.type)) return null;
  const clean = {
    id: Number(event.id),
    sessionId: typeof event.sessionId === 'string' ? event.sessionId : null,
    type: event.type,
    role: ['system', 'user', 'orchestrator', 'claude', 'codex'].includes(event.role) ? event.role : 'system',
    message: typeof event.message === 'string' ? event.message : '',
    timestamp: typeof event.timestamp === 'string' ? event.timestamp : now(),
  };
  clean.content = clean.message;
  for (const key of [
    'phase', 'cycle', 'round', 'planVersion', 'runId', 'artifactType', 'intent',
    'target', 'reference', 'logicalRole', 'routeIndex',
  ]) {
    if (event[key] !== undefined && event[key] !== null) clean[key] = event[key];
  }
  if (event.artifact && typeof event.artifact === 'object') clean.artifact = publicProjection(event.artifact);
  if (event.evaluation && typeof event.evaluation === 'object') clean.evaluation = publicProjection(event.evaluation);
  for (const key of ['modelRoute', 'fallback', 'circuit', 'usage']) {
    if (event[key] && typeof event[key] === 'object') clean[key] = publicProjection(event[key]);
  }
  return clean;
}

class StateStore {
  constructor({
    snapshotPath = SNAPSHOT,
    autoLoad = true,
    harnessRevisionStore = null,
    harnessRevisionRoot = null,
  } = {}) {
    this.snapshotPath = snapshotPath;
    this.dataDir = path.dirname(snapshotPath);
    this.sessionsDir = path.join(this.dataDir, 'sessions');
    this.registryPath = path.join(this.dataDir, 'sessions-index.json');
    this.harnessRevisionRoot = harnessRevisionRoot || path.join(this.dataDir, 'harness-revisions');
    this.harnessRevisionStore = harnessRevisionStore;
    this.registry = [];
    this.registryActiveId = null;
    this.state = defaultState();
    this._loadRegistry();
    if (autoLoad) this.load();
  }

  get() { return this.state; }

  isRunning() { return RUNNING_PHASES.has(this.state.phase); }

  _revisionStore() {
    if (!this.harnessRevisionStore) {
      this.harnessRevisionStore = new HarnessRevisionStore({ rootDir: this.harnessRevisionRoot });
    }
    return this.harnessRevisionStore;
  }

  _harnessStorageSessionId(sessionKey = this.state.sessionKey) {
    const value = String(sessionKey || '');
    return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)
      ? value
      : `legacy-${crypto.createHash('sha256').update(value).digest('hex')}`;
  }

  _snapshotFile(sessionKey) {
    const id = String(sessionKey || '');
    const name = /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(id)
      ? `${id}.json`
      : `legacy-${crypto.createHash('sha256').update(id).digest('hex')}.json`;
    return path.join(this.sessionsDir, name);
  }

  _loadRegistry() {
    if (!fs.existsSync(this.registryPath)) return this.registry;
    try {
      const parsed = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
      const entries = Array.isArray(parsed) ? parsed : parsed.sessions;
      this.registryActiveId = Array.isArray(parsed) ? null : (parsed.activeSessionId || null);
      this.registry = Array.isArray(entries)
        ? entries.filter((entry) => entry && typeof entry === 'object' && (entry.id || entry.sessionKey))
          .map((entry) => {
            const id = String(entry.id || entry.sessionKey);
            return {
              ...entry,
              id,
              sessionKey: id,
              archivedAt: typeof entry.archivedAt === 'string' && entry.archivedAt ? entry.archivedAt : null,
              metadataVersion: Math.max(1, Number(entry.metadataVersion) || 1),
            };
          })
          .slice(0, config.limits.sessionRegistryEntries)
        : [];
      for (const entry of this.registry) {
        const id = entry.id || entry.sessionKey;
        const file = this._snapshotFile(id);
        if (!fs.existsSync(file)) continue;
        try {
          const snapshot = JSON.parse(fs.readFileSync(file, 'utf8'));
          const snapshotVersion = Math.max(1, Number(snapshot.metadataVersion) || 1);
          if (snapshotVersion >= entry.metadataVersion) {
            entry.title = inferSessionTitle(snapshot, entry.title);
            entry.archivedAt = typeof snapshot.archivedAt === 'string' && snapshot.archivedAt
              ? snapshot.archivedAt
              : null;
            entry.metadataVersion = snapshotVersion;
            entry.updatedAt = snapshot.updatedAt || entry.updatedAt;
          } else if (!entry.title || entry.title === 'New AI Council session') {
            entry.title = inferSessionTitle(snapshot, entry.title);
          }
        } catch (_) {}
      }
    } catch (_) {
      this.registry = [];
    }
    return this.registry;
  }

  _writeRegistry() {
    atomicWriteJson(this.registryPath, {
      version: 2,
      activeSessionId: this.state.sessionKey,
      sessions: this.registry,
      updatedAt: now(),
    });
  }

  // snapshot()은 per-session 파일 -> registry -> legacy session.json 순으로
  // 개별 atomic write를 한다. 그 사이에 프로세스가 죽으면 legacy 파일이 옛
  // 내용으로 남을 수 있으므로, 두 파일 중 실제로 더 최근에 "완료"된
  // snapshot() 호출을 반영하는 쪽을 snapshotSeq(동률이면 updatedAt)로 고른다.
  _snapshotRecency(filePath) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return {
        seq: Math.max(0, Number(parsed?.snapshotSeq) || 0),
        updatedAt: Date.parse(parsed?.updatedAt || '') || 0,
        parsed,
      };
    } catch (_) {
      return { seq: -1, updatedAt: -1, parsed: null };
    }
  }

  _resolveLoadSource() {
    const legacyExists = fs.existsSync(this.snapshotPath);
    const perSessionPath = this.registryActiveId ? this._snapshotFile(this.registryActiveId) : null;
    const perSessionExists = Boolean(perSessionPath && fs.existsSync(perSessionPath));
    if (!legacyExists) return perSessionExists ? { path: perSessionPath } : null;
    if (!perSessionExists || perSessionPath === this.snapshotPath) return { path: this.snapshotPath };
    const perSession = this._snapshotRecency(perSessionPath);
    // 레지스트리가 가리키는 파일이 실제로 그 세션의 것인지 먼저 확인한다
    // (레지스트리 손상 대비). 신뢰할 수 없으면 legacy로 안전하게 되돌아간다.
    if (!perSession.parsed || perSession.parsed.sessionKey !== this.registryActiveId) {
      return { path: this.snapshotPath };
    }
    const legacy = this._snapshotRecency(this.snapshotPath);
    // legacy가 registryActiveId와 "같은 세션"을 담고 있을 때만 신선도를
    // 비교한다. activateSession()은 세션을 전환하는 도중 registry가 아직
    // 갱신되기 전에 legacy 파일에 다른(전환 대상) 세션의 내용을 의도적으로
    // 먼저 써 두고 load()가 그것을 그대로 읽기를 기대한다 -- 그 경우
    // legacy.sessionKey는 registryActiveId(옛 활성 세션)와 다르므로, 옛
    // 활성 세션의 per-session 파일로 되돌리지 않고 legacy를 그대로 신뢰한다.
    if (!legacy.parsed || legacy.parsed.sessionKey !== this.registryActiveId) {
      return { path: this.snapshotPath };
    }
    const perSessionIsNewer = perSession.seq !== legacy.seq
      ? perSession.seq > legacy.seq
      : perSession.updatedAt > legacy.updatedAt;
    return perSessionIsNewer ? { path: perSessionPath } : { path: this.snapshotPath };
  }

  load() {
    this._loadRegistry();
    const source = this._resolveLoadSource();
    if (!source) return this.state;
    if (source.path !== this.snapshotPath) {
      // per-session 스냅샷이 더 최근이다 -- crash 시점과 무관하게 가장 최근
      // 커밋된 상태로 복원되도록 legacy 파일을 즉시 같은 내용으로 치유한다.
      atomicWriteJson(this.snapshotPath, JSON.parse(fs.readFileSync(source.path, 'utf8')));
    }
    try {
      const parsed = JSON.parse(fs.readFileSync(this.snapshotPath, 'utf8'));
      const legacyRegistry = Array.isArray(parsed.sessionRegistry)
        ? parsed.sessionRegistry.filter((entry) => entry && typeof entry === 'object')
        : [];
      if (!parsed || (parsed.stateVersion && parsed.stateVersion > STATE_VERSION)) {
        // 구버전에는 내부 추론 이벤트가 저장될 수 있으므로 안전한 새 상태로 교체한다.
        this.state = defaultState();
        this.snapshot();
        return this.state;
      }
      const loadedConfig = config.normalizeSessionConfig(parsed.config);
      const base = defaultState(loadedConfig);
      const migratedTitle = inferSessionTitle(parsed, base.sessionTitle);
      let loadedHarnesses = base.harnesses;
      try {
        if (parsed.harnesses) {
          loadedHarnesses = normalizeHarnessSet(parsed.harnesses, {
            cycle: Number(parsed.cycle) || 0,
            current: base.harnesses,
          });
        }
      } catch (_) {
        loadedHarnesses = base.harnesses;
      }
      this.state = {
        ...base,
        ...parsed,
        stateVersion: STATE_VERSION,
        sessionKey: parsed.sessionKey || base.sessionKey,
        sessionTitle: migratedTitle,
        archivedAt: typeof parsed.archivedAt === 'string' && parsed.archivedAt ? parsed.archivedAt : null,
        metadataVersion: Math.max(1, Number(parsed.metadataVersion) || 1),
        config: loadedConfig,
        sessions: {
          orchestrator: parsed.sessions?.orchestrator || null,
          claudeWorker: parsed.sessions?.claudeWorker || null,
          codexWorker: parsed.sessions?.codexWorker || null,
        },
        routeSessions: parsed.routeSessions && typeof parsed.routeSessions === 'object'
          && !Array.isArray(parsed.routeSessions) ? parsed.routeSessions : {},
        routeHealth: parsed.routeHealth && typeof parsed.routeHealth === 'object'
          && !Array.isArray(parsed.routeHealth) ? parsed.routeHealth : {},
        snapshotSeq: Math.max(0, Number(parsed.snapshotSeq) || 0),
        harnessDelivery: parsed.harnessDelivery && typeof parsed.harnessDelivery === 'object'
          && !Array.isArray(parsed.harnessDelivery)
          ? Object.fromEntries(Object.entries(parsed.harnessDelivery)
            .filter(([key, value]) => typeof key === 'string' && value && typeof value === 'object'
              && /^[a-f0-9]{64}$/i.test(String(value.harnessDigest || '')))
            .map(([key, value]) => [key, {
              harnessDigest: String(value.harnessDigest).toLowerCase(),
              // cycle까지 복원해야 재시작 후에도 "이번 cycle에 이미 전달했다"를
              // 판단할 수 있다. 빠뜨리면 캐시가 항상 미스가 된다.
              cycle: Number.isFinite(Number(value.cycle)) ? Number(value.cycle) : null,
              role: typeof value.role === 'string' ? value.role : null,
              at: typeof value.at === 'string' ? value.at : now(),
            }])
            .slice(-HARNESS_DELIVERY_MAX_ENTRIES))
          : {},
        sessionAudit: Array.isArray(parsed.sessionAudit)
          ? parsed.sessionAudit.filter((entry) => entry && typeof entry === 'object')
            .slice(-config.limits.sessionAuditEntries)
          : [],
        transcript: Array.isArray(parsed.transcript)
          ? parsed.transcript.map((event) => sanitizeEvent({
            ...event, sessionId: event.sessionId || parsed.sessionKey || base.sessionKey,
          })).filter(Boolean).slice(-config.limits.transcriptEvents)
          : [],
        cycles: Array.isArray(parsed.cycles)
          ? parsed.cycles.filter((cycle) => cycle && typeof cycle === 'object' && !Array.isArray(cycle))
            .map((cycle) => ({
              ...cycle,
              artifacts: cycle.artifacts && typeof cycle.artifacts === 'object' && !Array.isArray(cycle.artifacts)
                ? cycle.artifacts
                : {},
            }))
            .slice(-config.limits.cycles)
          : [],
        councilReports: Array.isArray(parsed.councilReports)
          ? parsed.councilReports.filter((item) => item && typeof item === 'object').slice(-20)
          : [],
        harnesses: loadedHarnesses,
        harnessRevision: Math.max(0, Number(parsed.harnessRevision) || 0),
        harnessSource: parsed.harnessSource || (parsed.harnesses ? 'legacy' : 'default'),
        harnessUpdatedAt: parsed.harnessUpdatedAt || parsed.updatedAt || base.harnessUpdatedAt,
        harnessRoleVersions: Object.fromEntries(ROLE_KEYS.map((role) => [
          role,
          Math.max(0, Number(parsed.harnessRoleVersions?.[role]) || Number(parsed.harnessRevision) || 0),
        ])),
        harnessRoleMeta: Object.fromEntries(ROLE_KEYS.map((role) => [
          role,
          {
            updatedAt: parsed.harnessRoleMeta?.[role]?.updatedAt
              || parsed.harnessUpdatedAt || parsed.updatedAt || base.harnessUpdatedAt,
            updatedBy: parsed.harnessRoleMeta?.[role]?.updatedBy
              || parsed.harnessSource || (parsed.harnesses ? 'legacy' : 'default'),
          },
        ])),
        harnessUserOverlays: Object.fromEntries(ROLE_KEYS.map((role) => [
          role,
          Object.fromEntries(Object.entries(parsed.harnessUserOverlays?.[role] || {})
            .filter(([key]) => HARNESS_ROLE_FIELDS.includes(key))
            .map(([key, value]) => [key, cloneHarnesses(value)])),
        ])),
        harnessHistory: Array.isArray(parsed.harnessHistory)
          ? parsed.harnessHistory.filter((entry) => entry && typeof entry === 'object').map((entry) => ({
            revision: Math.max(0, Number(entry.revision) || 0),
            source: entry.source || 'legacy',
            cycle: Math.max(0, Number(entry.cycle) || 0),
            updatedAt: entry.updatedAt || parsed.updatedAt || base.updatedAt,
            changedRoles: Array.isArray(entry.changedRoles) ? entry.changedRoles.filter((role) => ROLE_KEYS.includes(role)) : ROLE_KEYS,
            digest: entry.digest || digest(entry.harnesses || loadedHarnesses),
          }))
            .slice(-config.limits.harnessHistoryEntries)
          : [],
      };
      delete this.state.sessionRegistry;
      const registeredMetadata = this.registry.find((entry) => (
        (entry.id || entry.sessionKey) === this.state.sessionKey
      ));
      if (registeredMetadata
        && Number(registeredMetadata.metadataVersion) > this.state.metadataVersion) {
        this.state.sessionTitle = inferSessionTitle(registeredMetadata, this.state.sessionTitle);
        this.state.archivedAt = registeredMetadata.archivedAt || null;
        this.state.metadataVersion = Math.max(1, Number(registeredMetadata.metadataVersion) || 1);
      }
      this.state.eventSeq = Math.max(
        Number(parsed.eventSeq) || 0,
        ...this.state.transcript.map((event) => Number(event.id) || 0),
      );
      for (const entry of legacyRegistry) {
        const id = entry.id || entry.sessionKey;
        if (!id || this.registry.some((item) => (item.id || item.sessionKey) === id)) continue;
        this.registry.push({ ...entry, id, sessionKey: id });
      }
      this.registry = this.registry.slice(0, config.limits.sessionRegistryEntries);
      if (RUNNING_PHASES.has(this.state.phase)) {
        this.state.phase = 'failed';
        this.state.runId = null;
        this.state.lastError = {
          stage: 'recovery', role: 'system', retryable: true,
          message: '이전 실행이 비정상 종료되었습니다. 저장된 체크포인트에서 재시도할 수 있습니다.',
          at: now(),
        };
      }
      this._syncSessionRegistry();
      return this.state;
    } catch (error) {
      this.state = defaultState();
      this.state.lastError = {
        stage: 'state_load', role: 'system', retryable: false,
        message: `저장 상태를 읽지 못해 새 세션으로 시작했습니다: ${error.message}`,
        at: now(),
      };
      return this.state;
    }
  }

  configure(input, { reset = true } = {}) {
    if (this.isRunning()) throw new Error('실행 중에는 설정을 변경할 수 없습니다.');
    const previous = this.state.config;
    const next = config.normalizeSessionConfig(input, previous);
    const changedRoles = ['orchestrator', 'claudeWorker', 'codexWorker'].filter((role) => (
      previous[role].brain !== next[role].brain
      || previous[role].model !== next[role].model
    ));
    if (reset) {
      this.snapshot();
      this.state = defaultState(next);
      this._syncSessionRegistry();
    } else {
      this.state.config = next;
      for (const role of changedRoles) this.state.sessions[role] = null;
    }
    this.touch();
    this.snapshot();
    return next;
  }

  resetConversation({ keepConfig = true } = {}) {
    const selected = keepConfig ? this.state.config : config.cloneDefaults();
    if (this.isRunning()) throw new Error('A running session cannot be reset.');
    this.snapshot();
    this.state = defaultState(selected);
    this._syncSessionRegistry();
    this.snapshot();
    return this.state;
  }

  activateSession(sessionKey) {
    if (this.isRunning()) {
      const error = new Error('A running session cannot be switched.');
      error.status = 409;
      throw error;
    }
    const id = String(sessionKey || '');
    const metadata = this.sessionMetadata(id);
    if (!metadata) {
      const error = new Error(`Unknown session: ${id}`);
      error.status = 404;
      throw error;
    }
    if (id === this.state.sessionKey) return this.state;
    const target = this._snapshotFile(id);
    if (!fs.existsSync(target)) {
      const error = new Error(`Session snapshot is missing: ${id}`);
      error.status = 410;
      throw error;
    }
    this.snapshot();
    const previousState = cloneHarnesses(this.state);
    const previousRegistry = cloneHarnesses(this.registry);
    const previousRegistryActiveId = this.registryActiveId;
    try {
      const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (!parsed || parsed.sessionKey !== id) throw new Error('Session snapshot identity mismatch.');
      if (parsed.stateVersion && parsed.stateVersion > STATE_VERSION) {
        throw new Error(`Unsupported session state version: ${parsed.stateVersion}`);
      }
      config.normalizeSessionConfig(parsed.config);
      if (parsed.harnesses) {
        normalizeHarnessSet(parsed.harnesses, {
          cycle: Math.max(0, Number(parsed.cycle) || 0),
          current: defaultHarnessSet(Math.max(0, Number(parsed.cycle) || 0)),
        });
      }
      atomicWriteJson(this.snapshotPath, parsed);
      this.load();
      if (this.state.sessionKey !== id) throw new Error('Session snapshot identity mismatch.');
      this.snapshot();
      return this.state;
    } catch (cause) {
      this.state = previousState;
      this.registry = previousRegistry;
      this.registryActiveId = previousRegistryActiveId;
      this._writeRegistry();
      atomicWriteJson(this.snapshotPath, previousState);
      const error = new Error(`Session activation failed: ${cause.message}`);
      error.status = 409;
      throw error;
    }
  }

  beginCycle(instruction, isFeedback) {
    if (this.isRunning()) throw new Error('이미 실행 중입니다.');
    const cycleNumber = this.state.cycle + 1;
    const cycle = {
      id: crypto.randomUUID(),
      number: cycleNumber,
      isFeedback: Boolean(isFeedback),
      instruction,
      priorPlanVersion: this.state.planVersion,
      priorHarnessRevision: this.state.harnessRevision,
      harnessRevision: null,
      status: 'running',
      stage: 'harnessing',
      artifacts: {},
      startedAt: now(),
      completedAt: null,
    };
    this.state.cycle = cycleNumber;
    this.state.round = 0;
    this.state.runId = crypto.randomUUID();
    this.state.phase = 'harnessing';
    this.state.lastInstruction = instruction;
    if (this.state.sessionTitle === 'New AI Council session') {
      this.state.sessionTitle = instruction.replace(/\s+/g, ' ').slice(0, 80) || this.state.sessionTitle;
    }
    this.state.lastError = null;
    this.state.currentEvaluation = null;
    this.state.approvedAt = null;
    this.state.cycles.push(cycle);
    this.state.cycles = this.state.cycles.slice(-config.limits.cycles);
    this.touch();
    this.snapshot();
    return cycle;
  }

  currentCycle() {
    return this.state.cycles[this.state.cycles.length - 1] || null;
  }

  _metadataForCurrentSession() {
    const s = this.state;
    return {
      id: s.sessionKey,
      sessionKey: s.sessionKey,
      title: s.sessionTitle || 'AI Council session',
      archivedAt: s.archivedAt || null,
      metadataVersion: Math.max(1, Number(s.metadataVersion) || 1),
      phase: s.phase,
      cycle: s.cycle,
      planVersion: s.planVersion,
      harnessRevision: s.harnessRevision || 0,
      harnessSource: s.harnessSource || 'default',
      orchestrator: cloneHarnesses(s.config.orchestrator),
      hasPlan: Boolean(s.currentPlan),
      lastInstruction: s.lastInstruction ? String(s.lastInstruction).replace(/\s+/g, ' ').slice(0, 160) : null,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      approvedAt: s.approvedAt || null,
    };
  }

  _syncSessionRegistry() {
    if (!this.state || !this.state.sessionKey) return;
    const metadata = this._metadataForCurrentSession();
    const index = this.registry.findIndex((entry) => (entry.id || entry.sessionKey) === metadata.id);
    // 목록 순서는 사용자가 소유한다. updatedAt으로 다시 정렬하면 세션을 열기만 해도
    // 그 세션이 맨 위로 튀어 목록이 계속 재배치된다. 기존 항목은 제자리에서
    // 갱신하고, 새 세션만 맨 앞에 넣는다. 순서 변경은 moveSession()으로만 한다.
    if (index >= 0) this.registry[index] = metadata;
    else this.registry.unshift(metadata);
    this.registry = this.registry.slice(0, config.limits.sessionRegistryEntries);
  }

  // 목록에서 세션을 한 칸 위/아래로 옮긴다. 경계에서는 아무 일도 하지 않는다.
  moveSession(sessionKey, direction) {
    const id = String(sessionKey || '');
    const step = direction === 'up' ? -1 : 1;
    if (direction !== 'up' && direction !== 'down') {
      const error = new Error('이동 방향은 up 또는 down이어야 합니다.');
      error.status = 400;
      throw error;
    }
    this._syncSessionRegistry();
    const index = this.registry.findIndex((entry) => (entry.id || entry.sessionKey) === id);
    if (index < 0) {
      const error = new Error(`세션을 찾을 수 없습니다: ${id}`);
      error.status = 404;
      throw error;
    }
    const target = index + step;
    if (target < 0 || target >= this.registry.length) return this.listSessions({ scope: 'all' });
    const [entry] = this.registry.splice(index, 1);
    this.registry.splice(target, 0, entry);
    this._writeRegistry();
    return this.listSessions({ scope: 'all' });
  }

  listSessions({ q = '', scope = 'active' } = {}) {
    this._syncSessionRegistry();
    const query = String(q || '').trim().toLocaleLowerCase();
    const normalizedScope = ['active', 'archived', 'all'].includes(scope) ? scope : 'active';
    return this.registry.filter((entry) => {
      const archived = Boolean(entry.archivedAt);
      if (normalizedScope === 'active' && archived) return false;
      if (normalizedScope === 'archived' && !archived) return false;
      if (!query) return true;
      return String(entry.title || '').toLocaleLowerCase().includes(query);
    }).map((entry) => ({
      ...cloneHarnesses(entry),
      active: (entry.id || entry.sessionKey) === this.state.sessionKey,
      current: (entry.id || entry.sessionKey) === this.state.sessionKey,
    }));
  }

  sessionMetadata(sessionKey) {
    this._syncSessionRegistry();
    const found = this.registry.find((entry) => (entry.id || entry.sessionKey) === sessionKey);
    return found ? {
      ...cloneHarnesses(found),
      active: sessionKey === this.state.sessionKey,
      current: sessionKey === this.state.sessionKey,
    } : null;
  }

  updateSessionMetadata(sessionKey, patch, { expectedVersion } = {}) {
    const id = String(sessionKey || '');
    const current = this.sessionMetadata(id);
    if (!current) {
      const error = new Error(`Unknown session: ${id}`);
      error.status = 404;
      throw error;
    }
    const version = Math.max(1, Number(current.metadataVersion) || 1);
    if (!Number.isInteger(Number(expectedVersion)) || Number(expectedVersion) !== version) {
      const error = new Error(`Session metadata changed. Current version is ${version}.`);
      error.status = Number.isInteger(Number(expectedVersion)) ? 409 : 428;
      error.currentVersion = version;
      throw error;
    }
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
      const error = new Error('Session metadata patch must be an object.');
      error.status = 400;
      throw error;
    }
    const allowed = new Set(['title', 'archived']);
    const unknown = Object.keys(patch).filter((key) => !allowed.has(key));
    if (unknown.length) {
      const error = new Error(`Unsupported session metadata field: ${unknown[0]}`);
      error.status = 400;
      error.field = unknown[0];
      throw error;
    }
    if (!Object.hasOwn(patch, 'title') && !Object.hasOwn(patch, 'archived')) {
      const error = new Error('Provide title or archived.');
      error.status = 400;
      throw error;
    }
    if (id === this.state.sessionKey && this.isRunning()) {
      const error = new Error('A running session cannot be renamed or archived.');
      error.status = 409;
      throw error;
    }

    let title = current.title || 'AI Council session';
    if (Object.hasOwn(patch, 'title')) {
      title = String(patch.title || '').replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ').trim();
      if (!title) {
        const error = new Error('Session title cannot be empty.');
        error.status = 400;
        error.field = 'title';
        throw error;
      }
      if (title.length > 120) {
        const error = new Error('Session title must be 120 characters or fewer.');
        error.status = 400;
        error.field = 'title';
        throw error;
      }
    }
    const archivedAt = Object.hasOwn(patch, 'archived')
      ? (patch.archived === true ? (current.archivedAt || now()) : null)
      : (current.archivedAt || null);
    if (Object.hasOwn(patch, 'archived') && typeof patch.archived !== 'boolean') {
      const error = new Error('archived must be a boolean.');
      error.status = 400;
      error.field = 'archived';
      throw error;
    }
    if (title === current.title && archivedAt === (current.archivedAt || null)) return current;

    const updatedAt = now();
    const metadataVersion = version + 1;
    if (id === this.state.sessionKey) {
      this.state.sessionTitle = title;
      this.state.archivedAt = archivedAt;
      this.state.metadataVersion = metadataVersion;
      this.state.updatedAt = updatedAt;
      this.snapshot();
      return this.sessionMetadata(id);
    }

    const file = this._snapshotFile(id);
    if (!fs.existsSync(file)) {
      const error = new Error(`Session snapshot is missing: ${id}`);
      error.status = 410;
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (cause) {
      const error = new Error(`Session snapshot cannot be read: ${cause.message}`);
      error.status = 409;
      throw error;
    }
    if (!parsed || parsed.sessionKey !== id) {
      const error = new Error('Session snapshot identity mismatch.');
      error.status = 409;
      throw error;
    }
    parsed.sessionTitle = title;
    parsed.archivedAt = archivedAt;
    parsed.metadataVersion = metadataVersion;
    parsed.updatedAt = updatedAt;
    atomicWriteJson(file, parsed);
    const index = this.registry.findIndex((entry) => (entry.id || entry.sessionKey) === id);
    this.registry[index] = {
      ...this.registry[index], title, archivedAt, metadataVersion, updatedAt,
    };
    // 이름 변경·보관도 목록 순서를 건드리지 않는다(순서는 moveSession 전용).
    this._writeRegistry();
    return this.sessionMetadata(id);
  }

  sessionEvents(sessionKey) {
    const id = String(sessionKey || '');
    if (!this.sessionMetadata(id)) return null;
    if (id === this.state.sessionKey) return this.state.transcript.map((event) => cloneHarnesses(event));
    const file = this._snapshotFile(id);
    if (!fs.existsSync(file)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed.transcript)
        ? parsed.transcript.map((event) => sanitizeEvent({ ...event, sessionId: id })).filter(Boolean)
        : [];
    } catch (_) {
      return null;
    }
  }

  _ensureCurrentHarnessRevisionSeeded() {
    const currentHistory = this.state.harnessHistory.find((entry) => (
      Number(entry.revision) === Number(this.state.harnessRevision)
    ));
    return this._revisionStore().seedLegacyCurrent({
      sessionId: this._harnessStorageSessionId(),
      revision: this.state.harnessRevision,
      harnesses: this.state.harnesses,
      source: currentHistory?.source || this.state.harnessSource || 'legacy-seed',
      cycle: Math.max(0, Number(this.state.harnesses?.cycle) || Number(this.state.cycle) || 0),
      updatedAt: this.state.harnessUpdatedAt || this.state.updatedAt,
      changedRoles: currentHistory?.changedRoles || ROLE_KEYS,
    });
  }

  _knownHarnessRevisions() {
    const known = new Set([
      Math.max(0, Number(this.state.harnessRevision) || 0),
      ...this.state.harnessHistory.map((entry) => Math.max(0, Number(entry.revision) || 0)),
    ]);
    for (const entry of this._revisionStore().listRevisions(this._harnessStorageSessionId())) {
      if (entry.revision <= this.state.harnessRevision) known.add(entry.revision);
    }
    return known;
  }

  _assertKnownHarnessRevision(revision) {
    const value = Number(revision);
    if (!Number.isSafeInteger(value) || value < 0) {
      const error = new Error('Harness revision must be a non-negative integer.');
      error.status = 400;
      error.field = 'revision';
      throw error;
    }
    if (!this._knownHarnessRevisions().has(value)) {
      const error = new Error(`Harness revision ${value} is not part of the active session history.`);
      error.status = 404;
      throw error;
    }
    return value;
  }

  getHarnessHistory() {
    this._ensureCurrentHarnessRevisionSeeded();
    const known = this._knownHarnessRevisions();
    const revisions = this._revisionStore().listRevisions(this._harnessStorageSessionId(), {
      history: this.state.harnessHistory,
    }).filter((entry) => known.has(entry.revision)).map((entry) => ({
      ...cloneHarnesses(entry),
      sessionId: this.state.sessionKey,
    }));
    return {
      sessionId: this.state.sessionKey,
      currentRevision: this.state.harnessRevision,
      revisions,
    };
  }

  diffHarnessRevisions(fromRevision, toRevision, { role = 'all' } = {}) {
    this._ensureCurrentHarnessRevisionSeeded();
    const from = this._assertKnownHarnessRevision(fromRevision);
    const to = this._assertKnownHarnessRevision(toRevision);
    const result = this._revisionStore().diffRevisions(
      this._harnessStorageSessionId(), from, to, { role },
    );
    return { ...result, sessionId: this.state.sessionKey };
  }

  _harnessView(role) {
    const meta = this.state.harnessRoleMeta?.[role] || {};
    return {
      role,
      content: roleToMarkdown(this.state.harnesses[role]),
      version: Math.max(0, Number(this.state.harnessRoleVersions?.[role]) || 0),
      updatedAt: meta.updatedAt || this.state.harnessUpdatedAt,
      updatedBy: meta.updatedBy || this.state.harnessSource,
      lockedFields: Object.keys(this.state.harnessUserOverlays?.[role] || {}),
    };
  }

  getHarnessState({ includeStructured = false } = {}) {
    const harnesses = Object.fromEntries(ROLE_KEYS.map((role) => [role, this._harnessView(role)]));
    return {
      sessionId: this.state.sessionKey,
      sessionKey: this.state.sessionKey,
      revision: this.state.harnessRevision,
      source: this.state.harnessSource,
      updatedAt: this.state.harnessUpdatedAt,
      harnesses,
      ...(includeStructured ? { structuredHarnesses: cloneHarnesses(this.state.harnesses) } : {}),
      history: this.state.harnessHistory.map((entry) => cloneHarnesses(entry)),
    };
  }

  replaceHarnesses(input, {
    source = 'user',
    expectedRevision,
    cycle = this.state.cycle,
    requireAll = true,
    changedRoles,
    lockChangedFields = false,
  } = {}) {
    if ((source === 'user' || lockChangedFields) && this.isRunning()) {
      const error = new Error('Harnesses cannot be edited while a Council run is active.');
      error.status = 409;
      throw error;
    }
    if ((source === 'user' || lockChangedFields) && this.state.archivedAt) {
      const error = new Error('Archived sessions are read-only. Restore the session before editing Harnesses.');
      error.status = 423;
      throw error;
    }
    if (expectedRevision !== undefined && Number(expectedRevision) !== this.state.harnessRevision) {
      const error = new Error(`Harness revision changed. Current revision is ${this.state.harnessRevision}.`);
      error.status = 409;
      error.currentVersion = this.state.harnessRevision;
      throw error;
    }
    this._ensureCurrentHarnessRevisionSeeded();
    let next = normalizeHarnessSet(input, {
      cycle: Number.isInteger(cycle) && cycle >= 0 ? cycle : this.state.cycle,
      current: this.state.harnesses,
      requireAll,
    });
    if (source === 'orchestrator') {
      const withUserOverlays = cloneHarnesses(next);
      for (const role of ROLE_KEYS) {
        for (const [field, value] of Object.entries(this.state.harnessUserOverlays?.[role] || {})) {
          if (!HARNESS_ROLE_FIELDS.includes(field)) continue;
          if (value === null) delete withUserOverlays[role][field];
          else withUserOverlays[role][field] = cloneHarnesses(value);
        }
      }
      next = normalizeHarnessSet(withUserOverlays, {
        cycle: next.cycle,
        current: this.state.harnesses,
        requireAll: true,
      });
    }
    const nextUserOverlays = cloneHarnesses(this.state.harnessUserOverlays);
    if (source === 'user' || lockChangedFields) {
      for (const role of ROLE_KEYS) {
        if (!nextUserOverlays[role]) nextUserOverlays[role] = {};
        for (const field of HARNESS_ROLE_FIELDS) {
          const beforeHas = Object.hasOwn(this.state.harnesses[role], field);
          const afterHas = Object.hasOwn(next[role], field);
          const beforeValue = beforeHas ? JSON.stringify(this.state.harnesses[role][field]) : undefined;
          const afterValue = afterHas ? JSON.stringify(next[role][field]) : undefined;
          if (beforeValue === afterValue) continue;
          nextUserOverlays[role][field] = afterHas ? cloneHarnesses(next[role][field]) : null;
        }
      }
    }
    const beforeDigests = Object.fromEntries(ROLE_KEYS.map((role) => [role, digest(this.state.harnesses[role])]));
    let changed = Array.isArray(changedRoles)
      ? changedRoles.filter((role) => ROLE_KEYS.includes(role))
      : ROLE_KEYS.filter((role) => beforeDigests[role] !== digest(next[role]));
    if (source === 'orchestrator' && !changed.length) changed = [...ROLE_KEYS];
    if (!changed.length) changed = [...ROLE_KEYS];
    const nextRevision = this.state.harnessRevision + 1;
    const persisted = this._revisionStore().saveRevision({
      sessionId: this._harnessStorageSessionId(),
      revision: nextRevision,
      harnesses: next,
      source,
      cycle: next.cycle,
      changedRoles: changed,
    });
    const previousState = cloneHarnesses(this.state);
    const previousRegistry = cloneHarnesses(this.registry);
    const previousRegistryActiveId = this.registryActiveId;
    try {
      this.state.harnessRevision = nextRevision;
      this.state.harnesses = next;
      this.state.harnessSource = source;
      this.state.harnessUpdatedAt = persisted.record.updatedAt;
      this.state.harnessUserOverlays = nextUserOverlays;
      for (const role of changed) {
        this.state.harnessRoleVersions[role] = Math.max(0, Number(this.state.harnessRoleVersions[role]) || 0) + 1;
        this.state.harnessRoleMeta[role] = { updatedAt: this.state.harnessUpdatedAt, updatedBy: source };
      }
      this.state.harnessHistory.push({
        revision: nextRevision,
        source,
        cycle: next.cycle,
        updatedAt: this.state.harnessUpdatedAt,
        changedRoles: changed,
        digest: persisted.record.digest,
      });
      this.state.harnessHistory = this.state.harnessHistory.slice(-config.limits.harnessHistoryEntries);
      const activeCycle = this.currentCycle();
      if (source === 'orchestrator' && activeCycle && activeCycle.number === next.cycle) {
        activeCycle.harnessRevision = nextRevision;
      }
      this.touch();
      this.snapshot();
    } catch (error) {
      this.state = previousState;
      this.registry = previousRegistry;
      this.registryActiveId = previousRegistryActiveId;
      try { this.snapshot(); } catch (_) {}
      throw error;
    }
    return this.getHarnessState();
  }

  rollbackHarnesses(targetRevision, { role = 'all', expectedRevision } = {}) {
    if (this.isRunning()) {
      const error = new Error('Harness rollback is unavailable while a Council run is active.');
      error.status = 409;
      throw error;
    }
    if (this.state.archivedAt) {
      const error = new Error('Archived sessions are read-only. Restore the session before rolling back Harnesses.');
      error.status = 423;
      throw error;
    }
    if (expectedRevision === undefined) {
      const error = new Error('If-Match with the current Harness revision is required.');
      error.status = 428;
      throw error;
    }
    if (Number(expectedRevision) !== this.state.harnessRevision) {
      const error = new Error(`Harness revision changed. Current revision is ${this.state.harnessRevision}.`);
      error.status = 409;
      error.currentVersion = this.state.harnessRevision;
      throw error;
    }
    if (role !== 'all' && !ROLE_KEYS.includes(role)) {
      const error = new Error(`role must be "all" or one of: ${ROLE_KEYS.join(', ')}.`);
      error.status = 400;
      error.field = 'role';
      throw error;
    }
    this._ensureCurrentHarnessRevisionSeeded();
    const revision = this._assertKnownHarnessRevision(targetRevision);
    const historical = this._revisionStore().getRevision(this._harnessStorageSessionId(), revision);
    const next = role === 'all'
      ? { ...cloneHarnesses(historical.harnesses), cycle: this.state.cycle }
      : {
        ...cloneHarnesses(this.state.harnesses),
        cycle: this.state.cycle,
        [role]: cloneHarnesses(historical.harnesses[role]),
      };
    const selectedRoles = role === 'all' ? ROLE_KEYS : [role];
    for (const selectedRole of selectedRoles) {
      for (const [field, value] of Object.entries(
        this.state.harnessUserOverlays?.[selectedRole] || {},
      )) {
        if (!HARNESS_ROLE_FIELDS.includes(field)) continue;
        if (value === null) delete next[selectedRole][field];
        else next[selectedRole][field] = cloneHarnesses(value);
      }
    }
    const normalized = normalizeHarnessSet(next, {
      cycle: this.state.cycle,
      current: this.state.harnesses,
      requireAll: true,
    });
    const roles = selectedRoles;
    const changed = roles.filter((key) => digest(this.state.harnesses[key]) !== digest(normalized[key]));
    const rationaleChanged = role === 'all' && this.state.harnesses.rationale !== normalized.rationale;
    if (!changed.length && !rationaleChanged) {
      const error = new Error(`Harness revision ${revision} is identical to the selected current content.`);
      error.status = 409;
      error.code = 'HARNESS_ROLLBACK_NOOP';
      throw error;
    }
    const fromRevision = this.state.harnessRevision;
    const payload = this.replaceHarnesses(normalized, {
      source: `rollback:r${revision}:${role}`,
      expectedRevision,
      cycle: this.state.cycle,
      requireAll: true,
      changedRoles: changed.length ? changed : roles,
      lockChangedFields: true,
    });
    return {
      ...payload,
      rollback: {
        fromRevision,
        targetRevision: revision,
        newRevision: payload.revision,
        role,
        changedRoles: changed.length ? changed : roles,
      },
    };
  }

  patchHarness(role, patch, { source = 'user', expectedRevision, expectedRoleVersion } = {}) {
    if (!ROLE_KEYS.includes(role)) {
      const error = new Error(`Unknown harness role: ${role}`);
      error.status = 404;
      throw error;
    }
    if (expectedRoleVersion !== undefined
      && Number(expectedRoleVersion) !== this.state.harnessRoleVersions[role]) {
      const error = new Error(`Harness role version changed. Current ${role} version is ${this.state.harnessRoleVersions[role]}.`);
      error.status = 409;
      throw error;
    }
    const next = patchHarnessRole(this.state.harnesses, role, patch, { cycle: this.state.cycle });
    return this.replaceHarnesses(next, {
      source,
      expectedRevision,
      cycle: this.state.cycle,
      requireAll: true,
      changedRoles: [role],
    });
  }

  updateHarnessContent(role, content, {
    source = 'user', expectedRevision, expectedRoleVersion,
  } = {}) {
    if (!ROLE_KEYS.includes(role)) {
      const error = new Error(`Unknown harness role: ${role}`);
      error.status = 404;
      throw error;
    }
    const nextRole = markdownToRole(content, this.state.harnesses[role]);
    const result = this.patchHarness(role, nextRole, {
      source,
      expectedRevision,
      expectedRoleVersion,
    });
    return { ...result, harness: result.harnesses[role] };
  }

  appendEvent(event) {
    if (!event || !PUBLIC_EVENT_TYPES.has(event.type)) {
      throw new Error(`공개할 수 없는 이벤트 유형입니다: ${event?.type || '(없음)'}`);
    }
    const envelope = sanitizeEvent({
      ...event,
      id: ++this.state.eventSeq,
      sessionId: this.state.sessionKey,
      timestamp: now(),
      phase: event.phase ?? this.state.phase,
      cycle: event.cycle ?? this.state.cycle,
      round: event.round ?? this.state.round,
      planVersion: event.planVersion ?? this.state.planVersion,
      runId: event.runId ?? this.state.runId,
    });
    this.state.transcript.push(envelope);
    this.state.transcript = this.state.transcript.slice(-config.limits.transcriptEvents);
    this.touch();
    return envelope;
  }

  recordSessionInvocation({
    role, artifactType, attempt, previousSession, returnedSession, execution, promptBinding,
    brain, model, effort, routeIndex = 0, fallbackFrom = null, usage = null,
  }) {
    const entry = {
      role,
      artifactType,
      attempt,
      brain: brain || execution?.provider || null,
      model: model || execution?.model || null,
      effort: effort || execution?.effort || null,
      routeIndex: Number(routeIndex) || 0,
      fallbackFrom: fallbackFrom && typeof fallbackFrom === 'object' ? {
        brain: fallbackFrom.brain || null,
        model: fallbackFrom.model || null,
        effort: fallbackFrom.effort || null,
      } : null,
      previousSession: previousSession || null,
      returnedSession,
      continuity: previousSession
        ? (previousSession === returnedSession
          ? 'resumed_same'
          : execution?.forked && execution?.recovery === 'fork_session'
            ? 'forked_recovery'
            : execution?.freshRecovery && execution?.recovery === 'fresh_session_after_fork_failure'
              ? 'fresh_recovery'
            : 'replaced')
        : 'started',
      cycle: this.state.cycle,
      round: this.state.round,
      usage: normalizeUsage(usage),
      execution: execution && typeof execution === 'object' ? {
        provider: execution.provider || null,
        executable: execution.executable || null,
        exitCode: Number.isInteger(execution.exitCode) ? execution.exitCode : null,
        completionEvent: execution.completionEvent || null,
        resumed: Boolean(execution.resumed),
        model: execution.model || null,
        effort: execution.effort || null,
        forked: Boolean(execution.forked),
        freshRecovery: Boolean(execution.freshRecovery),
        recovery: execution.recovery || null,
      } : null,
      promptBinding: promptBinding && typeof promptBinding === 'object' ? {
        harnessRevision: Number.isSafeInteger(Number(promptBinding.harnessRevision))
          ? Number(promptBinding.harnessRevision) : null,
        harnessDigest: /^[a-f0-9]{64}$/i.test(String(promptBinding.harnessDigest || ''))
          ? String(promptBinding.harnessDigest).toLowerCase() : null,
        promptHarnessDigest: /^[a-f0-9]{64}$/i.test(String(promptBinding.promptHarnessDigest || ''))
          ? String(promptBinding.promptHarnessDigest).toLowerCase() : null,
        included: promptBinding.included === true,
      } : null,
      at: now(),
    };
    this.state.sessionAudit.push(entry);
    this.state.sessionAudit = this.state.sessionAudit.slice(-config.limits.sessionAuditEntries);
    this.touch();
    this.snapshot();
    return entry;
  }

  openRouteCircuit(route, classification = {}) {
    const scope = classification.scope === 'provider' ? 'provider' : 'route';
    const key = scope === 'provider'
      ? `provider:${route.brain}`
      : `route:${route.brain}:${route.model}:${route.effort}`;
    const previous = this.state.routeHealth?.[key] || {};
    const openedAt = now();
    this.state.routeHealth ||= {};
    this.state.routeHealth[key] = {
      key,
      scope,
      brain: route.brain,
      model: scope === 'route' ? route.model : null,
      effort: scope === 'route' ? route.effort : null,
      reason: classification.reason || 'provider_limit_or_availability',
      failureCount: Math.max(0, Number(previous.failureCount) || 0) + 1,
      openedAt,
      openUntil: new Date(Date.now() + config.limits.modelCircuitCooldownMs).toISOString(),
    };
    this.touch();
    this.snapshot();
    return this.state.routeHealth[key];
  }

  closeRouteCircuit(route) {
    if (!this.state.routeHealth) return;
    delete this.state.routeHealth[`route:${route.brain}:${route.model}:${route.effort}`];
    this.touch();
  }

  // 특정 CLI 세션이 주어진 하네스 digest를 이미 전달받았는지 확인한다.
  // 세션 ID 자체가 키이므로 새 세션·fork·복구는 자동으로 미스가 된다.
  // cycle을 키에 포함한다. 증거 게이트(CF_HARNESS_PROTOCOL)는 각 cycle에서 역할마다
  // "프롬프트에 하네스 전문이 실렸다"는 digest 증거를 최소 한 건 요구한다. 세션과
  // digest만으로 캐시하면 이어지는 cycle의 모든 호출이 캐시 히트가 되어 그 증거가
  // 한 건도 남지 않는다. cycle마다 첫 호출은 전문을 보내고 이후만 참조로 줄인다.
  hasHarnessDelivery(sessionId, harnessDigest, cycle = null) {
    if (!sessionId || !harnessDigest) return false;
    const record = this.state.harnessDelivery?.[sessionId];
    return Boolean(record
      && record.harnessDigest === harnessDigest
      && Number(record.cycle) === Number(cycle));
  }

  recordHarnessDelivery(sessionId, harnessDigest, role = null, cycle = null) {
    if (!sessionId || !harnessDigest) return;
    this.state.harnessDelivery ||= {};
    this.state.harnessDelivery[sessionId] = { harnessDigest, cycle: Number(cycle), role, at: now() };
    const keys = Object.keys(this.state.harnessDelivery);
    if (keys.length > HARNESS_DELIVERY_MAX_ENTRIES) {
      const oldestFirst = keys.sort((a, b) => (
        String(this.state.harnessDelivery[a].at).localeCompare(String(this.state.harnessDelivery[b].at))
      ));
      for (const key of oldestFirst.slice(0, keys.length - HARNESS_DELIVERY_MAX_ENTRIES)) {
        delete this.state.harnessDelivery[key];
      }
    }
  }

  touch() {
    this.state.updatedAt = now();
    this._syncSessionRegistry();
  }

  snapshot() {
    this._syncSessionRegistry();
    // 단조 카운터: per-session 파일과 legacy session.json이 같은 호출에서
    // 동일한 seq로 쓰인다. 재시작 시 두 파일 중 하나가 이전 호출의 옛
    // 내용으로 남아 있으면(비원자적 3-파일 쓰기) load()가 이 값으로 더
    // 최근에 완료된 쪽을 가려낸다.
    this.state.snapshotSeq = Math.max(0, Number(this.state.snapshotSeq) || 0) + 1;
    const serializable = { ...this.state };
    delete serializable.sessionRegistry;
    atomicWriteJson(this._snapshotFile(this.state.sessionKey), serializable);
    this.registryActiveId = this.state.sessionKey;
    this._writeRegistry();
    atomicWriteJson(this.snapshotPath, serializable);
  }

  publicState() {
    const s = this.state;
    const currentCycleHarnessRevision = this.currentCycle()?.harnessRevision ?? null;
    const harnessPlanStale = s.config.mode !== 'decision_council' && Boolean(s.currentPlan)
      && (!Number.isSafeInteger(Number(currentCycleHarnessRevision))
        || currentCycleHarnessRevision === null
        || Number(currentCycleHarnessRevision) !== Number(s.harnessRevision));
    const dto = {
      stateVersion: s.stateVersion,
      sessionId: s.sessionKey,
      sessionKey: s.sessionKey,
      sessionTitle: s.sessionTitle,
      archivedAt: s.archivedAt || null,
      metadataVersion: Math.max(1, Number(s.metadataVersion) || 1),
      config: s.config,
      phase: s.phase,
      cycle: s.cycle,
      round: s.round,
      planVersion: s.planVersion,
      currentPlan: s.currentPlan,
      requiredQuestions: s.currentPlan?.requiredQuestions || [],
      optionalQuestions: s.currentPlan?.optionalQuestions || [],
      currentEvaluation: s.currentEvaluation,
      councilReports: s.councilReports || [],
      lastError: s.lastError,
      approvedAt: s.approvedAt,
      harnesses: this.getHarnessState().harnesses,
      harnessRevision: s.harnessRevision,
      currentCycleHarnessRevision,
      harnessPlanStale,
      harnessSource: s.harnessSource,
      harnessUpdatedAt: s.harnessUpdatedAt,
      sessionContinuity: {
        orchestrator: Boolean(s.sessions.orchestrator),
        claudeWorker: Boolean(s.sessions.claudeWorker),
        codexWorker: Boolean(s.sessions.codexWorker),
        resumedCalls: (s.sessionAudit || []).filter((entry) => entry.continuity === 'resumed_same').length,
        replacedCalls: (s.sessionAudit || []).filter((entry) => entry.continuity === 'replaced').length,
      },
      modelRouting: {
        mode: s.config.mode || 'planning',
        fallbackCount: (s.sessionAudit || []).filter((entry) => Number(entry.routeIndex) > 0).length,
        totals: (s.sessionAudit || []).reduce((totals, entry) => {
          totals.calls += 1;
          totals.inputTokens += Number(entry.usage?.inputTokens) || 0;
          totals.outputTokens += Number(entry.usage?.outputTokens) || 0;
          totals.cachedInputTokens += Number(entry.usage?.cachedInputTokens) || 0;
          totals.cacheReadInputTokens += Number(entry.usage?.cacheReadInputTokens) || 0;
          totals.cacheCreationInputTokens += Number(entry.usage?.cacheCreationInputTokens) || 0;
          totals.costUsd += Number(entry.usage?.costUsd) || 0;
          totals.durationMs += Number(entry.usage?.durationMs) || 0;
          return totals;
        }, {
          calls: 0, inputTokens: 0, outputTokens: 0, cachedInputTokens: 0,
          cacheReadInputTokens: 0, cacheCreationInputTokens: 0, costUsd: 0, durationMs: 0,
        }),
        circuits: Object.values(s.routeHealth || {}).filter((entry) => (
          Date.parse(entry?.openUntil || '') > Date.now()
        )),
        latest: (s.sessionAudit || []).slice(-20).map((entry) => ({
          role: entry.role,
          artifactType: entry.artifactType,
          brain: entry.brain || entry.execution?.provider || null,
          model: entry.model || entry.execution?.model || null,
          effort: entry.effort || entry.execution?.effort || null,
          routeIndex: Number(entry.routeIndex) || 0,
          fallbackFrom: entry.fallbackFrom || null,
          usage: entry.usage || null,
          at: entry.at,
        })),
      },
      sessionMetadata: this.sessionMetadata(s.sessionKey),
      updatedAt: s.updatedAt,
      transcript: s.transcript,
    };
    return publicProjection(dto);
  }
}

const singleton = new StateStore();

module.exports = singleton;
module.exports.StateStore = StateStore;
module.exports.defaultState = defaultState;
module.exports.RUNNING_PHASES = RUNNING_PHASES;
module.exports.SNAPSHOT = SNAPSHOT;
