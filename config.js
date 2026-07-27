'use strict';

const path = require('path');
const { normalizeAccessPolicy } = require('./lib/access-security');

const options = Object.freeze({
  orchestratorBrains: ['claude', 'codex'],
  claude: Object.freeze({
    models: ['opus', 'sonnet', 'haiku'],
    efforts: ['low', 'medium', 'high', 'xhigh'],
    defaultModel: 'opus',
    defaultEffort: 'high',
  }),
  codex: Object.freeze({
    // 이 PC에서 실제 동작을 확인한 구독 모델을 기본값으로 둔다.
    // 나머지는 사용자가 계정 권한에 맞춰 선택할 수 있는 호환 항목이다.
    models: ['gpt-5.4', 'gpt-5.6-sol', 'gpt-5.1-codex-max', 'gpt-5.1', 'o3'],
    efforts: ['low', 'medium', 'high', 'xhigh'],
    defaultModel: 'gpt-5.4',
    defaultEffort: 'medium',
  }),
});

const defaults = Object.freeze({
  orchestrator: Object.freeze({ brain: 'claude', model: 'opus', effort: 'high' }),
  claudeWorker: Object.freeze({ model: 'sonnet', effort: 'medium' }),
  codexWorker: Object.freeze({ model: 'gpt-5.4', effort: 'medium' }),
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

function normalizeSessionConfig(input, current = cloneDefaults()) {
  const source = input && typeof input === 'object' ? input : {};
  const base = JSON.parse(JSON.stringify(current || cloneDefaults()));

  const requestedBrain = source.orchestrator?.brain ?? base.orchestrator.brain;
  assertAllowed(requestedBrain, options.orchestratorBrains, 'orchestrator.brain');
  const orchestratorProvider = options[requestedBrain];
  const brainChanged = requestedBrain !== base.orchestrator.brain;
  const requestedOrchestratorModel = source.orchestrator?.model
    ?? (brainChanged ? orchestratorProvider.defaultModel : base.orchestrator.model);
  const requestedOrchestratorEffort = source.orchestrator?.effort
    ?? (brainChanged ? orchestratorProvider.defaultEffort : base.orchestrator.effort);
  assertAllowed(requestedOrchestratorModel, orchestratorProvider.models, 'orchestrator.model');
  assertAllowed(requestedOrchestratorEffort, orchestratorProvider.efforts, 'orchestrator.effort');

  const claudeWorker = {
    model: source.claudeWorker?.model ?? base.claudeWorker.model,
    effort: source.claudeWorker?.effort ?? base.claudeWorker.effort,
  };
  assertAllowed(claudeWorker.model, options.claude.models, 'claudeWorker.model');
  assertAllowed(claudeWorker.effort, options.claude.efforts, 'claudeWorker.effort');

  const codexWorker = {
    model: source.codexWorker?.model ?? base.codexWorker.model,
    effort: source.codexWorker?.effort ?? base.codexWorker.effort,
  };
  assertAllowed(codexWorker.model, options.codex.models, 'codexWorker.model');
  assertAllowed(codexWorker.effort, options.codex.efforts, 'codexWorker.effort');

  return {
    orchestrator: {
      brain: requestedBrain,
      model: requestedOrchestratorModel,
      effort: requestedOrchestratorEffort,
    },
    claudeWorker,
    codexWorker,
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
    cliTimeoutMs: Number(process.env.AI_COUNCIL_CLI_TIMEOUT_MS || 10 * 60 * 1000),
  }),
  cloneDefaults,
  normalizeSessionConfig,
  ConfigValidationError,
};
