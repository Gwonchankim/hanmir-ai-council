'use strict';

const byId = (id) => document.getElementById(id);

const ui = {
  sessionRail: byId('sessionRail'),
  sessionRailBody: byId('sessionRailBody'),
  toggleSessionRail: byId('toggleSessionRail'),
  newSessionBtn: byId('newSessionBtn'),
  sessionSearch: byId('sessionSearch'),
  sessionScope: byId('sessionScope'),
  sessionList: byId('sessionList'),
  sessionCount: byId('sessionCount'),
  mobileSessionBackdrop: byId('mobileSessionBackdrop'),
  mobileWorkspaceNav: byId('mobileWorkspaceNav'),
  mobileWorkspaceTabs: [...document.querySelectorAll('.mobile-workspace-tab')],
  mobileSessionsTab: byId('mobileSessionsTab'),
  mobileChatTab: byId('mobileChatTab'),
  mobileInsightsTab: byId('mobileInsightsTab'),
  conversationPanel: byId('councilConversationPanel'),
  workspace: byId('councilWorkspace'),
  brandSubtitle: byId('brandSubtitle'),
  connectionBadge: byId('connectionBadge'),
  remoteModeBadge: byId('remoteModeBadge'),
  phasePill: byId('phasePill'),
  roundValue: byId('roundValue'),
  cycleValue: byId('cycleValue'),
  planVersionValue: byId('planVersionValue'),
  globalError: byId('globalError'),
  ticker: byId('ticker'),
  activityLog: byId('activityLog'),
  workflowPanel: byId('workflowPanel'),
  workflowViewport: byId('workflowViewport'),
  workflowFollow: byId('workflowFollow'),
  workflowFollowLabel: byId('workflowFollowLabel'),
  workflowDescription: byId('workflowDescription'),
  workflowMetrics: byId('workflowMetrics'),
  workflowCycles: byId('workflowCycles'),
  workflowIngress: byId('workflowIngress'),
  workflowOrchestratorTop: byId('workflowOrchestratorTop'),
  workflowDispatchLink: byId('workflowDispatchLink'),
  workflowAgentGroup: byId('workflowAgentGroup'),
  workflowClaude: byId('workflowClaude'),
  workflowCodex: byId('workflowCodex'),
  workflowReturnLink: byId('workflowReturnLink'),
  workflowOrchestratorReturn: byId('workflowOrchestratorReturn'),
  workflowOrchestratorStatus: byId('workflowOrchestratorStatus'),
  workflowClaudeStatus: byId('workflowClaudeStatus'),
  workflowCodexStatus: byId('workflowCodexStatus'),
  workflowReturnStatus: byId('workflowReturnStatus'),
  orchestratorReturnMessages: byId('orchestratorReturnMessages'),
  toggleSetup: byId('toggleSetup'),
  setupBody: byId('setupBody'),
  applySession: byId('applySession'),
  applyRecommended: byId('applyRecommended'),
  configHint: byId('configHint'),
  configSummary: byId('configSummary'),
  modelGuidance: byId('modelGuidance'),
  modelCapacity: byId('modelCapacity'),
  refreshModelCapacity: byId('refreshModelCapacity'),
  councilMode: byId('councilMode'),
  decisionCouncilConfig: byId('decisionCouncilConfig'),
  councilPreset: byId('councilPreset'),
  councilMaxParallel: byId('councilMaxParallel'),
  councilRoleGrid: byId('councilRoleGrid'),
  planningConfigCards: [...document.querySelectorAll('.planning-config-card')],
  orcBrain: byId('orcBrain'),
  orcModel: byId('orcModel'),
  orcEffort: byId('orcEffort'),
  orcFallbackBrain: byId('orcFallbackBrain'),
  orcFallbackModel: byId('orcFallbackModel'),
  orcFallbackEffort: byId('orcFallbackEffort'),
  clModel: byId('clModel'),
  clEffort: byId('clEffort'),
  clFallbackModel: byId('clFallbackModel'),
  clFallbackEffort: byId('clFallbackEffort'),
  cxModel: byId('cxModel'),
  cxEffort: byId('cxEffort'),
  cxFallbackModel: byId('cxFallbackModel'),
  cxFallbackEffort: byId('cxFallbackEffort'),
  userMessages: byId('userMessages'),
  orchestratorMessages: byId('orchestratorMessages'),
  claudeMessages: byId('claudeMessages'),
  codexMessages: byId('codexMessages'),
  userCount: byId('userCount'),
  orchestratorCount: byId('orchestratorCount'),
  claudeCount: byId('claudeCount'),
  codexCount: byId('codexCount'),
  artifactSection: byId('artifactSection'),
  artifactList: byId('artifactList'),
  artifactFilter: byId('artifactFilter'),
  artifactCount: byId('artifactCount'),
  inspectorPanel: byId('inspectorPanel'),
  expandAllInspector: byId('expandAllInspector'),
  orchestratorSummary: byId('orchestratorSummary'),
  claudeSummary: byId('claudeSummary'),
  codexSummary: byId('codexSummary'),
  orchestratorSummaryMeta: byId('orchestratorSummaryMeta'),
  claudeSummaryMeta: byId('claudeSummaryMeta'),
  codexSummaryMeta: byId('codexSummaryMeta'),
  harnessStatus: byId('harnessStatus'),
  orchestratorHarness: byId('orchestratorHarness'),
  claudeWorkerHarness: byId('claudeWorkerHarness'),
  codexWorkerHarness: byId('codexWorkerHarness'),
  orchestratorHarnessVersion: byId('orchestratorHarnessVersion'),
  claudeWorkerHarnessVersion: byId('claudeWorkerHarnessVersion'),
  codexWorkerHarnessVersion: byId('codexWorkerHarnessVersion'),
  orchestratorHarnessMeta: byId('orchestratorHarnessMeta'),
  claudeWorkerHarnessMeta: byId('claudeWorkerHarnessMeta'),
  codexWorkerHarnessMeta: byId('codexWorkerHarnessMeta'),
  saveHarnessButtons: [...document.querySelectorAll('.save-harness')],
  harnessHistoryPanel: byId('harnessHistoryPanel'),
  harnessHistoryMeta: byId('harnessHistoryMeta'),
  harnessRevisionList: byId('harnessRevisionList'),
  harnessDiffFrom: byId('harnessDiffFrom'),
  harnessDiffTo: byId('harnessDiffTo'),
  harnessDiffRole: byId('harnessDiffRole'),
  loadHarnessDiff: byId('loadHarnessDiff'),
  harnessDiffStatus: byId('harnessDiffStatus'),
  harnessDiffOutput: byId('harnessDiffOutput'),
  harnessRollbackHint: byId('harnessRollbackHint'),
  rollbackHarness: byId('rollbackHarness'),
  questionPanel: byId('questionPanel'),
  questionSummary: byId('questionSummary'),
  requiredQuestions: byId('requiredQuestions'),
  optionalQuestions: byId('optionalQuestions'),
  actionTitle: byId('actionTitle'),
  actionDescription: byId('actionDescription'),
  feedbackMode: byId('feedbackMode'),
  retryBtn: byId('retryBtn'),
  cancelBtn: byId('cancelBtn'),
  approveBtn: byId('approveBtn'),
  composer: byId('composer'),
  composerInputArea: byId('composerInputArea'),
  toggleComposer: byId('toggleComposer'),
  inputLabel: byId('inputLabel'),
  input: byId('input'),
  inputHint: byId('inputHint'),
  sendBtn: byId('sendBtn'),
};

const PHASE_LABELS = {
  configuring: '설정 중',
  ready: '준비',
  idle: '준비',
  decomposing: '과업 배분',
  dispatching: '과업 배분',
  dispatch: '과업 배분',
  harnessing: 'Harness 설계',
  framing: '질문 정리',
  independent_analysis: '5개 독립 분석',
  anonymous_peer_review: '익명 동료평가',
  chair_synthesis: '의장 종합',
  r0_drafting: '초안 작성',
  drafting: '초안 작성',
  r0: '초안 작성',
  r1_critiquing: '교차 비평',
  critiquing: '교차 비평',
  r1: '교차 비평',
  r2_revising: '개정',
  revising: '개정',
  r2: '개정',
  synthesizing: '통합',
  synthesis: '통합',
  running: '진행 중',
  cancelling: '취소 중',
  waiting_user_input: '답변 대기',
  awaiting_input: '답변 대기',
  waiting_input: '답변 대기',
  waiting_approval: '승인 대기',
  awaiting_approval: '승인 대기',
  awaiting_user: '사용자 검토',
  approved: '승인 완료',
  done: '완료',
  completed: '완료',
  failed: '실패',
  interrupted: '중단됨',
  cancelled: '취소됨',
};

const BUSY_PHASES = new Set([
  'decomposing', 'dispatch', 'dispatching', 'harnessing', 'r0_drafting', 'drafting', 'r0',
  'r1_critiquing', 'critiquing', 'r1', 'r2_revising', 'revising', 'r2',
  'synthesizing', 'synthesis', 'running', 'cancelling',
  'framing', 'independent_analysis', 'anonymous_peer_review', 'chair_synthesis',
]);
const FEEDBACK_PHASES = new Set([
  'waiting_user_input', 'waiting_input', 'awaiting_input', 'waiting_approval', 'awaiting_approval', 'awaiting_user',
]);
const FAILED_PHASES = new Set(['failed', 'interrupted']);
const TERMINAL_PHASES = new Set(['approved', 'done', 'completed']);

const PRIVATE_KINDS = /(^|[._-])(thinking|reasoning|chain[._-]?of[._-]?thought|analysis|internal)([._-]|$)/i;
const PRIVATE_KEYS = /^(thinking|reasoning|analysis|chain_?of_?thought|internal_?thoughts?|raw_?prompt|raw_?response)$/i;
const MESSAGE_KINDS = new Set([
  'text', 'message', 'user', 'public_message', 'agent_message', 'agent.completed', 'agent_completed',
  'output', 'draft', 'critique', 'revision', 'synthesis',
]);
const ARTIFACT_KINDS = new Set([
  'artifact', 'artifact.completed', 'artifact_completed', 'checkpoint', 'plan', 'task_package',
  'draft_artifact', 'critique_artifact', 'revision_artifact', 'synthesis_artifact', 'evaluation',
  'harness', 'harness.created', 'harness_created', 'harness.updated', 'harness_updated',
]);
const STATUS_KINDS = new Set([
  'status', 'stage', 'stage.changed', 'stage_changed', 'agent.started', 'agent_started',
  'agent.completed', 'agent_completed', 'run.started', 'run_started', 'run.completed', 'run_completed',
  'approval.required', 'approval_required', 'question.required', 'question_required',
]);

const app = {
  options: null,
  state: null,
  phase: 'ready',
  round: 0,
  cycle: 0,
  planVersion: null,
  requiredQuestions: [],
  optionalQuestions: [],
  feedbackMode: false,
  eventSource: null,
  securityContext: null,
  securityBlocked: false,
  activeSessionId: null,
  sessions: [],
  archived: false,
  sessionSearchTimer: null,
  mobileView: 'chat',
  mobileReturnView: 'chat',
  harnesses: {},
  harnessDirty: new Set(),
  harnessHistory: [],
  harnessHistoryCurrentRevision: 0,
  harnessHistoryLoading: false,
  harnessHistoryRequest: 0,
  harnessHistoryLoadKey: '',
  harnessDiffChangeCount: null,
  summaries: { orchestrator: [], claude: [], codex: [] },
  summaryKeys: new Set(),
  inspectorExpanded: false,
  seenEvents: new Set(),
  renderedMessages: new Set(),
  renderedWorkflowReturns: new Set(),
  workflowFollowEnabled: true,
  workflowProgrammaticScroll: false,
  workflowFollowTimer: null,
  workflowTarget: 'workflowOrchestratorTop',
  workflowReplay: false,
  workflowRoleState: { orchestrator: 'idle', claude: 'idle', codex: 'idle', return: 'idle' },
  workflowEvents: [],
  renderedArtifacts: new Set(),
  counts: { user: 0, orchestrator: 0, claude: 0, codex: 0, artifact: 0 },
  councilRoleControls: {},
  modelCapacity: null,
  modelCapacityTimer: null,
  modelCapacityLoading: false,
};

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char]));
}

function markdown(source) {
  const lines = escapeHtml(source).replace(/\r\n?/g, '\n').split('\n');
  let html = '';
  let list = null;

  const closeList = () => {
    if (list) html += `</${list}>`;
    list = null;
  };
  const inline = (line) => line
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');

  for (const raw of lines) {
    const line = inline(raw);
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    const unordered = line.match(/^\s*[-*]\s+(.+)$/);
    const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);

    if (heading) {
      closeList();
      const level = heading[1].length;
      html += `<h${level}>${heading[2]}</h${level}>`;
    } else if (unordered) {
      if (list !== 'ul') { closeList(); list = 'ul'; html += '<ul>'; }
      html += `<li>${unordered[1]}</li>`;
    } else if (ordered) {
      if (list !== 'ol') { closeList(); list = 'ol'; html += '<ol>'; }
      html += `<li>${ordered[1]}</li>`;
    } else if (!line.trim()) {
      closeList();
    } else {
      closeList();
      html += `<p>${line}</p>`;
    }
  }
  closeList();
  return html;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hash(value) {
  const text = String(value);
  let result = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    result ^= text.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(36);
}

function normalizePhase(value) {
  return String(value || 'ready').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function normalizeKind(event) {
  return String(event.kind || event.type || event.event || 'text').trim().toLowerCase();
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (['orchestrator', 'orchestration', 'director'].includes(role)) return 'orchestrator';
  if (['claude', 'claude_worker', 'claudeworker', 'worker_claude'].includes(role)) return 'claude';
  if (['codex', 'chatgpt', 'codex_worker', 'codexworker', 'worker_codex'].includes(role)) return 'codex';
  if (['user', 'human'].includes(role)) return 'user';
  if (['system', 'engine'].includes(role)) return 'system';
  return null;
}

function textFrom(value) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function publicContent(event) {
  const candidates = [
    event.publicContent, event.public_content, event.content, event.text, event.output, event.message,
    event.message && event.message.content, event.payload && event.payload.content,
  ];
  for (const value of candidates) {
    const text = textFrom(value);
    if (text.trim()) return text;
  }
  return '';
}

function sanitizePublic(value, depth = 0) {
  if (depth > 8) return '[중첩 데이터 생략]';
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item) => sanitizePublic(item, depth + 1));
  const clean = {};
  for (const [key, item] of Object.entries(value)) {
    if (PRIVATE_KEYS.test(key)) continue;
    clean[key] = sanitizePublic(item, depth + 1);
  }
  return clean;
}

function formatTime(value) {
  const number = Number(value);
  const date = value instanceof Date ? value : new Date(Number.isFinite(number) ? number : value || Date.now());
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(date);
}

function eventIdentity(event, messageEvent) {
  const sessionId = event.sessionId || event.session_id || event.sessionKey || app.activeSessionId || 'active';
  const explicit = messageEvent?.lastEventId || event.eventId || event.event_id || event.id || event.sequence || event.seq;
  if (explicit !== undefined && explicit !== null && explicit !== '') return `id:${sessionId}:${explicit}`;
  return `fp:${hash(stableStringify({
    role: event.role,
    kind: normalizeKind(event),
    turnId: event.turnId || event.turn_id,
    cycle: event.cycle,
    round: event.round,
    planVersion: event.planVersion || event.plan_version,
    time: event.t || event.time || event.timestamp,
    content: publicContent(event),
    artifact: event.artifact || event.data,
  }))}`;
}

function setConnection(status, label) {
  ui.connectionBadge.className = `connection-badge ${status}`;
  ui.connectionBadge.textContent = label;
  ui.connectionBadge.dataset.connectionState = status;
  ui.connectionBadge.setAttribute('aria-label', `실시간 연결: ${label}`);
}

function renderAccessMode(context = app.securityContext) {
  const localHosts = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const declaredMode = textFrom(context?.accessMode || context?.access_mode || '').toLowerCase();
  const remote = declaredMode
    ? !['local', 'localhost', 'loopback'].includes(declaredMode)
    : !localHosts.has(window.location.hostname.toLowerCase());
  const identityRaw = context?.remoteIdentity || context?.remote_identity || {};
  const identity = textFrom(typeof identityRaw === 'string'
    ? identityRaw
    : identityRaw.name || identityRaw.login || identityRaw.user || '').replace(/\s+/g, ' ').trim().slice(0, 48);
  ui.remoteModeBadge.dataset.remoteMode = remote ? 'remote' : 'local';
  ui.remoteModeBadge.dataset.accessMode = declaredMode || (remote ? 'remote' : 'local');
  ui.remoteModeBadge.textContent = remote
    ? `Tailscale 비공개${identity ? ` · ${identity}` : ''}`
    : '이 PC에서만';
  ui.remoteModeBadge.title = remote
    ? '인증된 Tailscale 연결을 통해 접속 중입니다.'
    : '이 브라우저는 현재 PC의 loopback 주소로 접속 중입니다.';
  ui.remoteModeBadge.setAttribute('aria-label', remote
    ? `접속 모드: Tailscale 비공개${identity ? `, ${identity}` : ''}`
    : '접속 모드: 이 PC에서만');
}

function showError(message, focus = false) {
  const text = textFrom(message).trim();
  ui.globalError.textContent = text;
  ui.globalError.classList.toggle('hidden', !text);
  if (text && focus) ui.globalError.focus();
}

function setTicker(message, error = false) {
  ui.ticker.textContent = message || '준비되었습니다.';
  ui.ticker.classList.toggle('error', error);
}

function optionEntries(items) {
  if (!Array.isArray(items)) return [];
  return items.map((item) => {
    if (typeof item === 'string') return { value: item, label: item };
    return {
      value: String(item.id || item.value || item.model || item.name || ''),
      label: String(item.label || item.name || item.id || item.value || ''),
    };
  }).filter((item) => item.value);
}

function normalizeProvider(raw = {}) {
  const models = optionEntries(raw.models || raw.modelOptions || raw.allowedModels || []);
  const efforts = optionEntries(raw.efforts || raw.effortOptions || raw.allowedEfforts || []);
  return {
    models,
    efforts,
    defaultModel: String(raw.defaultModel || raw.default_model || models[0]?.value || ''),
    defaultEffort: String(raw.defaultEffort || raw.default_effort || efforts[0]?.value || ''),
  };
}

function normalizeOptions(payload = {}) {
  const source = payload.options || payload.providers || payload.models || payload;
  return {
    modes: optionEntries(source.modes || ['planning', 'decision_council']),
    claude: normalizeProvider(source.claude || source.anthropic || {}),
    codex: normalizeProvider(source.codex || source.chatgpt || source.openai || {}),
    preflight: payload.preflight || payload.readiness || source.preflight || null,
    modelReadiness: payload.modelReadiness || source.modelReadiness || null,
    defaults: payload.defaults || source.defaults || {},
  };
}

function fillSelect(select, options, selected, fallback) {
  select.replaceChildren();
  const entries = optionEntries(options);
  for (const entry of entries) {
    const option = document.createElement('option');
    option.value = entry.value;
    option.textContent = entry.label;
    select.append(option);
  }
  const preferred = String(selected || fallback || '');
  if (preferred && entries.some((entry) => entry.value === preferred)) select.value = preferred;
  else if (fallback && entries.some((entry) => entry.value === fallback)) select.value = fallback;
  select.disabled = entries.length === 0;
}

