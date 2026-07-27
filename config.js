'use strict';

const path = require('path');
const { normalizeAccessPolicy } = require('./lib/access-security');

function modelOption(value, label) {
  return Object.freeze({ value, label });
}

function modelValues(models) {
  return models.map((model) => (typeof model === 'string' ? model : model.value));
}

const LEGACY_MODEL_ALIASES = Object.freeze({
  claude: Object.freeze({ haiku: 'claude-haiku-4-5-20251001' }),
  codex: Object.freeze({}),
});

function normalizeLegacyModel(brain, model) {
  return LEGACY_MODEL_ALIASES[brain]?.[model] || model;
}

const options = Object.freeze({
  modes: ['planning', 'decision_council'],
  orchestratorBrains: ['claude', 'codex'],
  claude: Object.freeze({
    // Claude Code 2.1.220 accepts the current aliases fable, opus and sonnet.
    // Haiku has no CLI alias, so use Anthropic's current pinned API model ID.
    models: Object.freeze([
      modelOption('fable', 'Claude Fable 5 · 최고 역량'),
      modelOption('opus', 'Claude Opus 5 · 복잡한 작업'),
      modelOption('sonnet', 'Claude Sonnet 5 · 균형'),
      modelOption('claude-haiku-4-5-20251001', 'Claude Haiku 4.5 · 빠른 작업'),
    ]),
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultModel: 'opus',
    defaultEffort: 'high',
  }),
  codex: Object.freeze({
    models: Object.freeze([
      modelOption('gpt-5.6-sol', 'GPT-5.6 Sol · 최고 품질'),
      modelOption('gpt-5.6-terra', 'GPT-5.6 Terra · 균형'),
      modelOption('gpt-5.6-luna', 'GPT-5.6 Luna · 빠른 작업'),
      modelOption('gpt-5.4', 'GPT-5.4 · 이전 호환성'),
      modelOption('gpt-5.1-codex-max', 'GPT-5.1 Codex Max · 이전 호환성'),
    ]),
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultModel: 'gpt-5.6-sol',
    defaultEffort: 'medium',
  }),
});

const COUNCIL_ADVISOR_KEYS = Object.freeze([
  'contrarian',
  'firstPrinciples',
  'expansionist',
  'outsider',
  'executor',
]);

function route(brain, model, effort, fallbacks = []) {
  return Object.freeze({
    brain,
    model,
    effort,
    fallbacks: Object.freeze(fallbacks.map((item) => Object.freeze({ ...item }))),
  });
}

const defaults = Object.freeze({
  mode: 'planning',
  orchestrator: route('claude', 'opus', 'high', [
    { brain: 'codex', model: 'gpt-5.6-sol', effort: 'high' },
  ]),
  claudeWorker: route('claude', 'sonnet', 'medium', [
    { brain: 'codex', model: 'gpt-5.6-terra', effort: 'medium' },
  ]),
  codexWorker: route('codex', 'gpt-5.6-terra', 'medium', [
    { brain: 'claude', model: 'sonnet', effort: 'medium' },
  ]),
  council: Object.freeze({
    maxParallel: 3,
    advisors: Object.freeze({
      contrarian: route('claude', 'sonnet', 'high', [
        { brain: 'codex', model: 'gpt-5.6-terra', effort: 'high' },
      ]),
      firstPrinciples: route('codex', 'gpt-5.6-sol', 'high', [
        { brain: 'claude', model: 'sonnet', effort: 'high' },
      ]),
      expansionist: route('claude', 'claude-haiku-4-5-20251001', 'medium', [
        { brain: 'codex', model: 'gpt-5.6-luna', effort: 'medium' },
      ]),
      outsider: route('codex', 'gpt-5.6-terra', 'medium', [
        { brain: 'claude', model: 'claude-haiku-4-5-20251001', effort: 'medium' },
      ]),
      executor: route('codex', 'gpt-5.6-terra', 'high', [
        { brain: 'claude', model: 'sonnet', effort: 'high' },
      ]),
    }),
    chair: route('codex', 'gpt-5.6-sol', 'high', [
      { brain: 'claude', model: 'opus', effort: 'high' },
    ]),
  }),
});

class ConfigValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = 'ConfigValidationError';
    this.field = field;
  }
}

function cloneDefaults() {
  return JSON.parse(JSON.stringify(defaults));
}

function assertAllowed(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw new ConfigValidationError(
      `${field} 값 '${value}'은(는) 지원되지 않습니다. 허용값: ${allowed.join(', ')}`,
      field,
    );
  }
}