function providerOptions(brain) {
  return app.options?.[brain === 'codex' ? 'codex' : 'claude'] || normalizeProvider();
}

const COUNCIL_ROLE_META = Object.freeze({
  contrarian: {
    label: 'Contrarian',
    description: '실패 가능성, 결함과 누락된 전제를 찾습니다.',
  },
  firstPrinciples: {
    label: 'First Principles',
    description: '가정을 제거하고 실제 문제를 다시 정의합니다.',
  },
  expansionist: {
    label: 'Expansionist',
    description: '확장성, 상방과 인접 기회를 탐색합니다.',
  },
  outsider: {
    label: 'Outsider',
    description: '처음 보는 사람의 이해 가능성을 점검합니다.',
  },
  executor: {
    label: 'Executor',
    description: '실행 현실성과 가장 빠른 첫 행동을 결정합니다.',
  },
  chair: {
    label: 'Council Chair',
    description: '다수결이 아닌 논리의 질로 최종 판단을 종합합니다.',
  },
});

function createSelect(className, labelText) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const select = document.createElement('select');
  select.className = className;
  label.append(select);
  return { label, select };
}

function fillBrainSelect(select, selected, { optional = false } = {}) {
  select.replaceChildren();
  if (optional) {
    const none = document.createElement('option');
    none.value = '';
    none.textContent = '사용 안 함';
    select.append(none);
  }
  [['claude', 'Claude'], ['codex', 'ChatGPT (Codex)']].forEach(([value, label]) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  });
  select.value = selected || (optional ? '' : 'codex');
}

function refreshRouteControls(routeControls, route = {}) {
  fillBrainSelect(routeControls.brain, route.brain || route.provider, { optional: routeControls.optional });
  const brain = routeControls.brain.value;
  const provider = providerOptions(brain || 'codex');
  fillSelect(routeControls.model, provider.models, route.model, provider.defaultModel);
  fillSelect(routeControls.effort, provider.efforts, route.effort, provider.defaultEffort);
  const enabled = Boolean(brain);
  routeControls.model.disabled = !enabled;
  routeControls.effort.disabled = !enabled;
}

function createRouteControls(card, prefix, optional = false) {
  const heading = document.createElement('h4');
  heading.textContent = optional ? '대체 모델' : '주 모델';
  const pair = document.createElement('div');
  pair.className = 'route-pair';
  const brain = createSelect(`${prefix}-brain`, 'Provider');
  const model = createSelect(`${prefix}-model`, 'Model');
  const effort = createSelect(`${prefix}-effort`, 'Effort');
  pair.append(brain.label, model.label);
  card.append(heading, pair, effort.label);
  const controls = {
    brain: brain.select,
    model: model.select,
    effort: effort.select,
    optional,
  };
  controls.brain.addEventListener('change', () => refreshRouteControls(controls, {
    brain: controls.brain.value,
  }));
  return controls;
}

function ensureCouncilRoleControls() {
  if (Object.keys(app.councilRoleControls).length) return;
  Object.entries(COUNCIL_ROLE_META).forEach(([key, meta]) => {
    const card = document.createElement('section');
    card.className = 'config-card council-route-card';
    const title = document.createElement('h3');
    title.className = 'config-card-title';
    title.textContent = meta.label;
    const description = document.createElement('p');
    description.textContent = meta.description;
    card.append(title, description);
    const primary = createRouteControls(card, `${key}-primary`, false);
    const fallbackHeading = document.createElement('div');
    fallbackHeading.className = 'fallback-heading';
    const fallbackTitle = document.createElement('h4');
    fallbackTitle.textContent = 'Fallback 순서';
    const addFallback = document.createElement('button');
    addFallback.type = 'button';
    addFallback.className = 'button ghost compact add-fallback';
    addFallback.textContent = '+ 경로 추가';
    fallbackHeading.append(fallbackTitle, addFallback);
    const fallbackList = document.createElement('div');
    fallbackList.className = 'fallback-list';
    card.append(fallbackHeading, fallbackList);
    ui.councilRoleGrid.append(card);
    app.councilRoleControls[key] = {
      card, primary, fallbacks: [], fallbackList, addFallback,
    };
    addFallback.addEventListener('click', () => addCouncilFallback(key));
  });
}

function addCouncilFallback(key, route = {}) {
  const role = app.councilRoleControls[key];
  if (!role || role.fallbacks.length >= 5) return;
  const fallbackRoute = route.brain || route.provider
    ? route
    : {
      brain: role.primary.brain.value === 'claude' ? 'codex' : 'claude',
      effort: role.primary.effort.value || 'medium',
    };
  const index = role.fallbacks.length;
  const row = document.createElement('div');
  row.className = 'fallback-route';
  const controls = createRouteControls(row, `${key}-fallback-${index}`, true);
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'text-link remove-fallback';
  remove.textContent = '이 경로 제거';
  remove.addEventListener('click', () => {
    const position = role.fallbacks.indexOf(controls);
    if (position >= 0) role.fallbacks.splice(position, 1);
    row.remove();
    role.addFallback.disabled = role.fallbacks.length >= 5;
    updateControls();
  });
  row.append(remove);
  role.fallbackList.append(row);
  controls.row = row;
  controls.remove = remove;
  role.fallbacks.push(controls);
  refreshRouteControls(controls, fallbackRoute);
  role.addFallback.disabled = role.fallbacks.length >= 5;
  return controls;
}

function clearCouncilFallbacks(role) {
  role.fallbacks = [];
  role.fallbackList.replaceChildren();
  role.addFallback.disabled = false;
}

function renderCouncilMode() {
  const decision = ui.councilMode.value === 'decision_council';
  ui.decisionCouncilConfig.classList.toggle('hidden', !decision);
  ui.planningConfigCards.forEach((card) => card.classList.toggle('hidden', decision));
  if (ui.brandSubtitle) {
    ui.brandSubtitle.textContent = decision
      ? '서로 다른 다섯 관점이 독립 분석과 익명 평가를 거쳐 중요한 결정을 검증합니다.'
      : 'Orchestrator와 두 워커가 하나의 기획안을 함께 만듭니다.';
  }
}

function renderCouncilConfig(council = {}) {
  ensureCouncilRoleControls();
  if (ui.councilPreset) ui.councilPreset.value = '';
  ui.councilMaxParallel.value = String(council.maxParallel || 3);
  Object.entries(app.councilRoleControls).forEach(([key, controls]) => {
    const route = key === 'chair' ? council.chair : council.advisors?.[key];
    refreshRouteControls(controls.primary, route || {});
    clearCouncilFallbacks(controls);
    (route?.fallbacks || []).forEach((fallback) => addCouncilFallback(key, fallback));
  });
}

function preferredModel(brain, candidates = []) {
  const provider = providerOptions(brain);
  const values = optionEntries(provider.models).map((item) => item.value);
  return candidates.find((candidate) => values.includes(candidate))
    || provider.defaultModel
    || values[0];
}

function applyCouncilPreset(name) {
  if (!name) return;
  ensureCouncilRoleControls();
  const claudeLow = preferredModel('claude', ['claude-haiku-4-5-20251001']);
  const claudeQuality = preferredModel('claude', ['fable', 'opus', 'sonnet']);
  const claudeBalanced = preferredModel('claude', ['sonnet', 'opus']);
  const codexDefault = preferredModel('codex', ['gpt-5.6-terra', 'gpt-5.6-sol']);
  const codexQuality = preferredModel('codex', ['gpt-5.6-sol', 'gpt-5.6-terra']);
  const codexLow = preferredModel('codex', ['gpt-5.6-luna', 'gpt-5.6-terra']);
  const roleKeys = Object.keys(app.councilRoleControls);
  roleKeys.forEach((key, index) => {
    const role = app.councilRoleControls[key];
    let primary;
    let fallback;
    if (name === 'codex_primary') {
      primary = { brain: 'codex', model: key === 'chair' ? codexQuality : codexDefault, effort: key === 'chair' ? 'medium' : 'low' };
      fallback = { brain: 'claude', model: claudeLow, effort: 'low' };
    } else if (name === 'low_cost') {
      const brain = index % 2 ? 'codex' : 'claude';
      primary = {
        brain,
        model: brain === 'claude' ? claudeLow : codexLow,
        effort: 'low',
      };
      fallback = {
        brain: brain === 'claude' ? 'codex' : 'claude',
        model: brain === 'claude' ? codexLow : claudeLow,
        effort: 'low',
      };
    } else if (name === 'quality') {
      const brain = index % 2 ? 'codex' : 'claude';
      primary = {
        brain,
        model: brain === 'claude' ? claudeQuality : codexQuality,
        effort: 'high',
      };
      fallback = {
        brain: brain === 'claude' ? 'codex' : 'claude',
        model: brain === 'claude' ? codexQuality : claudeQuality,
        effort: 'high',
      };
    } else {
      const brain = index % 2 ? 'codex' : 'claude';
      primary = {
        brain,
        model: brain === 'claude' ? claudeBalanced : codexDefault,
        effort: key === 'chair' ? 'high' : 'medium',
      };
      fallback = {
        brain: brain === 'claude' ? 'codex' : 'claude',
        model: brain === 'claude' ? codexDefault : claudeBalanced,
        effort: key === 'chair' ? 'high' : 'medium',
      };
    }
    refreshRouteControls(role.primary, primary);
    clearCouncilFallbacks(role);
    addCouncilFallback(key, fallback);
  });
  ui.councilMaxParallel.value = name === 'quality' ? '2' : '3';
}

function refreshOrchestratorOptions(config = null) {
  const provider = providerOptions(ui.orcBrain.value);
  const currentModel = config?.model || ui.orcModel.value;
  const currentEffort = config?.effort || ui.orcEffort.value;
  fillSelect(ui.orcModel, provider.models, currentModel, provider.defaultModel);
  fillSelect(ui.orcEffort, provider.efforts, currentEffort, provider.defaultEffort);
}

function refreshLegacyFallbacks(config = {}) {
  const orchestratorFallback = config.orchestrator?.fallbacks?.[0] || {};
  ui.orcFallbackBrain.value = orchestratorFallback.brain || '';
  const orchestratorProvider = providerOptions(ui.orcFallbackBrain.value || 'codex');
  fillSelect(
    ui.orcFallbackModel,
    orchestratorProvider.models,
    orchestratorFallback.model,
    orchestratorProvider.defaultModel,
  );
  fillSelect(
    ui.orcFallbackEffort,
    orchestratorProvider.efforts,
    orchestratorFallback.effort,
    orchestratorProvider.defaultEffort,
  );
  ui.orcFallbackModel.disabled = !ui.orcFallbackBrain.value;
  ui.orcFallbackEffort.disabled = !ui.orcFallbackBrain.value;

  const claudeFallback = config.claudeWorker?.fallbacks?.[0] || {};
  const codex = providerOptions('codex');
  fillSelect(ui.clFallbackModel, codex.models, claudeFallback.model, codex.defaultModel);
  fillSelect(ui.clFallbackEffort, codex.efforts, claudeFallback.effort, codex.defaultEffort);

  const codexFallback = config.codexWorker?.fallbacks?.[0] || {};
  const claude = providerOptions('claude');
  fillSelect(ui.cxFallbackModel, claude.models, codexFallback.model, claude.defaultModel);
  fillSelect(ui.cxFallbackEffort, claude.efforts, codexFallback.effort, claude.defaultEffort);
}

function renderConfig(config = {}) {
  const orchestrator = config.orchestrator || {};
  const claudeWorker = config.claudeWorker || config.claude_worker || {};
  const codexWorker = config.codexWorker || config.codex_worker || {};
  const brain = orchestrator.brain === 'codex' ? 'codex' : 'claude';
  ui.orcBrain.value = brain;
  refreshOrchestratorOptions(orchestrator);

  const claude = providerOptions('claude');
  const codex = providerOptions('codex');
  fillSelect(ui.clModel, claude.models, claudeWorker.model, claude.defaultModel);
  fillSelect(ui.clEffort, claude.efforts, claudeWorker.effort, claude.defaultEffort);
  fillSelect(ui.cxModel, codex.models, codexWorker.model, codex.defaultModel);
  fillSelect(ui.cxEffort, codex.efforts, codexWorker.effort, codex.defaultEffort);
  refreshLegacyFallbacks(config);
  ui.councilMode.value = config.mode === 'decision_council' ? 'decision_council' : 'planning';
  renderCouncilConfig(config.council || {});
  renderCouncilMode();
  updateConfigSummary();
}

function gatherRoute(controls) {
  return {
    brain: controls.brain.value,
    model: controls.model.value,
    effort: controls.effort.value,
  };
}

function gatherConfig() {
  const advisors = {};
  Object.entries(app.councilRoleControls).forEach(([key, controls]) => {
    const primary = gatherRoute(controls.primary);
    const fallbacks = controls.fallbacks
      .filter((fallback) => fallback.brain.value)
      .map(gatherRoute);
    const route = { ...primary, fallbacks };
    if (key === 'chair') return;
    advisors[key] = route;
  });
  const chairControls = app.councilRoleControls.chair;
  const chairFallbacks = (chairControls?.fallbacks || [])
    .filter((fallback) => fallback.brain.value)
    .map(gatherRoute);
  return {
    mode: ui.councilMode.value,
    orchestrator: {
      brain: ui.orcBrain.value,
      model: ui.orcModel.value,
      effort: ui.orcEffort.value,
      fallbacks: ui.orcFallbackBrain.value ? [{
        brain: ui.orcFallbackBrain.value,
        model: ui.orcFallbackModel.value,
        effort: ui.orcFallbackEffort.value,
      }] : [],
    },
    claudeWorker: {
      brain: 'claude',
      model: ui.clModel.value,
      effort: ui.clEffort.value,
      fallbacks: [{
        brain: 'codex',
        model: ui.clFallbackModel.value,
        effort: ui.clFallbackEffort.value,
      }],
    },
    codexWorker: {
      brain: 'codex',
      model: ui.cxModel.value,
      effort: ui.cxEffort.value,
      fallbacks: [{
        brain: 'claude',
        model: ui.cxFallbackModel.value,
        effort: ui.cxFallbackEffort.value,
      }],
    },
    council: {
      maxParallel: Number(ui.councilMaxParallel.value) || 3,
      advisors,
      chair: {
        ...(chairControls ? gatherRoute(chairControls.primary) : {}),
        fallbacks: chairFallbacks,
      },
    },
  };
}

function renderPreflight() {
  const preflight = app.options?.preflight;
  if (!preflight || typeof preflight !== 'object') return;
  const failing = Object.entries(preflight).filter(([, value]) => {
    if (typeof value === 'boolean') return !value;
    return value && typeof value === 'object' && (value.ready === false || value.ok === false);
  });
  const ready = !failing.length;
  const modelReadiness = app.options?.modelReadiness || {};
  const unavailable = Object.entries(modelReadiness)
    .filter(([, value]) => value?.cliReady === false)
    .map(([brain]) => brain);
  ui.configHint.textContent = ready
    ? (unavailable.length
      ? `실행 불가 Provider: ${unavailable.join(', ')}. 나머지 경로만 사용할 수 있습니다.`
      : 'Claude·Codex CLI 준비 상태가 확인되었습니다. 계정 권한·사용량 한도는 첫 호출에서 자동 점검하며, 실패 시 설정한 fallback으로 전환합니다.')
    : `준비 확인 필요: ${failing.map(([key]) => key).join(', ')}`;
  ui.configHint.classList.toggle('is-warning', !ready || unavailable.length > 0);
}

function routeDisplay(route = {}) {
  if (!route.brain || !route.model) return '미설정';
  return `${route.brain === 'codex' ? 'ChatGPT' : 'Claude'} · ${route.model}`;
}

function updateConfigSummary() {
  if (!ui.configSummary || !app.options) return;
  const config = gatherConfig();
  const routes = config.mode === 'decision_council'
    ? [...Object.values(config.council.advisors), config.council.chair]
    : [config.orchestrator, config.claudeWorker, config.codexWorker];
  const fallbackCount = routes.reduce((sum, route) => sum + (route.fallbacks?.length || 0), 0);
  const primary = config.mode === 'decision_council' ? config.council.chair : config.orchestrator;
  ui.configSummary.textContent = `영향 미리보기 · ${config.mode === 'decision_council' ? '6개 Council 역할' : '3개 협업 역할'} · 기본 ${routeDisplay(primary)} · fallback ${fallbackCount}개 · 최대 병렬 ${config.council.maxParallel}`;
}

const WORKFLOW_TOP_PHASES = new Set([
  'configuring', 'ready', 'idle', 'running', 'harnessing', 'decomposing', 'dispatch', 'dispatching', 'framing',
]);
const WORKFLOW_AGENT_PHASES = new Set([
  'r0_drafting', 'drafting', 'r0', 'r1_critiquing', 'critiquing', 'r1',
  'r2_revising', 'revising', 'r2', 'independent_analysis', 'anonymous_peer_review',
]);
const WORKFLOW_RETURN_PHASES = new Set([
  'synthesizing', 'synthesis', 'chair_synthesis', 'waiting_user_input', 'awaiting_input',
  'waiting_input', 'waiting_approval', 'awaiting_approval', 'awaiting_user',
  'approved', 'done', 'completed',
]);

function setWorkflowFollow(enabled) {
  app.workflowFollowEnabled = Boolean(enabled);
  ui.workflowFollow?.setAttribute('aria-pressed', String(app.workflowFollowEnabled));
  if (ui.workflowFollowLabel) {
    ui.workflowFollowLabel.textContent = app.workflowFollowEnabled
      ? '현재 단계 자동 추적'
      : '현재 단계로 이동';
  }
}

const WORKFLOW_ADVISORS = Object.freeze({
  contrarian: { label: 'Contrarian', glyph: 'C', caption: '실패·위험' },
  firstPrinciples: { label: 'First Principles', glyph: 'F', caption: '문제 재정의' },
  expansionist: { label: 'Expansionist', glyph: 'E', caption: '상방·확장' },
  outsider: { label: 'Outsider', glyph: 'O', caption: '외부자 이해' },
  executor: { label: 'Executor', glyph: 'X', caption: '실행 가능성' },
});

function workflowEventArtifact(event) {
  return event?.artifact && typeof event.artifact === 'object' ? event.artifact : null;
}

function workflowArtifactType(event) {
  return textFrom(event?.artifactType || workflowEventArtifact(event)?.artifactType).toLowerCase();
}

function workflowModelLabel(events) {
  const routed = [...events].reverse().find((event) => event.modelRoute || event.fallback?.to);
  const route = routed?.modelRoute || routed?.fallback?.to;
  if (!route) return '';
  return `${route.brain === 'codex' ? 'ChatGPT' : 'Claude'} · ${route.model}`;
}

function workflowNodeSummary(events) {
  const values = [];
  for (const event of [...events].reverse()) {
    const artifact = workflowEventArtifact(event);
    const text = artifact ? summaryNarrative(artifact) : publicContent(event);
    const clean = textFrom(text).replace(/\s+/g, ' ').trim();
    if (!clean || values.some((value) => (
      value === clean || value.slice(0, 100) === clean.slice(0, 100)
    ))) continue;
    values.push(clean.length > 220 ? `${clean.slice(0, 217)}…` : clean);
    if (values.length === 2) break;
  }
  return values;
}

function workflowStateLabel(state) {
  return {
    active: '진행 중',
    complete: '완료',
    error: '확인 필요',
    idle: '대기',
  }[state] || '대기';
}

function createWorkflowCycleNode({
  key, label, caption, glyph, events, state = 'idle', progress = '', accent = '',
}) {
  const node = document.createElement('article');
  node.className = `workflow-cycle-node${accent ? ` ${accent}` : ''}`;
  node.dataset.workflowNode = key;
  node.dataset.workflowState = state;
  node.classList.toggle('is-active', state === 'active');
  node.classList.toggle('is-complete', state === 'complete');
  node.classList.toggle('is-error', state === 'error');
  if (state === 'active') node.dataset.currentWorkflowTarget = 'true';

  const head = document.createElement('header');
  head.className = 'workflow-cycle-node-head';
  const symbol = document.createElement('span');
  symbol.className = 'workflow-cycle-symbol';
  symbol.textContent = glyph;
  symbol.setAttribute('aria-hidden', 'true');
  const copy = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'tag-label';
  eyebrow.textContent = caption;
  const title = document.createElement('h3');
  title.textContent = label;
  copy.append(eyebrow, title);
  const badges = document.createElement('div');
  badges.className = 'workflow-cycle-badges';
  const status = document.createElement('span');
  status.className = `workflow-state-badge is-${state}`;
  status.textContent = progress || workflowStateLabel(state);
  badges.append(status);
  const model = workflowModelLabel(events);
  if (model) {
    const modelBadge = document.createElement('span');
    modelBadge.className = 'workflow-model-badge';
    modelBadge.textContent = model;
    badges.append(modelBadge);
  }
  if (events.some((event) => event.fallback)) {
    const event = [...events].reverse().find((item) => item.fallback);
    const from = event?.fallback?.from;
    const to = event?.fallback?.to;
    const fallback = document.createElement('span');
    fallback.className = 'workflow-fallback-badge';
    fallback.textContent = from && to ? `${from.model} → ${to.model}` : 'Fallback';
    fallback.title = event?.fallback?.reason || 'Provider availability fallback';
    badges.append(fallback);
  }
  head.append(symbol, copy, badges);
  node.append(head);

  const summaries = workflowNodeSummary(events);
  const list = document.createElement('ul');
  list.className = 'workflow-cycle-summary';
  if (!summaries.length) {
    const item = document.createElement('li');
    item.className = 'none';
    item.textContent = state === 'active' ? '작업 시작을 준비하고 있습니다.' : '아직 공개된 결과가 없습니다.';
    list.append(item);
  } else {
    summaries.forEach((value) => {
      const item = document.createElement('li');
      item.textContent = value;
      list.append(item);
    });
  }
  node.append(list);
  return node;
}

function workflowConnector(label, flowing = false) {
  const connector = document.createElement('div');
  connector.className = `workflow-cycle-connector${flowing ? ' is-flowing' : ''}`;
  const copy = document.createElement('small');
  copy.textContent = label;
  connector.append(copy);
  return connector;
}

function eventsForLogicalRole(events, logicalRole) {
  return events.filter((event) => event.logicalRole === logicalRole);
}

function renderDecisionCycleBody(container, events, phase) {
  const frameEvents = events.filter((event) => (
    event.logicalRole === 'councilFramer' || workflowArtifactType(event) === 'decision_frame'
  ));
  const frameComplete = frameEvents.some((event) => workflowArtifactType(event) === 'decision_frame');
  container.append(createWorkflowCycleNode({
    key: 'framer',
    label: 'Council Framer',
    caption: '질문 중립화',
    glyph: 'F',
    events: frameEvents,
    state: frameComplete ? 'complete' : phase === 'framing' ? 'active' : 'idle',
    accent: 'orchestrator-accent',
  }));
  container.append(workflowConnector('동일한 질문을 5개 관점에 전달', phase === 'independent_analysis'));

  const advisorGrid = document.createElement('div');
  advisorGrid.className = 'workflow-advisor-grid';
  let analysisCount = 0;
  let reviewCount = 0;
  Object.entries(WORKFLOW_ADVISORS).forEach(([key, meta]) => {
    const advisorEvents = events.filter((event) => {
      const artifact = workflowEventArtifact(event);
      return event.logicalRole === `councilAdvisor:${key}`
        || event.logicalRole === `councilReviewer:${key}`
        || artifact?.advisor === key
        || artifact?.reviewer === key;
    });
    const analysisDone = advisorEvents.some((event) => workflowArtifactType(event) === 'advisor_analysis');
    const reviewDone = advisorEvents.some((event) => workflowArtifactType(event) === 'peer_review');
    if (analysisDone) analysisCount += 1;
    if (reviewDone) reviewCount += 1;
    const active = (phase === 'independent_analysis' && !analysisDone)
      || (phase === 'anonymous_peer_review' && analysisDone && !reviewDone);
    advisorGrid.append(createWorkflowCycleNode({
      key,
      label: meta.label,
      caption: meta.caption,
      glyph: meta.glyph,
      events: advisorEvents,
      state: reviewDone ? 'complete' : active ? 'active' : analysisDone ? 'complete' : 'idle',
      progress: reviewDone ? '분석·평가 완료' : analysisDone ? '분석 완료' : active ? '진행 중' : '대기',
      accent: 'advisor-accent',
    }));
  });
  const progress = document.createElement('div');
  progress.className = 'workflow-progress-strip';
  progress.innerHTML = `<span>독립 분석 <strong>${analysisCount}/5</strong></span><span>익명 평가 <strong>${reviewCount}/5</strong></span>`;
  container.append(progress, advisorGrid);
  container.append(workflowConnector('익명 평가 결과를 Chair에게 전달', phase === 'anonymous_peer_review' || phase === 'chair_synthesis'));

  const chairEvents = events.filter((event) => (
    event.logicalRole === 'councilChair'
    || ['council_verdict', 'council_reports'].includes(workflowArtifactType(event))
  ));
  const verdictDone = chairEvents.some((event) => workflowArtifactType(event) === 'council_verdict');
  container.append(createWorkflowCycleNode({
    key: 'chair',
    label: 'Council Chair',
    caption: '최종 종합 판단',
    glyph: 'O',
    events: chairEvents,
    state: verdictDone ? 'complete' : phase === 'chair_synthesis' ? 'active' : 'idle',
    accent: 'orchestrator-accent',
  }));
}

function renderPlanningCycleBody(container, events, phase) {
  const topEvents = events.filter((event) => (
    event.role === 'orchestrator'
    && !['synthesis', 'council_verdict'].includes(workflowArtifactType(event))
  ));
  const workerEvents = (role) => events.filter((event) => (
    event.role === role && !String(event.logicalRole || '').startsWith('council')
  ));
  const finalEvents = events.filter((event) => (
    event.role === 'orchestrator'
    && ['synthesis', 'council_verdict'].includes(workflowArtifactType(event))
  ));
  const agentBusy = WORKFLOW_AGENT_PHASES.has(phase);
  const returning = WORKFLOW_RETURN_PHASES.has(phase);
  container.append(createWorkflowCycleNode({
    key: 'orchestrator',
    label: 'Orchestrator',
    caption: 'Harness · 과업 배분',
    glyph: 'O',
    events: topEvents,
    state: agentBusy || returning ? 'complete' : WORKFLOW_TOP_PHASES.has(phase) ? 'active' : 'idle',
    accent: 'orchestrator-accent',
  }));
  container.append(workflowConnector('두 Agent에게 병렬 전달', agentBusy));
  const grid = document.createElement('div');
  grid.className = 'workflow-worker-grid';
  for (const [role, label, glyph] of [['claude', 'Claude', 'C'], ['codex', 'ChatGPT', 'G']]) {
    const roleEvents = workerEvents(role);
    const complete = roleEvents.some((event) => ARTIFACT_KINDS.has(normalizeKind(event)));
    grid.append(createWorkflowCycleNode({
      key: role,
      label,
      caption: role === 'claude' ? 'Agent 01' : 'Agent 02',
      glyph,
      events: roleEvents,
      state: returning ? 'complete' : agentBusy && !complete ? 'active' : complete ? 'complete' : 'idle',
      accent: role === 'claude' ? 'claude-accent' : 'codex-accent',
    }));
  }
  container.append(grid, workflowConnector('Agent 결과 회수', returning));
  const synthesisDone = finalEvents.some((event) => workflowArtifactType(event) === 'synthesis');
  container.append(createWorkflowCycleNode({
    key: 'synthesis',
    label: 'Orchestrator 종합',
    caption: '통합 결과',
    glyph: 'O',
    events: finalEvents,
    state: synthesisDone ? 'complete' : returning ? 'active' : 'idle',
    accent: 'orchestrator-accent',
  }));
}

function renderWorkflowMetrics() {
  if (!ui.workflowMetrics) return;
  const serverTotals = app.state?.modelRouting?.totals || {};
  const eventUsages = app.workflowEvents.filter((event) => event.usage);
  const eventTotals = eventUsages.reduce((totals, event) => {
    const usage = event.usage || {};
    totals.calls += 1;
    totals.input += Number(usage.input_tokens ?? usage.inputTokens) || 0;
    totals.output += Number(usage.output_tokens ?? usage.outputTokens) || 0;
    totals.cost += Number(usage.total_cost_usd ?? usage.costUsd) || 0;
    return totals;
  }, { calls: 0, input: 0, output: 0, cost: 0 });
  const calls = Math.max(Number(serverTotals.calls) || 0, eventTotals.calls);
  const input = Math.max(Number(serverTotals.inputTokens) || 0, eventTotals.input);
  const output = Math.max(Number(serverTotals.outputTokens) || 0, eventTotals.output);
  const fallbacks = Math.max(
    Number(app.state?.modelRouting?.fallbackCount) || 0,
    app.workflowEvents.filter((event) => event.fallback).length,
  );
  const circuits = Math.max(
    app.state?.modelRouting?.circuits?.length || 0,
    new Set(app.workflowEvents.filter((event) => event.circuit).map((event) => event.circuit.key)).size,
  );
  ui.workflowMetrics.replaceChildren();
  [
    ['호출', calls],
    ['토큰', input + output ? `${(input + output).toLocaleString()}` : '—'],
    ['Fallback', fallbacks],
    ['차단', circuits],
  ].forEach(([label, value]) => {
    const item = document.createElement('span');
    item.innerHTML = `${escapeHtml(label)} <strong>${escapeHtml(value)}</strong>`;
    ui.workflowMetrics.append(item);
  });
}

function renderWorkflowCycles() {
  if (!ui.workflowCycles || app.workflowReplay) return;
  const mode = app.state?.config?.mode === 'decision_council' ? 'decision_council' : 'planning';
  if (ui.workflowDescription) {
    ui.workflowDescription.textContent = mode === 'decision_council'
      ? 'Framer, 5개 독립 관점, 익명 평가, Chair의 현재 진행을 Cycle별로 표시합니다.'
      : 'Orchestrator와 두 Agent의 현재 진행을 Cycle별로 표시합니다.';
  }
  const grouped = new Map();
  for (const event of app.workflowEvents) {
    const cycle = Math.max(0, Number(event.cycle) || 0);
    if (!cycle) continue;
    if (!grouped.has(cycle)) grouped.set(cycle, []);
    grouped.get(cycle).push(event);
  }
  if (app.cycle > 0 && !grouped.has(app.cycle)) grouped.set(app.cycle, []);
  ui.workflowCycles.replaceChildren();
  if (!grouped.size) {
    const empty = document.createElement('div');
    empty.className = 'workflow-empty';
    empty.innerHTML = '<strong>첫 Cycle을 기다리고 있습니다.</strong><span>지시를 보내면 실행 단계가 이곳에 생성됩니다.</span>';
    ui.workflowCycles.append(empty);
    renderWorkflowMetrics();
    return;
  }
  const cycles = [...grouped.keys()].sort((a, b) => a - b);
  const currentCycle = Math.max(app.cycle, ...cycles);
  cycles.forEach((cycleNumber) => {
    const events = grouped.get(cycleNumber);
    const last = events[events.length - 1] || {};
    const phase = cycleNumber === currentCycle
      ? normalizePhase(app.phase)
      : normalizePhase(last.phase || 'completed');
    const detail = document.createElement('details');
    detail.className = 'workflow-cycle';
    detail.dataset.cycle = String(cycleNumber);
    detail.open = cycleNumber === currentCycle;
    const summary = document.createElement('summary');
    summary.innerHTML = `<span>Cycle ${cycleNumber}</span><strong>${escapeHtml(PHASE_LABELS[phase] || phase)}</strong><small>${events.length} events</small>`;
    const body = document.createElement('div');
    body.className = `workflow-cycle-body mode-${mode}`;
    if (mode === 'decision_council') renderDecisionCycleBody(body, events, phase);
    else renderPlanningCycleBody(body, events, phase);
    const report = [...events].reverse().find((event) => workflowArtifactType(event) === 'council_reports')?.artifact;
    if (report?.html?.url || report?.transcript?.url) {
      const actions = document.createElement('nav');
      actions.className = 'workflow-report-actions';
      actions.setAttribute('aria-label', `Cycle ${cycleNumber} 보고서`);
      [['HTML 보고서', report.html], ['Markdown 기록', report.transcript]].forEach(([label, item]) => {
        if (!item?.url) return;
        const link = document.createElement('a');
        link.href = item.url;
        link.target = '_blank';
        link.rel = 'noopener';
        link.textContent = label;
        actions.append(link);
      });
      body.append(actions);
    }
    detail.append(summary, body);
    ui.workflowCycles.append(detail);
  });
  renderWorkflowMetrics();
}

function recordWorkflowEvent(event) {
  if (!event || typeof event !== 'object') return;
  app.workflowEvents.push(event);
  app.workflowEvents = app.workflowEvents.slice(-1000);
  renderWorkflowCycles();
}

function workflowNodeState(element, state) {
  if (!element) return;
  element.classList.toggle('is-active', state === 'active');
  element.classList.toggle('is-complete', state === 'complete');
  element.classList.toggle('is-error', state === 'error');
  element.dataset.workflowState = state;
}

function workflowStatus(role, message) {
  const element = {
    orchestrator: ui.workflowOrchestratorStatus,
    claude: ui.workflowClaudeStatus,
    codex: ui.workflowCodexStatus,
    return: ui.workflowReturnStatus,
  }[role];
  const clean = textFrom(message).replace(/\s+/g, ' ').trim();
  if (element && clean) {
    element.textContent = clean.length > 220 ? `${clean.slice(0, 217)}…` : clean;
    element.title = clean;
  }
}

function workflowElement(target) {
  return {
    workflowOrchestratorTop: ui.workflowOrchestratorTop,
    workflowAgentGroup: ui.workflowAgentGroup,
    workflowOrchestratorReturn: ui.workflowOrchestratorReturn,
  }[target] || ui.workflowOrchestratorTop;
}

function followWorkflowTarget(target = app.workflowTarget, immediate = false) {
  app.workflowTarget = target || app.workflowTarget;
  if (!app.workflowFollowEnabled || app.workflowReplay || !ui.workflowViewport) return;
  const element = ui.workflowCycles?.querySelector('[data-current-workflow-target="true"]')
    || ui.workflowCycles?.querySelector('.workflow-cycle[open] .workflow-cycle-node:last-of-type');
  if (!element) return;
  window.clearTimeout(app.workflowFollowTimer);
  app.workflowFollowTimer = window.setTimeout(() => {
    const top = Math.max(0, element.offsetTop - ((ui.workflowViewport.clientHeight - element.offsetHeight) / 2));
    app.workflowProgrammaticScroll = true;
    ui.workflowViewport.scrollTo({ top, behavior: immediate ? 'auto' : 'smooth' });
    window.setTimeout(() => { app.workflowProgrammaticScroll = false; }, immediate ? 50 : 550);
  }, immediate ? 0 : 70);
}

function workflowPhaseMessage(phase, target) {
  const label = PHASE_LABELS[phase] || phase;
  if (target === 'workflowAgentGroup') return `${label} 작업을 병렬로 수행하고 있습니다.`;
  if (target === 'workflowOrchestratorReturn') {
    if (TERMINAL_PHASES.has(phase)) return '최종 결과가 승인되었습니다.';
    if (FEEDBACK_PHASES.has(phase)) return '통합 결과가 준비되어 사용자 확인을 기다립니다.';
    return `${label} 작업을 수행하고 있습니다.`;
  }
  if (['ready', 'idle', 'configuring'].includes(phase)) return '사용자 지시를 기다리고 있습니다.';
  return `${label} 작업을 수행하고 있습니다.`;
}

function syncWorkflowPhase(value, immediate = false) {
  const phase = normalizePhase(value);
  if (!app.workflowReplay) {
    renderWorkflowCycles();
    followWorkflowTarget(phase, immediate);
  }
  return;
  /* Legacy fixed-node workflow is retained in the DOM only for old session compatibility. */
  const topBusy = WORKFLOW_TOP_PHASES.has(phase) && BUSY_PHASES.has(phase);
  const agentBusy = WORKFLOW_AGENT_PHASES.has(phase);
  const returnPhase = WORKFLOW_RETURN_PHASES.has(phase);
  const terminal = TERMINAL_PHASES.has(phase);
  const failed = FAILED_PHASES.has(phase);

  ui.workflowIngress?.classList.toggle('is-flowing', topBusy);
  ui.workflowDispatchLink?.classList.toggle('is-flowing', agentBusy);
  ui.workflowReturnLink?.classList.toggle('is-flowing', returnPhase && !terminal);

  if (['ready', 'idle', 'configuring', 'cancelled'].includes(phase)) {
    workflowNodeState(ui.workflowOrchestratorTop, 'idle');
    workflowNodeState(ui.workflowClaude, 'idle');
    workflowNodeState(ui.workflowCodex, 'idle');
    workflowNodeState(ui.workflowOrchestratorReturn, 'idle');
    app.workflowTarget = 'workflowOrchestratorTop';
  } else if (WORKFLOW_TOP_PHASES.has(phase)) {
    workflowNodeState(ui.workflowOrchestratorTop, topBusy ? 'active' : 'idle');
    workflowNodeState(ui.workflowClaude, 'idle');
    workflowNodeState(ui.workflowCodex, 'idle');
    workflowNodeState(ui.workflowOrchestratorReturn, 'idle');
    workflowStatus('orchestrator', workflowPhaseMessage(phase, 'workflowOrchestratorTop'));
    app.workflowTarget = 'workflowOrchestratorTop';
  } else if (agentBusy) {
    workflowNodeState(ui.workflowOrchestratorTop, 'complete');
    workflowNodeState(ui.workflowClaude, 'active');
    workflowNodeState(ui.workflowCodex, 'active');
    workflowNodeState(ui.workflowOrchestratorReturn, 'idle');
    const message = workflowPhaseMessage(phase, 'workflowAgentGroup');
    workflowStatus('claude', message);
    workflowStatus('codex', message);
    app.workflowTarget = 'workflowAgentGroup';
  } else if (returnPhase) {
    workflowNodeState(ui.workflowOrchestratorTop, 'complete');
    workflowNodeState(ui.workflowClaude, 'complete');
    workflowNodeState(ui.workflowCodex, 'complete');
    workflowNodeState(ui.workflowOrchestratorReturn, terminal ? 'complete' : 'active');
    workflowStatus('return', workflowPhaseMessage(phase, 'workflowOrchestratorReturn'));
    app.workflowTarget = 'workflowOrchestratorReturn';
  }

  if (failed) workflowNodeState(workflowElement(app.workflowTarget), 'error');
  followWorkflowTarget(app.workflowTarget, immediate);
}