function normalizeRoute(input, current, field) {
  const source = input && typeof input === 'object' ? input : {};
  const base = current && typeof current === 'object' ? current : {};
  const requestedBrain = source.brain ?? source.provider ?? base.brain;
  assertAllowed(requestedBrain, options.orchestratorBrains, `${field}.brain`);
  const provider = options[requestedBrain];
  const brainChanged = requestedBrain !== base.brain;
  const requestedModel = source.model ?? (brainChanged ? provider.defaultModel : base.model);
  const model = normalizeLegacyModel(requestedBrain, requestedModel);
  const effort = source.effort ?? (brainChanged ? provider.defaultEffort : base.effort);
  assertAllowed(model, modelValues(provider.models), `${field}.model`);
  assertAllowed(effort, provider.efforts, `${field}.effort`);

  const rawFallbacks = source.fallbacks ?? base.fallbacks ?? [];
  if (!Array.isArray(rawFallbacks) || rawFallbacks.length > 5) {
    throw new ConfigValidationError(`${field}.fallbacks는 최대 5개의 배열이어야 합니다.`, `${field}.fallbacks`);
  }
  const fallbacks = rawFallbacks.map((item, index) => {
    const fallback = item && typeof item === 'object' ? item : {};
    const fallbackBrain = fallback.brain ?? fallback.provider;
    assertAllowed(fallbackBrain, options.orchestratorBrains, `${field}.fallbacks[${index}].brain`);
    const fallbackProvider = options[fallbackBrain];
    const requestedFallbackModel = fallback.model ?? fallbackProvider.defaultModel;
    const fallbackModel = normalizeLegacyModel(fallbackBrain, requestedFallbackModel);
    const fallbackEffort = fallback.effort ?? fallbackProvider.defaultEffort;
    assertAllowed(fallbackModel, modelValues(fallbackProvider.models), `${field}.fallbacks[${index}].model`);
    assertAllowed(fallbackEffort, fallbackProvider.efforts, `${field}.fallbacks[${index}].effort`);
    return { brain: fallbackBrain, model: fallbackModel, effort: fallbackEffort };
  });

  const seen = new Set();
  return {
    brain: requestedBrain,
    model,
    effort,
    fallbacks: fallbacks.filter((item) => {
      const key = `${item.brain}:${item.model}:${item.effort}`;
      if (seen.has(key) || key === `${requestedBrain}:${model}:${effort}`) return false;
      seen.add(key);
      return true;
    }),
  };
}

function normalizeSessionConfig(input, current = cloneDefaults()) {
  const source = input && typeof input === 'object' ? input : {};
  const base = JSON.parse(JSON.stringify(current || cloneDefaults()));
  const mode = source.mode ?? base.mode ?? 'planning';
  assertAllowed(mode, options.modes, 'mode');

  const orchestrator = normalizeRoute(source.orchestrator, base.orchestrator, 'orchestrator');
  const claudeWorker = normalizeRoute(
    { ...source.claudeWorker, brain: source.claudeWorker?.brain ?? base.claudeWorker.brain ?? 'claude' },
    base.claudeWorker,
    'claudeWorker',
  );
  const codexWorker = normalizeRoute(
    { ...source.codexWorker, brain: source.codexWorker?.brain ?? base.codexWorker.brain ?? 'codex' },
    base.codexWorker,
    'codexWorker',
  );
  const rawCouncil = source.council && typeof source.council === 'object' ? source.council : {};
  const baseCouncil = base.council || cloneDefaults().council;
  const maxParallel = Number(rawCouncil.maxParallel ?? baseCouncil.maxParallel ?? 3);
  if (!Number.isInteger(maxParallel) || maxParallel < 1 || maxParallel > 5) {
    throw new ConfigValidationError('council.maxParallel은 1~5 사이의 정수여야 합니다.', 'council.maxParallel');
  }
  const advisors = Object.fromEntries(COUNCIL_ADVISOR_KEYS.map((key) => [
    key,
    normalizeRoute(rawCouncil.advisors?.[key], baseCouncil.advisors[key], `council.advisors.${key}`),
  ]));
  const chair = normalizeRoute(rawCouncil.chair, baseCouncil.chair, 'council.chair');

  return {
    mode,
    orchestrator,
    claudeWorker,
    codexWorker,
    council: { maxParallel, advisors, chair },
  };
}

const normalizedAccess = normalizeAccessPolicy({
  mode: process.env.AI_COUNCIL_ACCESS_MODE || 'local',
  tailnetHostname: process.env.AI_COUNCIL_TAILNET_HOSTNAME || '',
  allowedUsers: process.env.AI_COUNCIL_TAILNET_ALLOWED_USERS || '',
  mutationLimit: Number(process.env.AI_COUNCIL_REMOTE_MUTATION_LIMIT || 60),
  mutationWindowMs: Number(process.env.AI_COUNCIL_REMOTE_MUTATION_WINDOW_MS || 60_000),
});
normalizedAccess.allowedUsers = Object.freeze([...normalizedAccess.allowedUsers]);
const access = Object.freeze(normalizedAccess);

module.exports = {
  host: process.env.AI_COUNCIL_HOST || '127.0.0.1',
  port: Number(process.env.AI_COUNCIL_PORT || 3100),
  runtimeDir: process.env.AI_COUNCIL_RUNTIME_DIR || path.join(__dirname, '.runtime'),
  access,
  options,
  defaults,
  // 최초 응답 뒤 최대 두 번까지 구조/의미 오류를 교정한다. 피드백 추적처럼
  // 여러 항목을 보존해야 하는 synthesis는 한 번의 부분 교정만으로 끝나지 않을 수 있다.
  loop: Object.freeze({ maxRounds: 3, structuredRetries: 2 }),
  limits: Object.freeze({
    requestBytes: '256kb',
    instructionChars: 50_000,
    promptChars: 500_000,
    outputBytes: 4 * 1024 * 1024,
    transcriptEvents: 1_000,
    sessionAuditEntries: 500,
    sessionRegistryEntries: 100,
    harnessHistoryEntries: 20,
    harnessRoleBytes: 24 * 1024,
    harnessSetBytes: 72 * 1024,
    publicProjectionDepth: 10,
    publicProjectionBytes: 512 * 1024,
    cycles: 25,
    modelCircuitCooldownMs: Number(process.env.AI_COUNCIL_MODEL_CIRCUIT_COOLDOWN_MS || 15 * 60 * 1000),
    cliTimeoutMs: Number(process.env.AI_COUNCIL_CLI_TIMEOUT_MS || 10 * 60 * 1000),
  }),
  cloneDefaults,
  normalizeSessionConfig,
  normalizeRoute,
  COUNCIL_ADVISOR_KEYS,
  ConfigValidationError,
  normalizeLegacyModel,
};