function setPhase(value) {
  app.phase = normalizePhase(value);
  ui.phasePill.dataset.phase = app.phase;
  ui.phasePill.textContent = PHASE_LABELS[app.phase] || app.phase;
  const busy = BUSY_PHASES.has(app.phase);
  ui.workspace.removeAttribute('aria-busy');
  ui.ticker.closest('.activity-panel')?.setAttribute('aria-busy', busy ? 'true' : 'false');
  syncWorkflowPhase(app.phase);
  updateControls();
}

function updateMeta(source = {}) {
  if (source.round !== undefined) app.round = Number(source.round) || 0;
  if (source.cycle !== undefined) app.cycle = Number(source.cycle) || 0;
  const version = source.planVersion ?? source.plan_version;
  if (version !== undefined && version !== null) app.planVersion = version;
  ui.roundValue.textContent = String(app.round);
  ui.cycleValue.textContent = String(app.cycle);
  ui.planVersionValue.textContent = app.planVersion === null || app.planVersion === '' ? '-' : String(app.planVersion);
}

function questionText(item) {
  if (typeof item === 'string') return item;
  return textFrom(item?.question || item?.text || item?.prompt || item?.label || item?.content);
}

function normalizeQuestionList(value) {
  if (!Array.isArray(value)) return [];
  return value.map(questionText).map((text) => text.trim()).filter(Boolean);
}

function extractQuestions(source = {}) {
  const questions = source.questions || source.currentPlan?.questions || source.currentPlan?.synthesis?.questions || {};
  const required = normalizeQuestionList(
    source.requiredQuestions || source.required_questions || source.currentPlan?.requiredQuestions
      || source.currentPlan?.required_questions || questions.required || questions.requiredQuestions,
  );
  const optional = normalizeQuestionList(
    source.optionalQuestions || source.optional_questions || source.currentPlan?.optionalQuestions
      || source.currentPlan?.optional_questions || questions.optional || questions.optionalQuestions,
  );
  return { required, optional };
}

function hasQuestionContract(source = {}) {
  if (!source || typeof source !== 'object') return false;
  return [
    'requiredQuestions', 'required_questions', 'optionalQuestions', 'optional_questions', 'questions',
  ].some((key) => Object.prototype.hasOwnProperty.call(source, key));
}

function renderQuestionList(element, items, emptyText) {
  element.replaceChildren();
  if (!items.length) {
    const item = document.createElement('li');
    item.className = 'none';
    item.textContent = emptyText;
    element.append(item);
    return;
  }
  for (const text of items) {
    const item = document.createElement('li');
    item.textContent = text;
    element.append(item);
  }
}

function renderQuestions(required, optional) {
  app.requiredQuestions = normalizeQuestionList(required);
  app.optionalQuestions = normalizeQuestionList(optional);
  const hasQuestions = app.requiredQuestions.length > 0 || app.optionalQuestions.length > 0;
  ui.questionPanel.classList.toggle('hidden', !hasQuestions);
  renderQuestionList(ui.requiredQuestions, app.requiredQuestions, '남은 필수 질문이 없습니다.');
  renderQuestionList(ui.optionalQuestions, app.optionalQuestions, '선택 질문이 없습니다.');
  ui.questionSummary.textContent = app.requiredQuestions.length
    ? `필수 ${app.requiredQuestions.length}개`
    : `선택 ${app.optionalQuestions.length}개`;
  ui.questionSummary.classList.toggle('required', app.requiredQuestions.length > 0);
  updateControls();
}

function updateControls() {
  const decisionCouncil = app.state?.config?.mode === 'decision_council';
  const busy = BUSY_PHASES.has(app.phase);
  const archived = app.archived;
  const securityBlocked = app.securityBlocked;
  const feedbackPhase = FEEDBACK_PHASES.has(app.phase);
  const failed = FAILED_PHASES.has(app.phase);
  const terminal = TERMINAL_PHASES.has(app.phase);
  const approvalPhase = ['waiting_approval', 'awaiting_approval', 'awaiting_user'].includes(app.phase);
  const stalePlan = Boolean(app.state?.harnessPlanStale);
  const canApprove = approvalPhase && app.requiredQuestions.length === 0
    && !stalePlan && !busy && !archived && !securityBlocked;
  const canWrite = !busy && !failed && !terminal && !archived && !securityBlocked;

  ui.sendBtn.disabled = !canWrite;
  ui.input.disabled = !canWrite;
  ui.applySession.disabled = busy || securityBlocked;
  ui.newSessionBtn.disabled = busy || securityBlocked;
  [
    ui.councilMode, ui.councilPreset, ui.councilMaxParallel,
    ui.orcBrain, ui.orcModel, ui.orcEffort,
    ui.orcFallbackBrain, ui.orcFallbackModel, ui.orcFallbackEffort,
    ui.clModel, ui.clEffort, ui.clFallbackModel, ui.clFallbackEffort,
    ui.cxModel, ui.cxEffort, ui.cxFallbackModel, ui.cxFallbackEffort,
    ...Object.values(app.councilRoleControls).flatMap((role) => [
      role.primary.brain, role.primary.model, role.primary.effort,
      ...role.fallbacks.flatMap((fallback) => [
        fallback.brain, fallback.model, fallback.effort,
      ]),
    ]),
  ]
    .forEach((element) => { element.disabled = busy || securityBlocked || element.options.length === 0; });
  if (!ui.orcFallbackBrain.value) {
    ui.orcFallbackModel.disabled = true;
    ui.orcFallbackEffort.disabled = true;
  }
  Object.values(app.councilRoleControls).forEach((role) => {
    role.addFallback.disabled = busy || securityBlocked || role.fallbacks.length >= 5;
    role.fallbacks.forEach((fallback) => {
      fallback.remove.disabled = busy || securityBlocked;
      if (!fallback.brain.value) {
        fallback.model.disabled = true;
        fallback.effort.disabled = true;
      }
    });
  });
  Object.values(HARNESS_UI).forEach((target) => { target.input.disabled = busy || archived || securityBlocked; });
  ui.saveHarnessButtons.forEach((button) => {
    button.disabled = busy || archived || securityBlocked || !app.harnessDirty.has(button.dataset.role);
  });

  ui.cancelBtn.classList.toggle('hidden', !busy);
  ui.retryBtn.classList.toggle('hidden', !failed || archived);
  ui.feedbackMode.classList.toggle('hidden', !approvalPhase || archived);
  ui.approveBtn.classList.toggle('hidden', !approvalPhase || archived);
  ui.approveBtn.disabled = !canApprove;
  ui.approveBtn.title = app.requiredQuestions.length
    ? `필수 질문 ${app.requiredQuestions.length}개에 먼저 답변해야 합니다.`
    : stalePlan
      ? 'Harness가 변경되어 현재 기획안을 다시 실행해야 합니다.'
      : '';

  app.feedbackMode = feedbackPhase || app.feedbackMode;
  if (!feedbackPhase && !approvalPhase) app.feedbackMode = false;

  if (securityBlocked) {
    ui.actionTitle.textContent = '접속 보안 확인 필요';
    ui.actionDescription.textContent = '보안 컨텍스트를 확인할 수 없어 변경 작업을 잠갔습니다. 연결을 새로고침하세요.';
    ui.inputLabel.textContent = '입력 잠김';
    ui.input.placeholder = '접속 인증을 확인한 뒤 입력할 수 있습니다.';
    setSendButtonLabel('보안 확인 필요', '×');
  } else if (archived) {
    ui.actionTitle.textContent = '보관된 세션 · 읽기 전용';
    ui.actionDescription.textContent = '내용을 변경하려면 세션 목록에서 복원하세요.';
    ui.inputLabel.textContent = '읽기 전용';
    ui.input.placeholder = '보관된 세션에서는 지시와 피드백을 보낼 수 없습니다.';
    setSendButtonLabel('보관된 세션', '◇');
  } else if (busy) {
    ui.actionTitle.textContent = 'Council 실행 중';
    ui.actionDescription.textContent = '현재 단계를 마칠 때까지 입력이 잠깁니다.';
    ui.inputLabel.textContent = '입력 잠김';
    setSendButtonLabel('실행 중', '…');
  } else if (failed) {
    ui.actionTitle.textContent = app.phase === 'interrupted' ? '실행 중단' : '실행 실패';
    ui.actionDescription.textContent = '완료된 결과를 보존한 채 실패 단계부터 재시도할 수 있습니다.';
    ui.inputLabel.textContent = '입력 잠김';
    setSendButtonLabel('입력 불가', '×');
  } else if (terminal) {
    ui.actionTitle.textContent = decisionCouncil ? 'Council 판단 승인 완료' : 'MVP 기획 루프 완료';
    ui.actionDescription.textContent = '새로운 작업은 새 세션으로 시작하세요.';
    ui.inputLabel.textContent = '승인 완료';
    setSendButtonLabel('완료', '✓');
  } else if (feedbackPhase || app.feedbackMode) {
    ui.actionTitle.textContent = app.requiredQuestions.length
      ? '필수 질문 답변'
      : (decisionCouncil ? 'Council 판단 피드백' : '기획안 피드백');
    ui.actionDescription.textContent = app.requiredQuestions.length
      ? '위 필수 질문에 답하면 Orchestrator가 두 워커에게 다시 배분합니다.'
      : '수정 요청 또는 선택 질문의 답변을 입력하세요.';
    ui.inputLabel.textContent = '피드백 또는 질문 답변';
    ui.input.placeholder = decisionCouncil
      ? '최종 판단에서 다시 검토할 전제·선택지·제약을 구체적으로 입력하세요.'
      : '기획안에서 바꿀 점과 유지할 점, 질문 답변을 구체적으로 입력하세요.';
    setSendButtonLabel('피드백 보내기', '↑');
  } else {
    ui.actionTitle.textContent = '새 지시';
    ui.actionDescription.textContent = decisionCouncil
      ? '서로 다른 다섯 관점이 검증할 중요한 결정을 입력하세요.'
      : '두 워커가 함께 검토할 과업을 입력하세요.';
    ui.inputLabel.textContent = '사용자 지시';
    ui.input.placeholder = '예: 신제품 시장진입 전략 보고서의 목차와 검증 계획을 만들어줘.';
    setSendButtonLabel('지시 보내기', '↑');
  }

  if (!busy && app.harnessDirty.size) {
    ui.sendBtn.disabled = true;
    ui.actionTitle.textContent = 'Harness 저장 필요';
    ui.actionDescription.textContent = '오른쪽에서 수정한 Harness를 저장하면 다음 지시부터 적용됩니다.';
    setSendButtonLabel('Harness를 먼저 저장하세요', '•');
  }
  updateHarnessHistoryControls();
}

function setSendButtonLabel(label, glyph = '↑') {
  ui.sendBtn.setAttribute('aria-label', label);
  ui.sendBtn.title = label;
  ui.sendBtn.innerHTML = `<span aria-hidden="true">${escapeHtml(glyph)}</span>`;
}

function removeEmpty(container) {
  container.querySelector('.empty-state')?.remove();
}

function updateCount(role) {
  app.counts[role] += 1;
  const element = {
    user: ui.userCount,
    orchestrator: ui.orchestratorCount,
    claude: ui.claudeCount,
    codex: ui.codexCount,
    artifact: ui.artifactCount,
  }[role];
  if (element) element.textContent = String(app.counts[role]);
}

function metaValues(event) {
  return [
    event.stage || event.phase,
    event.round ? `R${String(event.round).replace(/^R/i, '')}` : '',
    event.cycle ? `Cycle ${event.cycle}` : '',
    event.planVersion || event.plan_version ? `Plan ${event.planVersion || event.plan_version}` : '',
    formatTime(event.t || event.time || event.timestamp),
  ].filter(Boolean);
}

function appendMeta(container, event, roleLabel) {
  const strong = document.createElement('strong');
  strong.textContent = roleLabel;
  container.append(strong);
  for (const value of metaValues(event)) {
    const span = document.createElement('span');
    span.textContent = value;
    container.append(span);
  }
}

function messageFingerprint(event, role, content) {
  return hash(stableStringify({
    role,
    kind: normalizeKind(event),
    turnId: event.turnId || event.turn_id,
    content,
    cycle: event.cycle,
    round: event.round,
    planVersion: event.planVersion || event.plan_version,
  }));
}

function renderUserMessage(event, content) {
  const key = messageFingerprint(event, 'user', content);
  if (app.renderedMessages.has(key)) return;
  app.renderedMessages.add(key);
  removeEmpty(ui.userMessages);

  const card = document.createElement('article');
  card.className = 'user-message';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  appendMeta(meta, event, event.intent || '사용자');
  const body = document.createElement('div');
  body.className = 'message-body';
  body.innerHTML = markdown(content);
  card.append(meta, body);
  ui.userMessages.append(card);
  updateCount('user');
  ui.userMessages.scrollLeft = ui.userMessages.scrollWidth;
}

function renderAgentMessage(event, role, content, dedupeKey = null) {
  const key = dedupeKey || messageFingerprint(event, role, content);
  if (app.renderedMessages.has(key)) return;
  app.renderedMessages.add(key);

  const container = {
    orchestrator: ui.orchestratorMessages,
    claude: ui.claudeMessages,
    codex: ui.codexMessages,
  }[role];
  if (!container) return;
  const nearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
  removeEmpty(container);

  const card = document.createElement('article');
  card.className = 'message-card';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  const labels = { orchestrator: 'Orchestrator', claude: 'Claude 워커', codex: 'ChatGPT 워커' };
  appendMeta(meta, event, labels[role]);
  const body = document.createElement('div');
  body.className = 'message-body';
  body.innerHTML = markdown(content);
  card.append(meta, body);
  container.append(card);
  while (container.children.length > 6) container.firstElementChild?.remove();
  updateCount(role);
  if (nearBottom) container.scrollTop = container.scrollHeight;
}

function renderWorkflowReturnMessage(event, content) {
  const clean = textFrom(content).trim();
  if (!clean || !ui.orchestratorReturnMessages) return;
  const key = `workflow-return:${messageFingerprint(event, 'orchestrator-return', clean)}`;
  if (app.renderedWorkflowReturns.has(key)) return;
  app.renderedWorkflowReturns.add(key);
  removeEmpty(ui.orchestratorReturnMessages);

  const card = document.createElement('article');
  card.className = 'message-card workflow-return-message';
  const meta = document.createElement('div');
  meta.className = 'message-meta';
  appendMeta(meta, event, 'Orchestrator 종합');
  const body = document.createElement('div');
  body.className = 'message-body';
  body.innerHTML = markdown(clean);
  card.append(meta, body);
  ui.orchestratorReturnMessages.append(card);
  while (ui.orchestratorReturnMessages.children.length > 6) {
    ui.orchestratorReturnMessages.firstElementChild?.remove();
  }
  ui.orchestratorReturnMessages.scrollTop = ui.orchestratorReturnMessages.scrollHeight;
}

function updateWorkflowFromEvent(event, role, kind, artifact) {
  recordWorkflowEvent(event);
  return;
  /* Legacy fixed-node renderer is intentionally bypassed by the Cycle renderer. */
  const phase = normalizePhase(event.phase || event.stage || app.phase);
  const content = publicContent(event);
  const artifactText = artifact === undefined ? '' : summaryNarrative(artifact);
  const statusText = content || artifactText;
  const artifactEvent = ARTIFACT_KINDS.has(kind) && artifact !== undefined;

  if (role === 'user') {
    workflowStatus('orchestrator', '사용자 지시를 수신해 과업을 정리하고 있습니다.');
    ui.workflowIngress?.classList.add('is-flowing');
    followWorkflowTarget('workflowOrchestratorTop');
    return;
  }

  if (role === 'claude' || role === 'codex') {
    if (statusText) workflowStatus(role, statusText);
    if (artifactEvent) workflowNodeState(role === 'claude' ? ui.workflowClaude : ui.workflowCodex, 'complete');
    else if (STATUS_KINDS.has(kind) && WORKFLOW_AGENT_PHASES.has(phase)) {
      workflowNodeState(role === 'claude' ? ui.workflowClaude : ui.workflowCodex, 'active');
    }
    followWorkflowTarget('workflowAgentGroup');
    return;
  }

  if (role === 'orchestrator') {
    const returning = WORKFLOW_RETURN_PHASES.has(phase);
    if (returning) {
      if (statusText) workflowStatus('return', statusText);
      if ((artifactEvent || MESSAGE_KINDS.has(kind)) && statusText) {
        renderWorkflowReturnMessage(event, artifactText || content);
      }
      followWorkflowTarget('workflowOrchestratorReturn');
    } else {
      if (statusText) workflowStatus('orchestrator', statusText);
      followWorkflowTarget('workflowOrchestratorTop');
    }
  }
}

function artifactNarrative(artifact) {
  if (typeof artifact === 'string') return artifact;
  if (!artifact || typeof artifact !== 'object') return '';
  if (artifact.artifactType === 'critique') {
    const strengths = Array.isArray(artifact.strengths)
      ? artifact.strengths.map((item) => `- 강점: ${item}`) : [];
    const issues = Array.isArray(artifact.issues)
      ? artifact.issues.map((item) => [
        `- [${item.severity || 'issue'}] ${item.description || ''}`,
        item.recommendation ? `  - 제안: ${item.recommendation}` : '',
      ].filter(Boolean).join('\n')) : [];
    return [`교차 비평 판정: ${artifact.verdict || '검토 완료'}`, ...strengths, ...issues].join('\n');
  }
  return [
    artifact.headline,
    artifact.executiveSummary,
    artifact.summary,
    artifact.objective,
    artifact.decision,
    artifact.assessment,
    artifact.recommendation,
    artifact.strongestWhy,
    artifact.biggestBlindSpot,
    artifact.allMissed,
    artifact.firstAction,
    artifact.planMarkdown,
  ].map(textFrom).filter((value, index, values) => value.trim() && values.indexOf(value) === index).join('\n\n');
}

function summaryNarrative(artifact) {
  if (typeof artifact === 'string') return artifact;
  if (!artifact || typeof artifact !== 'object') return '';
  const lines = [];
  [
    artifact.headline, artifact.executiveSummary, artifact.summary, artifact.objective,
    artifact.decision, artifact.assessment, artifact.recommendation, artifact.verdict,
    artifact.strongestWhy, artifact.biggestBlindSpot, artifact.allMissed, artifact.firstAction,
  ]
    .map(textFrom).filter(Boolean).forEach((value) => lines.push(value));
  for (const key of ['changeSummary', 'decisions', 'nextActions', 'strengths']) {
    const items = Array.isArray(artifact[key]) ? artifact[key].slice(0, 3) : [];
    for (const item of items) {
      if (typeof item === 'string') lines.push(item);
      else if (item && typeof item === 'object') {
        const value = textFrom(item.decision || item.action || item.summary || item.description || item.outcome);
        if (value) lines.push(value);
      }
    }
  }
  if (!lines.length) lines.push(artifactNarrative(artifact));
  return lines.filter(Boolean).join('\n');
}

function summaryRoleUi(role) {
  return {
    orchestrator: { body: ui.orchestratorSummary, meta: ui.orchestratorSummaryMeta },
    claude: { body: ui.claudeSummary, meta: ui.claudeSummaryMeta },
    codex: { body: ui.codexSummary, meta: ui.codexSummaryMeta },
  }[role];
}

function renderRoleSummary(role) {
  const target = summaryRoleUi(role);
  if (!target) return;
  const entries = app.summaries[role] || [];
  target.body.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.textContent = '아직 수행 기록이 없습니다.';
    target.body.append(empty);
    target.meta.textContent = '대기 중';
    return;
  }
  const list = document.createElement('ul');
  list.className = 'summary-points';
  for (const entry of [...entries].reverse().slice(0, 6)) {
    const item = document.createElement('li');
    const stage = document.createElement('span');
    stage.className = 'summary-stage';
    stage.textContent = entry.stage;
    const text = document.createElement('p');
    text.textContent = entry.text;
    item.append(stage, text);
    list.append(item);
  }
  target.body.append(list);
  target.meta.textContent = `${entries.length}건 · ${entries.at(-1).time}`;
}

function recordSummary(role, event, content) {
  if (!summaryRoleUi(role)) return;
  const normalized = textFrom(content).replace(/\s+/g, ' ').trim();
  if (!normalized) return;
  const stage = PHASE_LABELS[normalizePhase(event.stage || event.phase)]
    || artifactTitle(event, normalizeKind(event), event.artifact || event.data)
    || '업무 기록';
  const text = normalized.length > 360 ? `${normalized.slice(0, 357)}…` : normalized;
  const key = `${role}:${hash(text)}`;
  if (app.summaryKeys.has(key)) return;
  app.summaryKeys.add(key);
  app.summaries[role].push({ stage, text, time: formatTime(event.t || event.time || event.timestamp) || '방금' });
  app.summaries[role] = app.summaries[role].slice(-12);
  renderRoleSummary(role);
}

const HARNESS_UI = {
  orchestrator: {
    input: ui.orchestratorHarness,
    version: ui.orchestratorHarnessVersion,
    meta: ui.orchestratorHarnessMeta,
  },
  claudeWorker: {
    input: ui.claudeWorkerHarness,
    version: ui.claudeWorkerHarnessVersion,
    meta: ui.claudeWorkerHarnessMeta,
  },
  codexWorker: {
    input: ui.codexWorkerHarness,
    version: ui.codexWorkerHarnessVersion,
    meta: ui.codexWorkerHarnessMeta,
  },
};

function harnessText(raw) {
  if (typeof raw === 'string') return raw;
  if (!raw || typeof raw !== 'object') return '';
  const direct = textFrom(raw.content || raw.instructions || raw.text || raw.markdown || raw.prompt);
  if (direct) return direct;
  const sections = [];
  for (const [key, value] of Object.entries(raw)) {
    if (['version', 'updatedAt', 'updatedBy', 'history', 'hash'].includes(key)) continue;
    if (typeof value === 'string') sections.push(`## ${key}\n${value}`);
    else if (Array.isArray(value)) sections.push(`## ${key}\n${value.map((item) => `- ${textFrom(item) || JSON.stringify(item)}`).join('\n')}`);
  }
  return sections.join('\n\n');
}

function normalizeHarness(raw, role) {
  if (typeof raw === 'string') return { role, content: raw, version: 1 };
  const value = raw && typeof raw === 'object' ? raw : {};
  return {
    role,
    content: harnessText(value),
    version: Number(value.version || value.revision || value.rev) || 0,
    updatedAt: value.updatedAt || value.updated_at || null,
    updatedBy: textFrom(value.updatedBy || value.updated_by || value.author || ''),
    reason: textFrom(value.reason || value.changeReason || value.change_reason || ''),
  };
}

function extractHarnesses(source = {}) {
  const raw = source.harnesses || source.harness || source.currentHarnesses || source.current_harnesses
    || (source.orchestrator || source.claudeWorker || source.codexWorker ? source : {});
  return {
    orchestrator: raw.orchestrator || raw.director,
    claudeWorker: raw.claudeWorker || raw.claude_worker || raw.claude,
    codexWorker: raw.codexWorker || raw.codex_worker || raw.codex || raw.chatgpt,
  };
}

function renderHarnesses(source = {}, force = false) {
  const harnesses = extractHarnesses(source);
  const globalRevision = Number(
    source.harnessRevision || source.harness_revision || source.revision
    || source.harnesses?.revision || source.harnesses?.harnessRevision || app.state?.harnessRevision,
  ) || 0;
  let generated = 0;
  for (const role of Object.keys(HARNESS_UI)) {
    if (harnesses[role] === undefined) continue;
    const harness = normalizeHarness(harnesses[role], role);
    if (!harness.version && globalRevision) harness.version = globalRevision;
    app.harnesses[role] = harness;
    const target = HARNESS_UI[role];
    const metadata = [harness.updatedBy, harness.updatedAt ? formatTime(harness.updatedAt) : '', harness.reason]
      .filter(Boolean).join(' · ');
    const savedMeta = metadata || (harness.content ? 'Harness 적용됨' : '생성 전');
    if (!app.harnessDirty.has(role)) {
      target.input.value = harness.content;
      target.version.textContent = `v${harness.version}`;
      target.meta.textContent = savedMeta;
      target.input.dataset.version = String(harness.version);
      target.input.dataset.savedContent = harness.content;
      target.input.dataset.savedMeta = savedMeta;
    } else if (Number(target.input.dataset.version || 0) !== harness.version) {
      target.meta.textContent = `수정됨 · 서버 v${harness.version} 변경 감지 · 저장 시 충돌 확인`;
    }
    if (harness.content) generated += 1;
  }
  ui.harnessStatus.textContent = generated ? `${generated}/3 적용` : '지시 후 생성';
  if (globalRevision && generated) ui.harnessStatus.textContent = `Set v${globalRevision} · ${generated}/3`;
  if (globalRevision && app.activeSessionId) {
    if (globalRevision !== app.harnessHistoryCurrentRevision) app.harnessDiffChangeCount = null;
    scheduleHarnessHistoryLoad();
  }
}

const HARNESS_ROLE_LABELS = {
  all: '전체 Harness',
  orchestrator: 'Orchestrator',
  claudeWorker: 'Claude',
  codexWorker: 'ChatGPT',
};

function revisionNumber(value) {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return null;
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : null;
}

function currentHarnessRevision() {
  const candidates = [
    app.state?.harnessRevision,
    app.state?.harness_revision,
    app.state?.harnesses?.revision,
    app.harnessHistoryCurrentRevision,
  ];
  for (const candidate of candidates) {
    const revision = revisionNumber(candidate);
    if (revision !== null) return revision;
  }
  return 0;
}

function normalizeRevisionEntry(raw = {}, index = 0) {
  const value = raw && typeof raw === 'object' ? raw : { revision: raw };
  const revision = revisionNumber(value.revision ?? value.harnessRevision ?? value.version ?? value.rev ?? value.id);
  if (revision === null) return null;
  const integrity = textFrom(value.integrity || value.status || '').toLowerCase();
  const available = value.available !== false && !['invalid', 'missing', 'unavailable', 'corrupt'].includes(integrity);
  const changedRolesRaw = value.changedRoles || value.changed_roles || value.roles || [];
  const changedRoles = (Array.isArray(changedRolesRaw) ? changedRolesRaw : [changedRolesRaw])
    .map((role) => String(role))
    .filter((role) => Object.hasOwn(HARNESS_UI, role));
  return {
    revision,
    source: textFrom(value.source || value.updatedBy || value.updated_by || value.author || 'unknown'),
    cycle: revisionNumber(value.cycle),
    updatedAt: value.updatedAt || value.updated_at || value.createdAt || value.created_at || null,
    changedRoles,
    available,
    integrity: integrity || (available ? 'verified' : 'unavailable'),
    order: index,
  };
}

function normalizeHarnessHistory(payload = {}) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const candidates = Array.isArray(payload)
    ? payload
    : root.history || root.revisions || root.items || root.data?.history || root.data?.revisions || root.data?.items || [];
  const entries = (Array.isArray(candidates) ? candidates : [])
    .map(normalizeRevisionEntry)
    .filter(Boolean);
  const unique = [...new Map(entries.map((entry) => [entry.revision, entry])).values()]
    .sort((a, b) => b.revision - a.revision || a.order - b.order);
  const declaredCurrent = root.currentRevision ?? root.current_revision ?? root.harnessRevision
    ?? root.harness_revision ?? root.current?.revision ?? root.data?.currentRevision;
  const stateCurrent = revisionNumber(app.state?.harnessRevision ?? app.state?.harness_revision);
  const currentRevision = revisionNumber(declaredCurrent) ?? stateCurrent
    ?? unique.find((entry) => entry.available)?.revision ?? 0;
  return { entries: unique, currentRevision };
}

function revisionOptionLabel(entry, currentRevision) {
  const parts = [`v${entry.revision}`];
  if (entry.revision === currentRevision) parts.push('현재');
  else if (entry.source) parts.push(entry.source);
  if (!entry.available) parts.push('사용 불가');
  return parts.join(' · ');
}

function replaceRevisionOptions(select, entries, currentRevision, { currentAlias = false, preserve = '' } = {}) {
  select.replaceChildren();
  if (currentAlias) {
    const current = document.createElement('option');
    current.value = 'current';
    current.textContent = `현재 · v${currentRevision}`;
    select.append(current);
  }
  entries.filter((entry) => entry.available).forEach((entry) => {
    if (currentAlias && entry.revision === currentRevision) return;
    const option = document.createElement('option');
    option.value = String(entry.revision);
    option.textContent = revisionOptionLabel(entry, currentRevision);
    select.append(option);
  });
  if ([...select.options].some((option) => option.value === preserve)) select.value = preserve;
}

function renderHarnessHistory() {
  const currentRevision = app.harnessHistoryCurrentRevision;
  const priorFrom = ui.harnessDiffFrom.value;
  const priorTo = ui.harnessDiffTo.value;
  const canPreserveFrom = Boolean(priorFrom) && app.harnessHistory.some((entry) => (
    entry.available && String(entry.revision) === priorFrom
  ));
  app.harnessDiffChangeCount = null;
  ui.harnessRevisionList.replaceChildren();
  ui.harnessHistoryMeta.textContent = app.harnessHistory.length
    ? `${app.harnessHistory.length}개 · 현재 v${currentRevision}`
    : '이력 없음';

  if (!app.harnessHistory.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = '비교 가능한 Harness revision이 없습니다.';
    ui.harnessRevisionList.append(empty);
  } else {
    app.harnessHistory.forEach((entry) => {
      const item = document.createElement('div');
      item.className = 'revision-entry';
      item.classList.toggle('is-current', entry.revision === currentRevision);
      item.classList.toggle('is-unavailable', !entry.available);

      const choose = document.createElement('button');
      choose.type = 'button';
      choose.disabled = !entry.available;
      choose.setAttribute('aria-label', `Harness v${entry.revision}을 비교 기준으로 선택`);
      const title = document.createElement('strong');
      title.textContent = `Revision ${entry.revision}`;
      const meta = document.createElement('small');
      meta.textContent = [entry.source, entry.cycle !== null ? `Cycle ${entry.cycle}` : '', entry.updatedAt ? formatTime(entry.updatedAt) : '']
        .filter(Boolean).join(' · ');
      choose.append(title, meta);

      const badge = document.createElement('span');
      badge.className = 'revision-badge';
      badge.textContent = entry.revision === currentRevision ? 'CURRENT' : entry.available ? 'VERIFIED' : entry.integrity.toUpperCase();
      const roles = document.createElement('span');
      roles.className = 'revision-roles';
      roles.textContent = entry.changedRoles.length
        ? `변경: ${entry.changedRoles.map((role) => HARNESS_ROLE_LABELS[role]).join(', ')}`
        : '변경 범위 기록 없음';
      choose.addEventListener('click', () => {
        if (![...ui.harnessDiffFrom.options].some((option) => option.value === String(entry.revision))) return;
        ui.harnessDiffFrom.value = String(entry.revision);
        app.harnessDiffChangeCount = null;
        updateHarnessHistoryControls();
        loadHarnessDiff().catch(() => {});
      });
      item.append(choose, badge, roles);
      ui.harnessRevisionList.append(item);
    });
  }

  replaceRevisionOptions(ui.harnessDiffFrom, app.harnessHistory, currentRevision, { preserve: priorFrom });
  replaceRevisionOptions(ui.harnessDiffTo, app.harnessHistory, currentRevision, { currentAlias: true, preserve: priorTo || 'current' });
  if (!canPreserveFrom) {
    const baseline = app.harnessHistory.find((entry) => entry.available && entry.revision !== currentRevision)
      || app.harnessHistory.find((entry) => entry.available);
    if (baseline) ui.harnessDiffFrom.value = String(baseline.revision);
  }
  updateHarnessHistoryControls();
}

function normalizeDiffChange(raw = {}) {
  const value = raw && typeof raw === 'object' ? raw : { after: raw };
  const has = (key) => Object.prototype.hasOwnProperty.call(value, key);
  return {
    role: textFrom(value.role || value.harnessRole || value.harness_role || ''),
    path: textFrom(value.path || value.field || value.fieldPath || value.field_path || value.key || '/'),
    type: textFrom(value.type || value.changeType || value.change_type || value.operation || value.op || 'modified'),
    before: has('before') ? value.before : has('oldValue') ? value.oldValue : has('old_value') ? value.old_value : value.from,
    after: has('after') ? value.after : has('newValue') ? value.newValue : has('new_value') ? value.new_value : value.to,
  };
}

function normalizeHarnessDiff(payload = {}, requestedRole = 'all') {
  const root = payload?.diff || payload?.data?.diff || payload?.data || payload || {};
  const roleMap = root.changesByRole || root.changes_by_role || root.roles || {};
  const changesByRole = Object.fromEntries(Object.keys(HARNESS_UI).map((role) => {
    let changes = roleMap?.[role];
    if (changes && !Array.isArray(changes)) changes = changes.changes || changes.items;
    return [role, (Array.isArray(changes) ? changes : []).map(normalizeDiffChange)];
  }));
  const flat = Array.isArray(root.changes) ? root.changes.map(normalizeDiffChange) : [];
  if (flat.length) {
    if (requestedRole !== 'all') changesByRole[requestedRole] = flat;
    else flat.forEach((change) => {
      const role = Object.hasOwn(HARNESS_UI, change.role) ? change.role : 'orchestrator';
      changesByRole[role].push(change);
    });
  }
  return {
    fromRevision: revisionNumber(root.fromRevision ?? root.from_revision ?? root.beforeRevision) ?? revisionNumber(ui.harnessDiffFrom.value),
    toRevision: revisionNumber(root.toRevision ?? root.to_revision ?? root.afterRevision) ?? currentHarnessRevision(),
    role: Object.hasOwn(HARNESS_ROLE_LABELS, root.role) ? root.role : requestedRole,
    changesByRole,
  };
}

function diffValueText(value) {
  if (value === undefined) return '—';
  if (value === null) return 'null';
  if (typeof value === 'string') return value || '(빈 문자열)';
  try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
}

function renderHarnessDiff(diff) {
  ui.harnessDiffOutput.replaceChildren();
  const roles = diff.role === 'all' ? Object.keys(HARNESS_UI) : [diff.role];
  const changed = roles.filter((role) => (diff.changesByRole[role] || []).length);
  app.harnessDiffChangeCount = changed.reduce((sum, role) => sum + diff.changesByRole[role].length, 0);
  ui.harnessDiffStatus.textContent = `v${diff.fromRevision} → v${diff.toRevision} · ${HARNESS_ROLE_LABELS[diff.role] || '전체 Harness'} · ${app.harnessDiffChangeCount}개 필드 변경`;
  if (!changed.length) {
    const empty = document.createElement('p');
    empty.className = 'diff-empty';
    empty.textContent = '선택한 범위에 변경된 필드가 없습니다.';
    ui.harnessDiffOutput.append(empty);
    return;
  }
  changed.forEach((role) => {
    const group = document.createElement('section');
    group.className = 'diff-role-group';
    group.setAttribute('aria-label', `${HARNESS_ROLE_LABELS[role]} Harness 변경`);
    const heading = document.createElement('h4');
    heading.className = 'diff-role-heading';
    const label = document.createElement('span');
    label.textContent = HARNESS_ROLE_LABELS[role];
    const count = document.createElement('small');
    count.textContent = `${diff.changesByRole[role].length} fields`;
    heading.append(label, count);
    group.append(heading);
    diff.changesByRole[role].forEach((change) => {
      const article = document.createElement('article');
      article.className = 'diff-change';
      const head = document.createElement('div');
      head.className = 'diff-change-head';
      const path = document.createElement('span');
      path.className = 'diff-path';
      path.textContent = change.path;
      const type = document.createElement('span');
      type.className = 'diff-type';
      type.textContent = change.type;
      head.append(path, type);
      const values = document.createElement('div');
      values.className = 'diff-values';
      [['Before', change.before], ['After', change.after]].forEach(([name, value]) => {
        const cell = document.createElement('div');
        cell.className = 'diff-value';
        const cellLabel = document.createElement('span');
        cellLabel.textContent = name;
        const pre = document.createElement('pre');
        pre.textContent = diffValueText(value);
        cell.append(cellLabel, pre);
        values.append(cell);
      });
      article.append(head, values);
      group.append(article);
    });
    ui.harnessDiffOutput.append(group);
  });
}

function updateHarnessHistoryControls() {
  const selected = revisionNumber(ui.harnessDiffFrom.value);
  const current = currentHarnessRevision();
  const role = ui.harnessDiffRole.value || 'all';
  const busy = BUSY_PHASES.has(app.phase);
  let reason = '';
  if (app.securityBlocked) reason = '접속 보안 확인 전에는 rollback할 수 없습니다.';
  else if (selected === null) reason = 'rollback할 기준 revision을 선택하세요.';
  else if (selected === current) reason = '현재 revision과 같은 버전은 rollback할 수 없습니다.';
  else if (app.harnessDiffChangeCount === 0) reason = '선택한 범위의 내용이 현재 Harness와 같습니다.';
  else if (app.harnessDirty.size) reason = '저장하지 않은 Harness 수정이 있어 rollback할 수 없습니다.';
  else if (app.archived) reason = '보관된 세션은 읽기 전용입니다. 먼저 복원하세요.';
  else if (busy) reason = 'Council 실행 중에는 rollback할 수 없습니다.';
  else if (app.harnessHistoryLoading) reason = 'Harness 이력을 불러오는 중입니다.';
  ui.rollbackHarness.disabled = Boolean(reason);
  ui.rollbackHarness.textContent = `${HARNESS_ROLE_LABELS[role] || '전체 Harness'} · v${selected ?? '—'}로 rollback`;
  ui.rollbackHarness.title = reason;
  ui.harnessRollbackHint.textContent = reason || 'Rollback은 과거 파일을 덮어쓰지 않고 새 revision으로 기록됩니다.';
  ui.loadHarnessDiff.disabled = selected === null || app.harnessHistoryLoading;
}

async function loadHarnessHistory({ autoDiff = true } = {}) {
  if (!app.activeSessionId) return [];
  const sessionId = app.activeSessionId;
  const requestId = ++app.harnessHistoryRequest;
  app.harnessHistoryLoading = true;
  ui.harnessHistoryMeta.textContent = '불러오는 중';
  updateHarnessHistoryControls();
  try {
    const payload = await requestJson('/api/harnesses/history');
    if (requestId !== app.harnessHistoryRequest || sessionId !== app.activeSessionId) return [];
    const normalized = normalizeHarnessHistory(payload);
    app.harnessHistory = normalized.entries;
    app.harnessHistoryCurrentRevision = normalized.currentRevision;
    app.state = { ...(app.state || {}), harnessRevision: normalized.currentRevision };
    renderHarnessHistory();
    if (autoDiff && ui.harnessDiffFrom.value) await loadHarnessDiff({ silent: true });
    return normalized.entries;
  } catch (_) {
    if (requestId !== app.harnessHistoryRequest || sessionId !== app.activeSessionId) return [];
    app.harnessHistory = [];
    replaceRevisionOptions(ui.harnessDiffFrom, [], currentHarnessRevision());
    replaceRevisionOptions(ui.harnessDiffTo, [], currentHarnessRevision(), { currentAlias: true });
    ui.harnessRevisionList.replaceChildren();
    const empty = document.createElement('p');
    empty.className = 'empty-state';
    empty.textContent = 'Harness revision 이력을 불러올 수 없습니다.';
    ui.harnessRevisionList.append(empty);
    ui.harnessHistoryMeta.textContent = '이력 사용 불가';
    ui.harnessDiffStatus.textContent = '현재 서버에서 revision history API를 사용할 수 없습니다.';
    ui.harnessDiffOutput.replaceChildren();
    return [];
  } finally {
    if (requestId === app.harnessHistoryRequest) {
      app.harnessHistoryLoading = false;
      updateHarnessHistoryControls();
    }
  }
}

function scheduleHarnessHistoryLoad() {
  const key = `${app.activeSessionId || ''}:${currentHarnessRevision()}`;
  if (!app.activeSessionId || app.harnessHistoryLoadKey === key) return;
  app.harnessHistoryLoadKey = key;
  queueMicrotask(() => loadHarnessHistory().catch(() => {}));
}

function resetHarnessHistoryView() {
  app.harnessHistoryRequest += 1;
  app.harnessHistory = [];
  app.harnessHistoryCurrentRevision = 0;
  app.harnessHistoryLoading = false;
  app.harnessDiffChangeCount = null;
  app.harnessHistoryLoadKey = '';
  ui.harnessHistoryMeta.textContent = '이력 확인';
  ui.harnessRevisionList.replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = '저장된 revision을 불러오는 중입니다.';
  ui.harnessRevisionList.append(empty);
  replaceRevisionOptions(ui.harnessDiffFrom, [], 0);
  replaceRevisionOptions(ui.harnessDiffTo, [], 0, { currentAlias: true });
  ui.harnessDiffOutput.replaceChildren();
  ui.harnessDiffStatus.textContent = '비교할 revision을 선택하세요.';
  updateHarnessHistoryControls();
}

async function loadHarnessDiff({ silent = false } = {}) {
  const from = revisionNumber(ui.harnessDiffFrom.value);
  if (from === null) {
    if (!silent) ui.harnessDiffStatus.textContent = '비교할 기준 revision을 선택하세요.';
    updateHarnessHistoryControls();
    return null;
  }
  const toSelection = ui.harnessDiffTo.value || 'current';
  const to = toSelection === 'current' ? String(currentHarnessRevision()) : toSelection;
  const role = ui.harnessDiffRole.value || 'all';
  ui.loadHarnessDiff.disabled = true;
  ui.harnessDiffStatus.textContent = 'Harness 차이를 불러오는 중입니다…';
  try {
    const params = new URLSearchParams({ from: String(from), to, role });
    const payload = await requestJson(`/api/harnesses/diff?${params}`);
    const diff = normalizeHarnessDiff(payload, role);
    renderHarnessDiff(diff);
    return diff;
  } catch (error) {
    ui.harnessDiffOutput.replaceChildren();
    app.harnessDiffChangeCount = null;
    ui.harnessDiffStatus.textContent = `차이를 불러오지 못했습니다: ${error.message || error}`;
    if (!silent) showError(error.message || String(error), true);
    return null;
  } finally {
    updateHarnessHistoryControls();
  }
}

async function rollbackHarnessRevision() {
  const targetRevision = revisionNumber(ui.harnessDiffFrom.value);
  const role = ui.harnessDiffRole.value || 'all';
  const currentRevision = currentHarnessRevision();
  if (app.harnessDirty.size) {
    showError('저장하지 않은 Harness 수정이 있습니다. 저장하거나 되돌린 뒤 rollback하세요.', true);
    return;
  }
  if (app.archived || BUSY_PHASES.has(app.phase) || targetRevision === null || targetRevision === currentRevision) {
    updateHarnessHistoryControls();
    return;
  }
  const scope = HARNESS_ROLE_LABELS[role] || '전체 Harness';
  const confirmed = window.confirm(`${scope}의 사용자 고정 필드를 유지한 채 revision ${targetRevision} 기준으로 rollback할까요?\n\n현재 revision은 이력에 보존되고 rollback 결과가 새 revision으로 기록됩니다.`);
  if (!confirmed) return;
  await performAction(ui.rollbackHarness, async () => {
    const body = { targetRevision };
    if (role !== 'all') body.role = role;
    const payload = await post('/api/harnesses/rollback', body, {
      'If-Match': `"harness-${currentRevision}"`,
    });
    const state = payload.state || payload.sessionState || payload.session_state;
    if (state) {
      const nextRevision = revisionNumber(state.harnessRevision ?? state.harness_revision) ?? currentRevision;
      app.harnessHistoryLoadKey = `${app.activeSessionId || ''}:${nextRevision}`;
      renderState(state, true);
    } else {
      const revision = revisionNumber(payload.revision ?? payload.harnessRevision ?? payload.harness_revision);
      app.state = { ...(app.state || {}), ...(revision === null ? {} : { harnessRevision: revision }) };
      app.harnessHistoryLoadKey = `${app.activeSessionId || ''}:${revision ?? currentRevision}`;
      renderHarnesses(payload, true);
    }
    await loadHarnessHistory();
    setTicker(`${scope}를 v${targetRevision} 기준으로 rollback하고 새 revision을 만들었습니다.`);
  }).catch(() => {});
}

function artifactFromEvent(event, kind) {
  let value = event.artifact || event.payload?.artifact || event.data || event.result;
  if (!value && ARTIFACT_KINDS.has(kind)) value = event.content || event.output;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try { value = JSON.parse(trimmed); } catch (_) { value = trimmed; }
    }
  }
  return value;
}

function structuredNode(value) {
  if (value === null || value === undefined) {
    const span = document.createElement('span');
    span.className = 'structured-value';
    span.textContent = '없음';
    return span;
  }
  if (Array.isArray(value)) {
    const list = document.createElement('ol');
    list.className = 'structured-list';
    for (const item of value) {
      const li = document.createElement('li');
      li.append(structuredNode(item));
      list.append(li);
    }
    return list;
  }
  if (typeof value === 'object') {
    const list = document.createElement('dl');
    list.className = 'structured-grid';
    for (const [key, item] of Object.entries(value)) {
      const field = document.createElement('div');
      field.className = 'structured-field';
      const term = document.createElement('dt');
      term.textContent = key.replace(/_/g, ' ');
      const detail = document.createElement('dd');
      detail.append(structuredNode(item));
      field.append(term, detail);
      list.append(field);
    }
    return list;
  }
  if (typeof value === 'string' && value.startsWith('/api/council/artifacts/')) {
    const link = document.createElement('a');
    link.className = 'structured-value';
    link.href = value;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = value.endsWith('.html') ? 'Council HTML 보고서 열기' : 'Council 트랜스크립트 열기';
    return link;
  }
  const paragraph = document.createElement('p');
  paragraph.className = 'structured-value';
  paragraph.textContent = String(value);
  return paragraph;
}

function artifactTitle(event, kind, artifact) {
  if (typeof artifact === 'object' && artifact) {
    return textFrom(artifact.title || artifact.name || artifact.artifactType || artifact.type || artifact.schema)
      || (kind === 'checkpoint' ? '통합 1차 기획안' : '구조화 산출물');
  }
  const labels = {
    checkpoint: '통합 1차 기획안', evaluation: '기획안 평가', task_package: '워커 과업 명세',
    draft_artifact: '기획 초안', critique_artifact: '교차 비평', revision_artifact: '개정안',
    synthesis_artifact: '통합 기획안', plan: '통합 기획안',
  };
  return labels[kind] || event.title || '구조화 산출물';
}

function renderArtifact(event, kind, rawArtifact) {
  if (rawArtifact === undefined || rawArtifact === null || rawArtifact === '') return;
  const artifact = sanitizePublic(rawArtifact);
  const key = hash(stableStringify({ artifact, cycle: event.cycle, version: event.planVersion || event.plan_version }));
  if (app.renderedArtifacts.has(key)) return;
  app.renderedArtifacts.add(key);

  const card = document.createElement('details');
  card.className = 'artifact-card';
  const artifactType = String(event.artifactType || event.artifact_type
    || artifact?.artifactType || artifact?.type || kind || '').toLowerCase();
  card.dataset.artifactType = artifactType;
  card.dataset.cycle = String(Number(event.cycle) || 0);
  card.dataset.finalArtifact = String([
    'plan', 'synthesis', 'council_verdict', 'council_reports', 'council_clarification',
  ].some((type) => artifactType.includes(type)));
  card.open = ['checkpoint', 'plan', 'synthesis_artifact'].includes(kind)
    || artifact?.artifactType === 'synthesis';
  const header = document.createElement('summary');
  const title = document.createElement('h3');
  title.textContent = artifactTitle(event, kind, artifact);
  const meta = document.createElement('div');
  meta.className = 'artifact-meta';
  for (const value of metaValues(event)) {
    const span = document.createElement('span');
    span.textContent = value;
    meta.append(span);
  }
  header.append(title, meta);

  const body = document.createElement('div');
  body.className = 'artifact-body';
  let materialized = false;
  const materialize = () => {
    if (materialized) return;
    materialized = true;
    body.replaceChildren();
    if (typeof artifact === 'string') body.innerHTML = markdown(artifact);
    else body.append(structuredNode(artifact));
  };
  if (card.open) materialize();
  else {
    const hint = document.createElement('p');
    hint.className = 'structured-value';
    hint.textContent = '펼치면 세부 내용을 불러옵니다.';
    body.append(hint);
    card.addEventListener('toggle', () => { if (card.open) materialize(); }, { once: true });
  }
  card.append(header, body);
  ui.artifactList.append(card);
  ui.artifactSection.classList.remove('hidden');
  updateCount('artifact');
  applyArtifactFilter();
}

function applyArtifactFilter() {
  const filter = ui.artifactFilter?.value || 'final';
  [...ui.artifactList.children].forEach((card) => {
    const visible = filter === 'all'
      || (filter === 'current' && Number(card.dataset.cycle) === Number(app.cycle))
      || (filter === 'final' && card.dataset.finalArtifact === 'true');
    card.classList.toggle('hidden', !visible);
  });
}

function addActivity(event, text) {
  const content = textFrom(text).trim();
  if (!content) return;
  setTicker(content, false);
  const key = event.fallback || event.circuit
    ? `exception:${event.id || hash(content)}`
    : `${event.cycle || 0}:${event.phase || ''}:${event.logicalRole || event.role || ''}:${event.artifactType || ''}`;
  const existing = [...ui.activityLog.children].find((item) => item.dataset.activityKey === key);
  if (existing) {
    existing.textContent = content;
    existing.title = content;
    return;
  }
  const item = document.createElement('li');
  item.dataset.activityKey = key;
  item.textContent = content;
  item.title = content;
  ui.activityLog.append(item);
  while (ui.activityLog.children.length > 8) ui.activityLog.firstElementChild.remove();
  ui.activityLog.scrollLeft = ui.activityLog.scrollWidth;
}

function applyEventMetadata(event) {
  const phase = event.phase || event.stage || event.state;
  if (phase && PHASE_LABELS[normalizePhase(phase)]) setPhase(phase);
  updateMeta(event);
  const eventQuestions = extractQuestions(event);
  if (hasQuestionContract(event) || eventQuestions.required.length || eventQuestions.optional.length) {
    renderQuestions(eventQuestions.required, eventQuestions.optional);
  }
}

function handleEvent(event, messageEvent = null) {
  if (!event || typeof event !== 'object' || event.public === false) return;
  const eventSessionId = event.sessionId || event.session_id || event.sessionKey;
  if (app.activeSessionId && eventSessionId && eventSessionId !== app.activeSessionId) return;
  const kind = normalizeKind(event);
  if (PRIVATE_KINDS.test(kind)) return;

  const identity = eventIdentity(event, messageEvent);
  if (app.seenEvents.has(identity)) return;
  app.seenEvents.add(identity);
  applyEventMetadata(event);
  const role = normalizeRole(event.role || event.agent || event.actor);
  const declaredArtifactType = String(event.artifactType || event.artifact_type || '').toLowerCase();

  if (kind === 'config' && declaredArtifactType.includes('harness')) {
    requestJson('/api/state').then((latest) => {
      app.state = latest;
      renderHarnesses(latest, false);
    }).catch(() => {});
  }

  if (kind === 'error' || kind === 'run.failed' || kind === 'run_failed') {
    const message = publicContent(event) || event.error?.message || event.message || '실행 중 오류가 발생했습니다.';
    setPhase(event.phase || 'failed');
    setTicker(`오류: ${message}`, true);
    showError(message);
    recordWorkflowEvent(event);
    return;
  }

  if (kind === 'question.required' || kind === 'question_required') {
    const required = extractQuestions(event).required;
    const single = questionText(event.question || event.content);
    renderQuestions(required.length ? required : [single].filter(Boolean), app.optionalQuestions);
    setPhase(event.phase || 'waiting_user_input');
  }
  if (kind === 'approval.required' || kind === 'approval_required') setPhase(event.phase || 'waiting_approval');

  const artifact = artifactFromEvent(event, kind);
  updateWorkflowFromEvent(event, role, kind, artifact);
  if (ARTIFACT_KINDS.has(kind) && artifact !== undefined) {
    renderArtifact(event, kind, artifact);
    const narrative = artifactNarrative(artifact);
    if (narrative && role && !['system', 'user'].includes(role)) {
      renderAgentMessage(event, role, narrative, `artifact-message:${hash(stableStringify(artifact))}`);
      recordSummary(role, event, summaryNarrative(artifact));
    }
    const artifactType = String(event.artifactType || event.artifact_type || artifact?.artifactType || artifact?.type || '').toLowerCase();
    if (kind.includes('harness') || artifactType.includes('harness')) {
      const wholeSet = artifact?.harnesses || artifact?.orchestrator || artifact?.claudeWorker || artifact?.codexWorker;
      renderHarnesses(wholeSet ? artifact : (event.harnesses ? event : {
        harnesses: { [role === 'claude' ? 'claudeWorker' : role === 'codex' ? 'codexWorker' : 'orchestrator']: artifact },
      }), false);
    }
    if (artifact && typeof artifact === 'object') {
      const artifactQuestions = extractQuestions(artifact);
      if (hasQuestionContract(artifact) || artifactQuestions.required.length || artifactQuestions.optional.length) {
        renderQuestions(artifactQuestions.required, artifactQuestions.optional);
      }
    }
  }

  const content = publicContent(event);
  if (content && MESSAGE_KINDS.has(kind)) {
    if (role === 'user') renderUserMessage(event, content);
    else if (role && role !== 'system') {
      renderAgentMessage(event, role, content);
      recordSummary(role, event, content);
    }
  }

  if (STATUS_KINDS.has(kind)) {
    const fallback = `${role && role !== 'system' ? role : 'Council'} · ${kind.replace(/[._]/g, ' ')}`;
    addActivity(event, content || event.label || fallback);
  }
}

function resetRendered() {
  app.seenEvents.clear();
  app.renderedMessages.clear();
  app.renderedWorkflowReturns.clear();
  app.renderedArtifacts.clear();
  app.summaryKeys.clear();
  app.summaries = { orchestrator: [], claude: [], codex: [] };
  app.counts = { user: 0, orchestrator: 0, claude: 0, codex: 0, artifact: 0 };
  app.workflowEvents = [];
  ui.userCount.textContent = '0';
  ui.orchestratorCount.textContent = '0';
  ui.claudeCount.textContent = '0';
  ui.codexCount.textContent = '0';
  ui.artifactCount.textContent = '0';
  ui.userMessages.innerHTML = '<p class="empty-state">아직 입력한 지시가 없습니다.</p>';
  ui.orchestratorMessages.innerHTML = '<p class="empty-state">과업 배분, Harness 변경, 통합 결과가 표시됩니다.</p>';
  ui.claudeMessages.innerHTML = '<p class="empty-state">Claude의 공개 초안과 비평이 여기에 표시됩니다.</p>';
  ui.codexMessages.innerHTML = '<p class="empty-state">ChatGPT의 공개 초안과 비평이 여기에 표시됩니다.</p>';
  ui.orchestratorReturnMessages.innerHTML = '<p class="empty-state">Agent 결과가 돌아오면 통합 판단이 이곳에 생성됩니다.</p>';
  ui.workflowCycles?.replaceChildren();
  setWorkflowFollow(true);
  ui.artifactList.replaceChildren();
  ui.artifactSection.classList.add('hidden');
  ui.activityLog.replaceChildren();
  ['orchestrator', 'claude', 'codex'].forEach(renderRoleSummary);
}

function renderState(state, reset = true) {
  const priorSessionId = app.activeSessionId;
  const nextSessionId = state.sessionId || state.session_id || state.sessionKey || priorSessionId;
  if (priorSessionId && nextSessionId && String(priorSessionId) !== String(nextSessionId)) {
    resetHarnessHistoryView();
  }
  app.state = state || {};
  app.activeSessionId = nextSessionId;
  app.archived = Boolean(state.archivedAt || state.sessionMetadata?.archivedAt);
  if (reset) resetRendered();
  app.workflowReplay = true;
  setPhase(state.phase || state.status || 'ready');
  updateMeta(state);
  applyArtifactFilter();
  const questions = extractQuestions(state);
  renderQuestions(questions.required, questions.optional);
  renderHarnesses(state, true);

  const events = state.publicEvents || state.public_events || state.events || state.transcript || state.messages || [];
  if (Array.isArray(events)) events.forEach((event) => handleEvent(event));

  const artifacts = state.artifacts || state.outputs || [];
  if (Array.isArray(artifacts)) {
    artifacts.forEach((artifact, index) => renderArtifact({
      artifact,
      cycle: state.cycle,
      planVersion: state.planVersion || state.plan_version,
      id: `state-artifact-${index}`,
    }, 'artifact', artifact));
  }
  if (state.currentPlan || state.current_plan) {
    const plan = state.currentPlan || state.current_plan;
    renderArtifact({
      artifact: plan,
      cycle: state.cycle,
      planVersion: state.planVersion || state.plan_version,
      id: 'current-plan',
    }, 'plan', plan);
  }

  // 과거 이벤트 재생이 현재 상태를 이전 단계로 되돌리지 않도록 서버 상태를 마지막에 재적용한다.
  app.workflowReplay = false;
  renderWorkflowCycles();
  setPhase(state.phase || state.status || 'ready');
  followWorkflowTarget(app.workflowTarget, true);
  updateMeta(state);
  renderQuestions(questions.required, questions.optional);
  renderHarnesses(state, true);

  const error = state.error?.message || state.lastError?.message || state.last_error?.message || state.error;
  showError(error || '');
  if (error) setTicker(`오류: ${error}`, true);
  else if (BUSY_PHASES.has(app.phase)) setTicker(`${PHASE_LABELS[app.phase] || app.phase} 단계가 진행 중입니다.`);
  else if (FEEDBACK_PHASES.has(app.phase)) setTicker('Orchestrator 결과를 확인하고 승인하거나 피드백을 보내세요.');
  else if (TERMINAL_PHASES.has(app.phase)) {
    setTicker(state.config?.mode === 'decision_council'
      ? 'Council 최종 판단이 승인되었습니다.'
      : '기획안이 승인되어 MVP 기획 루프가 완료되었습니다.');
  }
  else setTicker('새 지시를 입력할 준비가 되었습니다.');
  scheduleHarnessHistoryLoad();
}

async function requestJson(url, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const mutation = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const accessMode = textFrom(app.securityContext?.accessMode || app.securityContext?.access_mode || '').toLowerCase();
  const remote = accessMode && !['local', 'localhost', 'loopback'].includes(accessMode);
  const csrfToken = app.securityContext?.csrfToken || app.securityContext?.csrf_token;
  if (mutation && remote && !csrfToken) {
    throw new Error('원격 변경 요청에 필요한 CSRF 보안 토큰이 없습니다. 페이지를 새로고침하세요.');
  }
  const sessionHeaders = app.activeSessionId
    ? { 'X-AI-Council-Session': app.activeSessionId }
    : {};
  const securityHeaders = mutation && remote
    ? { 'X-AI-Council-CSRF': String(csrfToken) }
    : {};
  const response = await fetch(url, {
    cache: 'no-store',
    ...options,
    headers: {
      Accept: 'application/json',
      'X-AI-Council-Request': '1',
      ...sessionHeaders,
      ...securityHeaders,
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || payload.error || payload.message || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function post(url, body = {}, headers = {}) {
  return requestJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function put(url, body = {}) {
  return requestJson(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function patch(url, body = {}, headers = {}) {
  return requestJson(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function sessionTitleFromState(state = {}) {
  const events = state.publicEvents || state.transcript || [];
  const firstUser = Array.isArray(events)
    ? events.find((event) => normalizeRole(event.role || event.actor) === 'user' && publicContent(event))
    : null;
  const title = textFrom(state.sessionTitle || state.title || state.name || (firstUser && publicContent(firstUser)))
    .replace(/\s+/g, ' ').trim();
  return title ? (title.length > 42 ? `${title.slice(0, 39)}…` : title) : '새 Council 세션';
}

function normalizeSession(item = {}, index = 0) {
  const id = String(item.id || item.sessionId || item.session_id || item.sessionKey || item.key || '');
  return {
    id,
    title: textFrom(item.title || item.name) || `Council 세션 ${index + 1}`,
    phase: normalizePhase(item.phase || item.status || 'ready'),
    cycle: Number(item.cycle) || 0,
    updatedAt: item.updatedAt || item.updated_at || item.createdAt || item.created_at,
    archivedAt: item.archivedAt || item.archived_at || null,
    metadataVersion: Math.max(1, Number(item.metadataVersion || item.metadata_version) || 1),
    active: Boolean(item.active || item.isActive),
  };
}

function fallbackSession(state = app.state || {}) {
  const id = String(state.sessionId || state.session_id || state.sessionKey || app.activeSessionId || 'active');
  return normalizeSession({
    id,
    title: sessionTitleFromState(state),
    phase: state.phase,
    cycle: state.cycle,
    updatedAt: state.updatedAt,
    archivedAt: state.archivedAt || state.sessionMetadata?.archivedAt,
    metadataVersion: state.metadataVersion || state.sessionMetadata?.metadataVersion,
    active: true,
  });
}

function renderSessions(sessions = [], activeSessionId = app.activeSessionId) {
  const normalized = sessions.map(normalizeSession).filter((item) => item.id);
  app.sessions = normalized;
  if (activeSessionId) app.activeSessionId = String(activeSessionId);
  ui.sessionList.replaceChildren();
  ui.sessionCount.textContent = String(normalized.length);
  if (!normalized.length) {
    const empty = document.createElement('p');
    empty.className = 'empty-state rail-label';
    empty.textContent = '저장된 세션이 없습니다.';
    ui.sessionList.append(empty);
    return;
  }
  normalized.forEach((session, index) => {
    const item = document.createElement('div');
    item.className = 'session-item';
    item.dataset.sessionId = session.id;
    item.dataset.archived = String(Boolean(session.archivedAt));
    const active = session.id === app.activeSessionId || session.active;
    item.setAttribute('aria-current', active ? 'true' : 'false');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'session-open';
    button.setAttribute('aria-label', `${session.title}, ${session.archivedAt ? '보관됨' : (PHASE_LABELS[session.phase] || session.phase)}${session.cycle ? `, Cycle ${session.cycle}` : ''}`);
    button.title = `${session.title} · ${session.archivedAt ? '보관됨' : (PHASE_LABELS[session.phase] || session.phase)}`;
    const number = document.createElement('span');
    number.className = 'session-index';
    number.setAttribute('aria-hidden', 'true');
    number.textContent = String(index + 1).padStart(2, '0');
    const copy = document.createElement('span');
    copy.className = 'session-item-copy';
    const title = document.createElement('strong');
    title.textContent = session.title;
    const meta = document.createElement('small');
    const time = session.updatedAt ? formatTime(session.updatedAt) : '';
    meta.textContent = [session.archivedAt ? '보관됨' : (PHASE_LABELS[session.phase] || session.phase), session.cycle ? `Cycle ${session.cycle}` : '', time]
      .filter(Boolean).join(' · ');
    copy.append(title, meta);
    button.append(number, copy);
    button.addEventListener('click', () => {
      if (isMobileWorkspace() && session.id === app.activeSessionId) {
        setMobileWorkspaceView('chat', { focusPanel: true });
        return;
      }
      activateSession(session.id);
    });

    const actions = document.createElement('div');
    actions.className = 'session-actions rail-label';
    const renameButton = document.createElement('button');
    renameButton.type = 'button';
    renameButton.className = 'session-action';
    renameButton.textContent = '이름';
    renameButton.setAttribute('aria-label', `${session.title} 이름 변경`);
    const archiveButton = document.createElement('button');
    archiveButton.type = 'button';
    archiveButton.className = 'session-action';
    archiveButton.textContent = session.archivedAt ? '복원' : '보관';
    archiveButton.setAttribute('aria-label', `${session.title} ${session.archivedAt ? '복원' : '보관'}`);
    actions.append(renameButton, archiveButton);

    const editor = document.createElement('form');
    editor.className = 'session-rename rail-label hidden';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 120;
    input.value = session.title;
    input.setAttribute('aria-label', '새 세션 이름');
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'session-action';
    save.textContent = '저장';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'session-action';
    cancel.textContent = '취소';
    editor.append(input, save, cancel);

    renameButton.addEventListener('click', () => {
      button.classList.add('hidden');
      actions.classList.add('hidden');
      editor.classList.remove('hidden');
      input.focus();
      input.select();
    });
    cancel.addEventListener('click', () => {
      input.value = session.title;
      editor.classList.add('hidden');
      button.classList.remove('hidden');
      actions.classList.remove('hidden');
    });
    editor.addEventListener('submit', (event) => {
      event.preventDefault();
      updateSessionMetadata(session, { title: input.value }, save);
    });
    archiveButton.addEventListener('click', () => {
      updateSessionMetadata(session, { archived: !session.archivedAt }, archiveButton);
    });

    item.append(button, actions, editor);
    ui.sessionList.append(item);
  });
}

async function loadSessions() {
  try {
    const params = new URLSearchParams({ scope: ui.sessionScope.value || 'active' });
    const query = ui.sessionSearch.value.trim();
    if (query) params.set('q', query);
    const payload = await requestJson(`/api/sessions?${params}`);
    const sessions = Array.isArray(payload) ? payload : payload.sessions || [];
    const active = payload.activeSessionId || payload.active_session_id || app.activeSessionId;
    renderSessions(sessions, active);
  } catch (error) {
    // 구버전 서버와도 현재 세션 하나는 계속 사용할 수 있다.
    renderSessions(app.state ? [fallbackSession(app.state)] : [], app.activeSessionId);
  }
}

async function updateSessionMetadata(session, changes, button) {
  const nextTitle = Object.hasOwn(changes, 'title') ? String(changes.title || '').trim() : null;
  if (nextTitle !== null && !nextTitle) {
    showError('세션 이름은 비워둘 수 없습니다.', true);
    return;
  }
  const active = session.id === app.activeSessionId;
  if (active && changes.archived === true && app.harnessDirty.size
    && !window.confirm('저장하지 않은 Harness 수정이 있습니다. 변경을 버리고 세션을 보관할까요?')) return;
  await performAction(button, async () => {
    const payload = await patch(`/api/sessions/${encodeURIComponent(session.id)}`, changes, {
      'If-Match': `"session-${session.metadataVersion}"`,
    });
    const changed = payload.session || session;
    if (active && payload.state) {
      if (Object.hasOwn(changes, 'archived')) {
        app.harnessDirty.clear();
        renderState(payload.state, true);
        if (changed.archivedAt && ui.sessionScope.value === 'active') ui.sessionScope.value = 'archived';
        if (!changed.archivedAt && ui.sessionScope.value === 'archived') ui.sessionScope.value = 'active';
        connectStream();
      } else {
        app.state = { ...(app.state || {}), ...payload.state };
        app.archived = Boolean(payload.state.archivedAt || payload.state.sessionMetadata?.archivedAt);
        updateControls();
      }
    }
    await loadSessions();
    setTicker(changes.archived === true
      ? '세션을 보관했습니다. 내용은 읽기 전용입니다.'
      : changes.archived === false
        ? '세션을 복원했습니다.'
        : '세션 이름을 변경했습니다.');
  }).catch(async () => { await loadSessions(); });
}

async function activateSession(sessionId) {
  if (!sessionId || sessionId === app.activeSessionId) return;
  if (BUSY_PHASES.has(app.phase)) {
    showError('Council 실행 중에는 다른 세션으로 전환할 수 없습니다.', true);
    return;
  }
  if (app.harnessDirty.size && !window.confirm('저장하지 않은 Harness 수정이 있습니다. 변경을 버리고 세션을 전환할까요?')) return;
  await performAction(null, async () => {
    const payload = await post(`/api/sessions/${encodeURIComponent(sessionId)}/activate`, {});
    const state = payload.state || payload;
    app.harnessDirty.clear();
    app.activeSessionId = sessionId;
    renderState(state, true);
    await loadSessions();
    connectStream();
    if (isMobileWorkspace()) setMobileWorkspaceView('chat', { focusPanel: true });
    else ui.workspace.focus();
  }).catch(() => {});
}

async function saveHarness(role, button) {
  const target = HARNESS_UI[role];
  if (!target) return;
  const content = target.input.value.trim();
  if (!content) {
    showError('Harness 내용은 비워둘 수 없습니다.', true);
    target.input.focus();
    return;
  }
  const localVersion = Number(target.input.dataset.version || app.harnesses[role]?.version || 0);
  await performAction(button, async () => {
    target.meta.textContent = '저장 중…';
    const payload = await put(`/api/harnesses/${encodeURIComponent(role)}`, {
      content,
      version: localVersion,
      expectedRevision: Number(app.state?.harnessRevision || app.state?.harness_revision || localVersion),
    });
    app.harnessDirty.delete(role);
    if (payload.state) {
      app.state = payload.state;
      renderHarnesses(payload.state, true);
    } else if (payload.harnesses) renderHarnesses(payload, true);
    else renderHarnesses({
      harnessRevision: payload.revision || payload.harnessRevision,
      harnesses: { [role]: payload.harness || payload },
    }, true);
    if (payload.revision || payload.harnessRevision) {
      app.state = { ...(app.state || {}), harnessRevision: payload.revision || payload.harnessRevision };
    }
    target.meta.textContent = '저장됨 · 다음 호출부터 적용';
    app.harnessDiffChangeCount = null;
    app.harnessHistoryLoadKey = '';
    scheduleHarnessHistoryLoad();
  }).catch(() => {
    target.meta.textContent = '저장 실패 · 내용을 보존했습니다.';
  });
}

function isMobileWorkspace() {
  return window.matchMedia('(max-width: 880px)').matches;
}

function updateRailToggleLabel(expanded) {
  ui.toggleSessionRail.setAttribute('aria-expanded', String(expanded));
  ui.toggleSessionRail.title = expanded ? '세션 목록 닫기' : '세션 목록 열기';
  const label = ui.toggleSessionRail.querySelector('.sr-only');
  if (label) label.textContent = ui.toggleSessionRail.title;
}

function setMobileWorkspaceView(view, { focusPanel = false, persist = true } = {}) {
  const allowed = new Set(['sessions', 'chat', 'insights']);
  const next = allowed.has(view) ? view : 'chat';
  if (!isMobileWorkspace()) {
    document.body.dataset.mobileView = 'desktop';
    ui.sessionRail.classList.remove('is-expanded-mobile');
    ui.sessionRail.removeAttribute('aria-hidden');
    ui.sessionRail.inert = false;
    ui.mobileSessionBackdrop.hidden = true;
    ui.conversationPanel.removeAttribute('aria-hidden');
    ui.inspectorPanel.removeAttribute('aria-hidden');
    ui.conversationPanel.inert = false;
    ui.inspectorPanel.inert = false;
    return;
  }

  if (next === 'sessions' && app.mobileView !== 'sessions') app.mobileReturnView = app.mobileView;
  app.mobileView = next;
  document.body.dataset.mobileView = next;
  const sessionsOpen = next === 'sessions';
  const chatOpen = next === 'chat';
  const insightsOpen = next === 'insights';
  ui.sessionRail.classList.toggle('is-expanded-mobile', sessionsOpen);
  ui.sessionRail.classList.remove('is-collapsed');
  ui.sessionRail.setAttribute('aria-hidden', String(!sessionsOpen));
  ui.sessionRail.inert = !sessionsOpen;
  ui.mobileSessionBackdrop.hidden = !sessionsOpen;
  ui.conversationPanel.setAttribute('aria-hidden', String(!chatOpen));
  ui.inspectorPanel.setAttribute('aria-hidden', String(!insightsOpen));
  ui.conversationPanel.inert = !chatOpen;
  ui.inspectorPanel.inert = !insightsOpen;
  updateRailToggleLabel(sessionsOpen);

  ui.mobileWorkspaceTabs.forEach((tab) => {
    const selected = tab.dataset.mobileView === next;
    tab.setAttribute('aria-selected', String(selected));
    tab.tabIndex = selected ? 0 : -1;
  });
  if (persist && next !== 'sessions') {
    try { sessionStorage.setItem('ai-council:mobile-view', next); } catch (_) { /* noop */ }
  }
  if (focusPanel) {
    requestAnimationFrame(() => {
      if (sessionsOpen) (ui.sessionSearch || ui.newSessionBtn).focus({ preventScroll: true });
      else if (insightsOpen) ui.inspectorPanel.focus({ preventScroll: true });
      else ui.workspace.focus({ preventScroll: true });
    });
  }
}

function updateSessionRail(expanded) {
  if (isMobileWorkspace()) {
    const next = expanded ? 'sessions' : (app.mobileView === 'sessions' ? app.mobileReturnView : app.mobileView);
    setMobileWorkspaceView(next, { focusPanel: expanded });
    return;
  }
  if (!expanded && ui.sessionRail.contains(document.activeElement) && document.activeElement !== ui.toggleSessionRail) {
    ui.toggleSessionRail.focus({ preventScroll: true });
  }
  ui.sessionRail.classList.toggle('is-collapsed', !expanded);
  ui.sessionRail.classList.remove('is-expanded-mobile');
  updateRailToggleLabel(expanded);
  try { localStorage.setItem('ai-council:session-rail', expanded ? 'expanded' : 'collapsed'); } catch (_) { /* noop */ }
}

function setComposerCollapsed(collapsed, { focusInput = false } = {}) {
  const next = Boolean(collapsed);
  if (next && ui.composerInputArea.contains(document.activeElement)) {
    ui.toggleComposer.focus({ preventScroll: true });
  }
  ui.composer.classList.toggle('is-collapsed', next);
  ui.composerInputArea.hidden = next;
  ui.toggleComposer.setAttribute('aria-expanded', String(!next));
  ui.toggleComposer.textContent = next ? '입력창 펼치기' : '입력창 접기';
  try { localStorage.setItem('ai-council:composer', next ? 'collapsed' : 'expanded'); } catch (_) { /* noop */ }
  if (!next && focusInput && !ui.input.disabled) {
    requestAnimationFrame(() => ui.input.focus({ preventScroll: true }));
  }
}

function syncVisualViewport() {
  const viewport = window.visualViewport;
  const height = viewport?.height || window.innerHeight;
  document.documentElement.style.setProperty('--visual-viewport-height', `${Math.round(height)}px`);
  const inputFocused = isMobileWorkspace() && ui.input === document.activeElement;
  const keyboardOffset = inputFocused && viewport
    ? Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
    : 0;
  document.documentElement.style.setProperty('--keyboard-offset', `${keyboardOffset}px`);
}

function openNewSessionSetup() {
  if (BUSY_PHASES.has(app.phase)) {
    showError('현재 실행을 마친 뒤 새 세션을 시작할 수 있습니다.', true);
    return;
  }
  if (isMobileWorkspace()) setMobileWorkspaceView('chat');
  ui.setupBody.classList.remove('hidden');
  ui.toggleSetup.setAttribute('aria-expanded', 'true');
  ui.toggleSetup.textContent = '설정 접기';
  loadModelCapacity({ force: !app.modelCapacity }).catch(() => {});
  startModelCapacityPolling();
  ui.toggleSetup.scrollIntoView({ behavior: 'smooth', block: 'center' });
  ui.orcBrain.focus({ preventScroll: true });
}

function toggleInspectorItems() {
  const items = [...ui.inspectorPanel.querySelectorAll('details')];
  const shouldOpen = items.some((item) => !item.open);
  items.forEach((item) => { item.open = shouldOpen; });
  app.inspectorExpanded = shouldOpen;
  ui.expandAllInspector.textContent = shouldOpen ? '모두 접기 ↙' : '모두 펼치기 ↗';
  ui.expandAllInspector.setAttribute('aria-pressed', String(shouldOpen));
}

async function loadConfig() {
  const payload = await requestJson('/api/config');
  app.options = normalizeOptions(payload);
  renderConfig();
  renderPreflight();
}

function capacityDuration(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '';
  const minutes = Math.max(0, Math.ceil((timestamp - Date.now()) / 60_000));
  if (minutes < 1) return '곧 복구';
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  const rest = minutes % 60;
  if (days) return `${days}일 ${hours}시간 후`;
  if (hours) return `${hours}시간 ${rest}분 후`;
  return `${rest}분 후`;
}

function capacityUpdatedAt(value) {
  const timestamp = Date.parse(value || '');
  if (!Number.isFinite(timestamp)) return '확인 전';
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
  return minutes < 1 ? '방금 확인' : `${minutes}분 전 확인`;
}

function renderModelCapacity() {
  if (!ui.modelCapacity) return;
  ui.modelCapacity.replaceChildren();
  const payload = app.modelCapacity;
  if (app.modelCapacityLoading && !payload) {
    const loading = document.createElement('p');
    loading.className = 'helper-text';
    loading.textContent = 'Provider 사용량을 확인하는 중입니다.';
    ui.modelCapacity.append(loading);
    return;
  }
  if (payload?.visibility === 'private') {
    const privateNotice = document.createElement('p');
    privateNotice.className = 'helper-text';
    privateNotice.textContent = payload.message || '계정 사용량은 원격 화면에 표시되지 않습니다.';
    ui.modelCapacity.append(privateNotice);
    return;
  }
  const providers = payload?.providers || {};
  const labels = { claude: 'Claude', codex: 'ChatGPT / Codex' };
  for (const providerId of ['claude', 'codex']) {
    const provider = providers[providerId] || { provider: providerId, state: 'unknown', windows: [], message: '사용량을 확인하지 못했습니다.' };
    const card = document.createElement('article');
    card.className = `capacity-provider${provider.state === 'limited' ? ' is-limited' : ''}${provider.state === 'unavailable' ? ' is-unavailable' : ''}`;
    const name = document.createElement('div');
    name.className = 'capacity-provider-name';
    name.textContent = labels[providerId];
    const meta = document.createElement('small');
    meta.textContent = provider.source ? `${capacityUpdatedAt(provider.updatedAt)} · CLI reported` : capacityUpdatedAt(provider.updatedAt);
    name.append(meta);
    card.append(name);
    const windows = document.createElement('div');
    windows.className = 'capacity-windows';
    const entries = Array.isArray(provider.windows) ? provider.windows.slice(0, 3) : [];
    if (entries.length) {
      entries.forEach((entry) => {
        const item = document.createElement('span');
        item.className = 'capacity-window';
        const bar = document.createElement('span');
        bar.className = 'capacity-bar';
        const fill = document.createElement('span');
        const remaining = Math.max(0, Math.min(100, Number(entry.remainingPercent)));
        fill.style.width = `${remaining}%`;
        bar.append(fill);
        const label = document.createElement('span');
        label.textContent = entry.label || '한도';
        const amount = document.createElement('strong');
        amount.textContent = `${remaining}% 남음`;
        const reset = document.createElement('span');
        reset.textContent = capacityDuration(entry.resetsAt) || entry.resetLabel || '복구 시각 미제공';
        item.append(bar, label, amount, reset);
        windows.append(item);
      });
    } else {
      const unavailable = document.createElement('span');
      unavailable.className = 'capacity-window';
      unavailable.textContent = provider.message || '사용량 정보를 받을 수 없습니다.';
      windows.append(unavailable);
    }
    card.append(windows);
    const status = document.createElement('span');
    status.className = `capacity-status${['unavailable', 'stale', 'limited'].includes(provider.state) ? ' is-warning' : ''}`;
    if (provider.state === 'limited') status.textContent = '제한 감지';
    else if (provider.state === 'stale') status.textContent = '이전 값';
    else if (provider.state === 'unavailable') status.textContent = '미확인';
    else if (Number(provider.resetCreditCount) > 0) status.textContent = `리셋 ${provider.resetCreditCount}회`;
    else status.textContent = '사용 가능';
    card.append(status);
    ui.modelCapacity.append(card);
  }
}

async function loadModelCapacity({ force = false } = {}) {
  if (app.modelCapacityLoading) return;
  app.modelCapacityLoading = true;
  ui.refreshModelCapacity?.classList.add('is-loading');
  if (ui.refreshModelCapacity) ui.refreshModelCapacity.disabled = true;
  renderModelCapacity();
  try {
    app.modelCapacity = await requestJson(`/api/model-capacity${force ? '?refresh=1' : ''}`);
  } catch (error) {
    app.modelCapacity = {
      visibility: 'local',
      providers: {
        claude: { provider: 'claude', state: 'unavailable', windows: [], message: '사용량 확인에 실패했습니다.' },
        codex: { provider: 'codex', state: 'unavailable', windows: [], message: '사용량 확인에 실패했습니다.' },
      },
    };
  } finally {
    app.modelCapacityLoading = false;
    ui.refreshModelCapacity?.classList.remove('is-loading');
    if (ui.refreshModelCapacity) ui.refreshModelCapacity.disabled = false;
    renderModelCapacity();
  }
}

function startModelCapacityPolling() {
  if (app.modelCapacityTimer) return;
  app.modelCapacityTimer = window.setInterval(() => {
    if (!document.hidden) loadModelCapacity().catch(() => {});
  }, 60_000);
}

async function loadSecurityContext() {
  const loopback = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
    .has(window.location.hostname.toLowerCase());
  try {
    const payload = await requestJson('/api/security-context');
    const mode = textFrom(payload.accessMode || payload.access_mode || (loopback ? 'local' : 'remote')).toLowerCase();
    const remote = !['local', 'localhost', 'loopback'].includes(mode);
    const csrfToken = payload.csrfToken || payload.csrf_token || null;
    if (remote && !csrfToken) throw new Error('원격 접속 보안 토큰을 받지 못했습니다.');
    app.securityContext = {
      accessMode: mode,
      csrfToken: csrfToken ? String(csrfToken) : null,
      remoteIdentity: payload.remoteIdentity || payload.remote_identity || null,
    };
    app.securityBlocked = false;
    renderAccessMode(app.securityContext);
    return app.securityContext;
  } catch (error) {
    if (loopback && error.status === 404) {
      // 구버전 localhost 서버와 테스트 fixture는 원격 권한을 갖지 않는 local 모드로만 호환한다.
      app.securityContext = { accessMode: 'local', csrfToken: null, remoteIdentity: null };
      app.securityBlocked = false;
      renderAccessMode(app.securityContext);
      return app.securityContext;
    }
    app.securityContext = null;
    app.securityBlocked = true;
    renderAccessMode({ accessMode: loopback ? 'local' : 'remote' });
    throw new Error(`접속 보안 확인 실패: ${error.message || error}`);
  }
}

async function loadState() {
  const state = await requestJson('/api/state');
  if (!app.options && state.options) app.options = normalizeOptions(state.options);
  if (app.options) renderConfig(state.config || {});
  renderState(state, true);
  return state;
}

function parseSse(messageEvent, forcedKind = '') {
  try {
    const event = JSON.parse(messageEvent.data);
    if (forcedKind && !event.kind && !event.type) event.kind = forcedKind;
    handleEvent(event, messageEvent);
  } catch (_) {
    showError('서버 이벤트를 해석하지 못했습니다. 상태를 다시 불러옵니다.');
    loadState().catch(() => {});
  }
}

function connectStream() {
  app.eventSource?.close();
  app.eventSource = null;
  if (app.archived) {
    setConnection('offline', '보관됨 · 읽기 전용');
    return;
  }
  const query = app.activeSessionId ? `?sessionId=${encodeURIComponent(app.activeSessionId)}` : '';
  const stream = new EventSource(`/stream${query}`);
  app.eventSource = stream;

  stream.addEventListener('open', () => setConnection('online', '연결됨'));
  stream.onmessage = (event) => parseSse(event);
  [
    'status', 'stage.changed', 'agent.started', 'agent.completed', 'artifact.completed',
    'question.required', 'approval.required', 'run.failed', 'run.completed',
  ].forEach((name) => stream.addEventListener(name, (event) => parseSse(event, name)));
  stream.addEventListener('error', () => setConnection('offline', '재연결 중'));
}

async function performAction(button, action) {
  const wasDisabled = button?.disabled;
  if (button) button.disabled = true;
  showError('');
  try {
    return await action();
  } catch (error) {
    showError(error.message || String(error), true);
    setTicker(error.message || String(error), true);
    throw error;
  } finally {
    if (button && !wasDisabled) button.disabled = false;
    updateControls();
  }
}

async function sendInput() {
  const content = ui.input.value.trim();
  if (!content || ui.sendBtn.disabled) return;
  const feedback = FEEDBACK_PHASES.has(app.phase) || app.feedbackMode;
  setWorkflowFollow(true);
  followWorkflowTarget('workflowOrchestratorTop');
  await performAction(ui.sendBtn, async () => {
    await post(feedback ? '/api/feedback' : '/api/instruct', feedback
      ? { feedback: content, planVersion: app.planVersion }
      : { instruction: content });
    ui.input.value = '';
    app.feedbackMode = false;
    setPhase('running');
    setTicker(feedback ? '피드백을 Orchestrator에게 전달했습니다.' : '지시를 Orchestrator에게 전달했습니다.');
  }).catch(() => {});
}

ui.toggleSetup.addEventListener('click', () => {
  const collapsed = ui.setupBody.classList.toggle('hidden');
  ui.toggleSetup.setAttribute('aria-expanded', String(!collapsed));
  ui.toggleSetup.textContent = collapsed ? '설정 펼치기' : '설정 접기';
  if (!collapsed) {
    loadModelCapacity({ force: !app.modelCapacity }).catch(() => {});
    startModelCapacityPolling();
  }
});

ui.refreshModelCapacity?.addEventListener('click', () => {
  loadModelCapacity({ force: true }).catch(() => {});
});

ui.orcBrain.addEventListener('change', () => refreshOrchestratorOptions());
ui.orcFallbackBrain.addEventListener('change', () => {
  const provider = providerOptions(ui.orcFallbackBrain.value || 'codex');
  fillSelect(ui.orcFallbackModel, provider.models, '', provider.defaultModel);
  fillSelect(ui.orcFallbackEffort, provider.efforts, '', provider.defaultEffort);
  ui.orcFallbackModel.disabled = !ui.orcFallbackBrain.value;
  ui.orcFallbackEffort.disabled = !ui.orcFallbackBrain.value;
});
ui.councilMode.addEventListener('change', renderCouncilMode);
ui.councilPreset?.addEventListener('change', () => { applyCouncilPreset(ui.councilPreset.value); updateConfigSummary(); });
ui.setupBody?.addEventListener('change', () => updateConfigSummary());
ui.applyRecommended?.addEventListener('click', () => {
  const currentMode = ui.councilMode.value;
  renderConfig({ ...app.options.defaults, mode: currentMode });
  if (currentMode === 'decision_council') applyCouncilPreset('balanced');
  ui.councilPreset.value = currentMode === 'decision_council' ? 'balanced' : '';
  updateConfigSummary();
  setTicker('최신 모델 기준의 권장 라우팅을 적용했습니다.');
});
ui.artifactFilter?.addEventListener('change', applyArtifactFilter);
ui.workflowFollow?.addEventListener('click', () => {
  setWorkflowFollow(true);
  followWorkflowTarget(app.workflowTarget, true);
});
ui.workflowViewport?.addEventListener('wheel', () => setWorkflowFollow(false), { passive: true });
ui.workflowViewport?.addEventListener('touchstart', () => setWorkflowFollow(false), { passive: true });
ui.workflowViewport?.addEventListener('pointerdown', (event) => {
  if (event.offsetX >= ui.workflowViewport.clientWidth - 22) setWorkflowFollow(false);
});
ui.workflowViewport?.addEventListener('keydown', (event) => {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
    setWorkflowFollow(false);
  }
});

ui.applySession.addEventListener('click', () => {
  if (app.harnessDirty.size && !window.confirm('저장하지 않은 Harness 수정이 있습니다. 변경을 버리고 새 세션을 시작할까요?')) return;
  performAction(ui.applySession, async () => {
    const payload = await post('/api/session', { config: gatherConfig() });
    app.feedbackMode = false;
    app.harnessDirty.clear();
    if (payload.state) renderState(payload.state, true);
    else {
      resetRendered();
      renderQuestions([], []);
      app.round = 0;
      app.cycle = 0;
      app.planVersion = null;
      updateMeta({ round: 0, cycle: 0, planVersion: '' });
      setPhase(payload.phase || 'ready');
      setTicker('새 세션이 준비되었습니다. 첫 지시를 입력하세요.');
      showError('');
    }
    await loadSessions();
    connectStream();
    if (isMobileWorkspace()) setMobileWorkspaceView('chat');
    ui.input.focus();
  }).catch(() => {});
});

ui.toggleSessionRail.addEventListener('click', () => {
  const expanded = ui.toggleSessionRail.getAttribute('aria-expanded') === 'true';
  updateSessionRail(!expanded);
  if (isMobileWorkspace() && expanded) ui.mobileSessionsTab.focus({ preventScroll: true });
});

ui.mobileWorkspaceTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    setMobileWorkspaceView(tab.dataset.mobileView, {
      focusPanel: tab.dataset.mobileView === 'sessions',
    });
  });
});
ui.mobileWorkspaceNav.addEventListener('keydown', (event) => {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const tabs = ui.mobileWorkspaceTabs;
  const current = Math.max(0, tabs.indexOf(document.activeElement));
  const index = event.key === 'Home' ? 0
    : event.key === 'End' ? tabs.length - 1
      : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
  tabs[index].focus();
  setMobileWorkspaceView(tabs[index].dataset.mobileView);
});
ui.mobileSessionBackdrop.addEventListener('click', () => {
  updateSessionRail(false);
  ui.mobileSessionsTab.focus({ preventScroll: true });
});

ui.newSessionBtn.addEventListener('click', openNewSessionSetup);
ui.sessionSearch.addEventListener('input', () => {
  clearTimeout(app.sessionSearchTimer);
  app.sessionSearchTimer = setTimeout(() => loadSessions(), 180);
});
ui.sessionScope.addEventListener('change', () => loadSessions());
ui.expandAllInspector.addEventListener('click', toggleInspectorItems);

for (const [role, target] of Object.entries(HARNESS_UI)) {
  target.input.addEventListener('input', () => {
    const current = target.input.value.trim();
    const saved = String(target.input.dataset.savedContent || '').trim();
    if (current === saved) {
      app.harnessDirty.delete(role);
      target.meta.textContent = target.input.dataset.savedMeta || 'Harness 적용됨';
    } else {
      app.harnessDirty.add(role);
      target.meta.textContent = '수정됨 · 저장 필요';
    }
    updateControls();
  });
}

ui.saveHarnessButtons.forEach((button) => {
  button.addEventListener('click', () => saveHarness(button.dataset.role, button));
});

ui.harnessHistoryPanel.addEventListener('toggle', () => {
  if (ui.harnessHistoryPanel.open && !app.harnessHistory.length && !app.harnessHistoryLoading) {
    app.harnessHistoryLoadKey = '';
    loadHarnessHistory().catch(() => {});
  }
});
const resetPendingHarnessDiff = () => {
  app.harnessDiffChangeCount = null;
  ui.harnessDiffOutput.replaceChildren();
  ui.harnessDiffStatus.textContent = '선택한 revision의 차이를 확인하세요.';
  updateHarnessHistoryControls();
};
ui.harnessDiffFrom.addEventListener('change', resetPendingHarnessDiff);
ui.harnessDiffTo.addEventListener('change', resetPendingHarnessDiff);
ui.harnessDiffRole.addEventListener('change', resetPendingHarnessDiff);
ui.loadHarnessDiff.addEventListener('click', () => loadHarnessDiff().catch(() => {}));
ui.rollbackHarness.addEventListener('click', rollbackHarnessRevision);

ui.sendBtn.addEventListener('click', sendInput);
ui.toggleComposer.addEventListener('click', () => {
  const collapsed = ui.toggleComposer.getAttribute('aria-expanded') !== 'true';
  setComposerCollapsed(!collapsed, { focusInput: collapsed });
});
ui.input.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    sendInput();
  }
});

ui.feedbackMode.addEventListener('click', () => {
  app.feedbackMode = true;
  updateControls();
  setComposerCollapsed(false, { focusInput: true });
});

ui.approveBtn.addEventListener('click', () => {
  performAction(ui.approveBtn, async () => {
    const payload = await post('/api/approve', { planVersion: app.planVersion });
    setPhase(payload.phase || 'approved');
    setTicker(app.state?.config?.mode === 'decision_council'
      ? 'Council 최종 판단이 승인되었습니다.'
      : '기획안이 승인되었습니다.');
  }).catch(() => {});
});

ui.cancelBtn.addEventListener('click', () => {
  performAction(ui.cancelBtn, async () => {
    const payload = await post('/api/cancel', {});
    setPhase(payload.phase || 'cancelled');
    setTicker(payload.phase === 'cancelled' ? '현재 실행이 취소되었습니다.' : '현재 실행을 안전하게 취소하고 있습니다.');
  }).catch(() => {});
});

ui.retryBtn.addEventListener('click', () => {
  performAction(ui.retryBtn, async () => {
    await post('/api/retry', {});
    setPhase('running');
    setTicker('실패한 단계부터 다시 실행합니다.');
  }).catch(() => {});
});

async function initialize() {
  setConnection('connecting', '연결 중');
  showError('');
  try {
    await loadSecurityContext();
    await loadConfig();
    await loadState();
    await loadSessions();
  } catch (error) {
    showError(`초기화 실패: ${error.message || error}`, true);
    setTicker(app.securityBlocked ? '접속 보안을 확인하지 못해 변경 기능을 잠갔습니다.' : '서버 상태를 불러오지 못했습니다.', true);
  } finally {
    if (app.securityBlocked) setConnection('offline', '보안 확인 실패');
    else connectStream();
    updateControls();
  }
}

window.addEventListener('resize', () => {
  syncVisualViewport();
  if (isMobileWorkspace()) {
    const view = app.mobileView === 'sessions' ? 'sessions' : app.mobileView;
    setMobileWorkspaceView(view, { persist: false });
  } else {
    setMobileWorkspaceView('chat', { persist: false });
    let expanded = true;
    try { expanded = localStorage.getItem('ai-council:session-rail') !== 'collapsed'; } catch (_) { /* noop */ }
    updateSessionRail(expanded);
  }
});

document.addEventListener('keydown', (event) => {
  if (!ui.sessionRail.classList.contains('is-expanded-mobile')) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    updateSessionRail(false);
    ui.mobileSessionsTab.focus({ preventScroll: true });
    return;
  }
  if (event.key === 'Tab') {
    const focusable = [...ui.sessionRail.querySelectorAll(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary',
    )].filter((item) => item.getClientRects().length && !item.closest('[hidden]'));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && (document.activeElement === first || !ui.sessionRail.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || !ui.sessionRail.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }
});

ui.input.addEventListener('focus', () => {
  syncVisualViewport();
  setTimeout(() => {
    syncVisualViewport();
    ui.input.closest('.composer')?.scrollIntoView({ block: 'end' });
  }, 80);
});
ui.input.addEventListener('blur', () => {
  document.documentElement.style.setProperty('--keyboard-offset', '0px');
});
window.visualViewport?.addEventListener('resize', syncVisualViewport);
window.visualViewport?.addEventListener('scroll', syncVisualViewport);

window.addEventListener('beforeunload', (event) => {
  if (app.harnessDirty.size) {
    event.preventDefault();
    event.returnValue = '';
  }
});

window.addEventListener('pagehide', () => {
  app.eventSource?.close();
  if (app.modelCapacityTimer) window.clearInterval(app.modelCapacityTimer);
});

let railExpanded = true;
try { railExpanded = localStorage.getItem('ai-council:session-rail') !== 'collapsed'; } catch (_) { /* noop */ }
let composerCollapsed = false;
try { composerCollapsed = localStorage.getItem('ai-council:composer') === 'collapsed'; } catch (_) { /* noop */ }
renderAccessMode();
syncVisualViewport();
if (isMobileWorkspace()) {
  let storedView = 'chat';
  try { storedView = sessionStorage.getItem('ai-council:mobile-view') || 'chat'; } catch (_) { /* noop */ }
  app.mobileView = ['chat', 'insights'].includes(storedView) ? storedView : 'chat';
  app.mobileReturnView = app.mobileView;
  setMobileWorkspaceView(app.mobileView, { persist: false });
} else {
  updateSessionRail(railExpanded);
  setMobileWorkspaceView('chat', { persist: false });
}
setComposerCollapsed(composerCollapsed);
initialize();
