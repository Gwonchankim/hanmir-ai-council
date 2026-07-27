'use strict';

const REQUIRED_SCHEMAS = ['harnessSet', 'taskPackage', 'draft', 'critique', 'synthesis'];
const REQUIRED_ROLES = ['orchestrator', 'claudeWorker', 'codexWorker'];
const WORKER_ROLES = ['claudeWorker', 'codexWorker'];
const PUBLIC_REASONING_KEYS = /^(thinking|reasoning|privateThought|chainOfThought)$/i;
const PUBLIC_REASONING_EVENT_TYPES = new Set(['thinking', 'reasoning', 'private_thought', 'chain_of_thought']);

function result(id, failures, evidence) {
  return {
    id,
    passed: failures.length === 0,
    failures,
    evidence: Array.isArray(evidence) ? evidence : [],
  };
}

function schemaGate(bundle) {
  const failures = [];
  const schemas = bundle.schemas || {};
  for (const name of REQUIRED_SCHEMAS) {
    if (!schemas[name] || schemas[name].valid !== true) {
      failures.push(`${name} 스키마 검증 결과가 true가 아니다.`);
    }
  }
  const hasR2 = (bundle.stages || []).some((entry) => entry.stage === 'R2_REVISING');
  if (hasR2 && (!schemas.revision || schemas.revision.valid !== true)) {
    failures.push('R2가 실행되었지만 revision 스키마가 유효하지 않다.');
  }
  if (!bundle.synthesis || typeof bundle.synthesis !== 'object' || Array.isArray(bundle.synthesis)) {
    failures.push('구조화된 Synthesis가 없다.');
  }
  return result('CF_SCHEMA_OR_SYNTHESIS', failures, REQUIRED_SCHEMAS.map((name) => `schemas.${name}.valid`));
}

function groupStages(stages) {
  const groups = new Map();
  for (const item of stages) {
    const cycle = Number(item.cycle);
    if (!Number.isInteger(cycle) || cycle < 1) continue;
    if (!groups.has(cycle)) groups.set(cycle, []);
    groups.get(cycle).push(item);
  }
  return groups;
}

function stageGate(bundle) {
  const failures = [];
  const stages = Array.isArray(bundle.stages) ? bundle.stages : [];
  if (stages.length === 0) failures.push('단계 증거가 없다.');

  let previousSequence = -Infinity;
  for (const item of stages) {
    if (!Number.isFinite(item.sequence) || item.sequence <= previousSequence) {
      failures.push('단계 sequence가 엄격한 증가 순서가 아니다.');
      break;
    }
    previousSequence = item.sequence;
  }

  const allowedTerminal = new Set(['WAITING_USER_INPUT', 'WAITING_APPROVAL', 'APPROVED']);
  const groups = groupStages(stages);
  const cycleIds = [...groups.keys()].sort((a, b) => a - b);
  const harnessProtocolStartCycle = Number(bundle.harnessProtocolStartCycle);
  if (!Number.isInteger(harnessProtocolStartCycle) || harnessProtocolStartCycle < 1
    || (cycleIds.length && harnessProtocolStartCycle > cycleIds.at(-1))) {
    failures.push('Harness 프로토콜 시작 cycle이 유효하지 않다.');
  }
  if (cycleIds.some((cycle, index) => cycle !== index + 1)) {
    failures.push('cycle 번호가 1부터 연속되지 않는다.');
  }

  for (const cycle of cycleIds) {
    const names = groups.get(cycle).map((item) => item.stage);
    const harnessEnabled = Number.isInteger(harnessProtocolStartCycle)
      && cycle >= harnessProtocolStartCycle;
    const expectedPrefix = harnessEnabled
      ? ['HARNESSING', 'DECOMPOSING', 'R0_DRAFTING', 'R1_CRITIQUING']
      : ['DECOMPOSING', 'R0_DRAFTING', 'R1_CRITIQUING'];
    if (expectedPrefix.some((name, index) => names[index] !== name)) {
      failures.push(harnessEnabled
        ? `cycle ${cycle}: HARNESSING → DECOMPOSING → R0 → R1 순서가 아니다.`
        : `cycle ${cycle}: legacy DECOMPOSING → R0 → R1 순서가 아니다.`);
      continue;
    }
    let cursor = expectedPrefix.length;
    if (names[cursor] === 'R2_REVISING') cursor += 1;
    if (names[cursor] !== 'SYNTHESIZING') {
      failures.push(`cycle ${cycle}: R1 또는 R2 뒤에 SYNTHESIZING이 없다.`);
      continue;
    }
    cursor += 1;
    if (!allowedTerminal.has(names[cursor])) {
      failures.push(`cycle ${cycle}: 통합 뒤 사용자 체크포인트가 없다.`);
    }
    if (cursor !== names.length - 1) {
      failures.push(`cycle ${cycle}: 허용되지 않은 추가 단계가 있다.`);
    }
    const councilRounds = names.filter((name) => /^R[0-9]+_/.test(name));
    if (councilRounds.length > 3) failures.push(`cycle ${cycle}: Council 라운드가 3회를 초과했다.`);
  }

  return result('CF_STAGE_PROTOCOL', failures, stages.map((item) => `cycle ${item.cycle}/${item.stage}#${item.sequence}`));
}

function validHarnessRole(role) {
  if (!role || typeof role !== 'object' || Array.isArray(role)) return false;
  const strings = ['mission', 'outputContract'];
  const lists = ['responsibilities', 'operatingRules', 'qualityChecks', 'boundaries'];
  const allowed = new Set([...strings, ...lists, 'customInstructions']);
  return Object.keys(role).every((key) => allowed.has(key))
    && strings.every((key) => typeof role[key] === 'string' && role[key].trim() !== '')
    && lists.every((key) => Array.isArray(role[key]) && role[key].length > 0
      && role[key].every((item) => typeof item === 'string' && item.trim() !== ''))
    && (role.customInstructions === undefined || typeof role.customInstructions === 'string');
}

function harnessGate(bundle) {
  const failures = [];
  const cycles = Array.isArray(bundle.harnessCycles) ? bundle.harnessCycles : [];
  const protocolStartCycle = Number(bundle.harnessProtocolStartCycle);
  const expectedCycleIds = [...groupStages(bundle.stages || []).keys()]
    .filter((cycle) => Number.isInteger(protocolStartCycle) && cycle >= protocolStartCycle)
    .sort((a, b) => a - b);
  const actualCycleIds = cycles.map((item) => Number(item?.cycle));

  if (cycles.length === 0) failures.push('cycle별 Harness 증거가 없다.');
  if (!deepEqual(actualCycleIds, expectedCycleIds)) {
    failures.push('Harness 증거의 cycle 목록이 단계 증거와 일치하지 않는다.');
  }

  for (const cycleEvidence of cycles) {
    const cycle = Number(cycleEvidence?.cycle);
    const harnessSet = cycleEvidence?.harnessSet;
    if (!Number.isInteger(cycle) || cycle < 1) {
      failures.push('Harness 증거에 유효한 cycle 번호가 없다.');
      continue;
    }
    const allowedHarnessKeys = new Set([
      'schemaVersion', 'artifactType', 'cycle', 'rationale', ...REQUIRED_ROLES,
    ]);
    if (!harnessSet || harnessSet.artifactType !== 'harness_set'
      || harnessSet.schemaVersion !== 1 || harnessSet.cycle !== cycle
      || typeof harnessSet.rationale !== 'string' || harnessSet.rationale.trim() === ''
      || !Object.keys(harnessSet).every((key) => allowedHarnessKeys.has(key))) {
      failures.push(`cycle ${cycle}: HarnessSet 메타데이터 또는 cycle이 유효하지 않다.`);
    }
    for (const role of REQUIRED_ROLES) {
      if (!validHarnessRole(harnessSet?.[role])) {
        failures.push(`cycle ${cycle}: ${role} Harness가 3역할 스키마를 충족하지 않는다.`);
      }
    }

    const revision = Number(cycleEvidence?.harnessRevision);
    const dispatchRevision = Number(cycleEvidence?.dispatchHarnessRevision);
    if (!Number.isInteger(revision) || revision < 1 || dispatchRevision !== revision) {
      failures.push(`cycle ${cycle}: dispatch가 생성 시점의 Harness revision에 고정되지 않았다.`);
    }

    const lifecycle = cycleEvidence?.lifecycle || {};
    const lifecycleSequence = [
      lifecycle.harnessingSequence,
      lifecycle.harnessSetSequence,
      lifecycle.dispatchSequence,
    ];
    if (!lifecycleSequence.every(Number.isFinite)
      || !(lifecycleSequence[0] < lifecycleSequence[1] && lifecycleSequence[1] < lifecycleSequence[2])) {
      failures.push(`cycle ${cycle}: HARNESSING → harness_set → dispatch 실제 이벤트 순서 증거가 없다.`);
    }

    const bindings = Array.isArray(cycleEvidence?.promptBindings) ? cycleEvidence.promptBindings : [];
    for (const role of REQUIRED_ROLES) {
      const binding = bindings.find((item) => item?.role === role && item.included === true);
      if (!binding || typeof binding.harnessDigest !== 'string' || binding.harnessDigest.length !== 64
        || binding.promptHarnessDigest !== binding.harnessDigest
        || binding.harnessRevision !== revision) {
        failures.push(`cycle ${cycle}: ${role} 호출 프롬프트가 고정된 Harness를 사용했다는 digest 증거가 없다.`);
      }
    }
  }

  const override = bundle.harnessOverride || {};
  const nextCall = override.nextCall || {};
  if (override.installed !== true || !REQUIRED_ROLES.includes(override.role)) {
    failures.push('사용자 Harness override 설치 증거가 없다.');
  }
  if (!Number.isInteger(override.sourceRevision) || override.sourceRevision < 1) {
    failures.push('사용자 Harness override의 source revision이 유효하지 않다.');
  }
  if (!Number.isInteger(override.installedAtCycle) || override.installedAtCycle < 0
    || !Number.isInteger(override.installedAfterPromptSequence) || override.installedAfterPromptSequence < 0
    || !Number.isInteger(nextCall.cycle) || nextCall.cycle < override.installedAtCycle
    || !Number.isInteger(nextCall.sequence) || nextCall.sequence <= override.installedAfterPromptSequence) {
    failures.push('사용자 Harness override 이후의 다음 역할 호출 순서가 증명되지 않았다.');
  }
  if (nextCall.role !== override.role || nextCall.included !== true
    || typeof override.expectedValueDigest !== 'string' || override.expectedValueDigest.length !== 64
    || nextCall.promptValueDigest !== override.expectedValueDigest) {
    failures.push('사용자 Harness override가 다음 대상 역할 프롬프트에 포함되지 않았다.');
  }

  const injectionCanary = bundle.privateHarnessInjectionCanary;
  if (typeof injectionCanary !== 'string' || injectionCanary.trim() === '') {
    failures.push('Harness prompt-injection 비노출 검사용 canary가 없다.');
  } else {
    inspectPublicValue(
      bundle.harnessDownstreamOutputs || {},
      'harnessDownstream',
      failures,
      [injectionCanary],
      new Set(),
    );
  }

  return result('CF_HARNESS_PROTOCOL', failures, [
    ...cycles.map((item) => `cycle ${item.cycle}:harness-revision-${item.harnessRevision}`),
    override.expectedValueDigest ? `override:${override.role}:${override.expectedValueDigest}` : 'override:missing',
  ]);
}

function sessionGate(bundle) {
  const failures = [];
  const sessions = bundle.sessions || {};
  const audit = Array.isArray(bundle.sessionAudit) ? bundle.sessionAudit : [];
  const ids = [];
  for (const role of REQUIRED_ROLES) {
    const entry = sessions[role];
    if (!entry || typeof entry.id !== 'string' || entry.id.trim() === '') {
      failures.push(`${role} 세션 ID가 없다.`);
    } else {
      ids.push(entry.id.trim());
    }
  }
  if (ids.length === REQUIRED_ROLES.length && new Set(ids).size !== ids.length) {
    failures.push('Orchestrator와 두 워커의 세션 ID가 서로 다르지 않다.');
  }
  for (const role of REQUIRED_ROLES) {
    const roleAudit = audit.filter((entry) => entry.role === role);
    if (!roleAudit.some((entry) => entry.continuity === 'started')) {
      failures.push(`${role}: 신규 세션 시작 증거가 없다.`);
    }
    if (!roleAudit.some((entry) => entry.continuity === 'resumed_same')) {
      failures.push(`${role}: 동일 ID로 resume한 증거가 없다.`);
    }
    if (roleAudit.some((entry) => entry.continuity === 'replaced')) {
      failures.push(`${role}: resume 중 세션 ID가 교체되었다.`);
    }
    if (roleAudit.some((entry) => entry.continuity === 'forked_recovery'
      && (!entry.execution?.forked
        || entry.execution?.recovery !== 'fork_session'
        || entry.execution?.resumed !== true))) {
      failures.push(`${role}: fork 복구의 CLI 연속성 증거가 불완전하다.`);
    }
    if (roleAudit.some((entry) => entry.continuity === 'fresh_recovery'
      && (!entry.execution?.freshRecovery
        || entry.execution?.recovery !== 'fresh_session_after_fork_failure'
        || entry.execution?.resumed !== false))) {
      failures.push(`${role}: 새 세션 복구의 CLI 증거가 불완전하다.`);
    }
    if (roleAudit.some((entry) => !entry.execution
      || entry.execution.exitCode !== 0
      || !entry.execution.completionEvent
      || !entry.execution.executable)) {
      failures.push(`${role}: 실제 CLI 정상 종료 증거가 불완전하다.`);
    }
  }
  return result('CF_SESSION_SEPARATION', failures, [
    ...REQUIRED_ROLES.map((role) => `sessions.${role}.id`),
    ...audit.map((entry) => `${entry.role}:${entry.continuity}:cycle${entry.cycle}`),
  ]);
}

function reviewerGate(bundle) {
  const failures = [];
  const drafts = Array.isArray(bundle.drafts) ? bundle.drafts : [];
  const critiques = Array.isArray(bundle.critiques) ? bundle.critiques : [];
  const byId = new Map(drafts.map((draft) => [draft.id, draft]));

  for (const role of WORKER_ROLES) {
    if (drafts.filter((draft) => draft.author === role).length !== 1) {
      failures.push(`${role}의 독립 초안이 정확히 한 개가 아니다.`);
    }
  }
  if (critiques.length !== 2) failures.push('교차비평이 정확히 두 개가 아니다.');

  const reviewedDraftIds = new Set();
  for (const critique of critiques) {
    const draft = byId.get(critique.draftId);
    if (!draft) {
      failures.push(`비평 ${critique.id || '(id 없음)'}의 대상 초안을 찾을 수 없다.`);
      continue;
    }
    reviewedDraftIds.add(draft.id);
    if (!WORKER_ROLES.includes(critique.reviewer)) failures.push('비평자가 유효한 워커 역할이 아니다.');
    if (critique.reviewer === draft.author) failures.push(`${draft.id}: 작성자가 자신의 초안을 검토했다.`);
    if (critique.reviewedAuthor !== draft.author) failures.push(`${draft.id}: reviewedAuthor가 실제 작성자와 다르다.`);
    if (critique.sessionId && bundle.sessions && bundle.sessions[critique.reviewer]
      && critique.sessionId !== bundle.sessions[critique.reviewer].id) {
      failures.push(`${draft.id}: 비평 세션이 비평자 세션과 다르다.`);
    }
  }
  if (drafts.length === 2 && reviewedDraftIds.size !== 2) failures.push('두 초안 모두 상대 워커에게 검토되지 않았다.');
  return result('CF_REVIEWER_AUTHOR', failures, critiques.map((item) => `${item.reviewer}->${item.reviewedAuthor}:${item.draftId}`));
}

function questionApprovalGate(bundle) {
  const failures = [];
  const checkpoints = Array.isArray(bundle.requiredQuestionCheckpoints)
    ? bundle.requiredQuestionCheckpoints : [];
  if (checkpoints.length === 0) failures.push('필수 질문 승인 차단 체크포인트 증거가 없다.');

  for (const point of checkpoints) {
    const required = new Set(point.requiredQuestionIds || []);
    const answered = new Set(point.answeredQuestionIds || []);
    const unresolved = [...required].filter((id) => !answered.has(id));
    if (unresolved.length > 0) {
      if (point.state !== 'WAITING_USER_INPUT') failures.push(`cycle ${point.cycle}: 미응답 필수 질문이 있지만 WAITING_USER_INPUT이 아니다.`);
      if (point.approvalEnabled !== false) failures.push(`cycle ${point.cycle}: 미응답 필수 질문이 있지만 승인이 활성화되었다.`);
      if (point.approved === true) failures.push(`cycle ${point.cycle}: 미응답 필수 질문 상태에서 승인되었다.`);
    }
  }
  return result('CF_REQUIRED_QUESTION_APPROVAL', failures, checkpoints.map((point) => `cycle ${point.cycle}:${point.state}`));
}

function inspectPublicValue(value, path, failures, canaries, seen) {
  if (value === null || value === undefined) return;
  if (typeof value === 'string') {
    for (const canary of canaries) {
      if (canary && value.includes(canary)) failures.push(`${path}: 금지 canary가 공개되었다.`);
    }
    return;
  }
  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectPublicValue(item, `${path}[${index}]`, failures, canaries, seen));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (PUBLIC_REASONING_KEYS.test(key) && nested !== '' && nested !== null && nested !== undefined) {
      failures.push(`${path}.${key}: 내부 추론 필드가 공개되었다.`);
    }
    if ((key === 'type' || key === 'kind') && PUBLIC_REASONING_EVENT_TYPES.has(String(nested).toLowerCase())) {
      failures.push(`${path}.${key}: 내부 추론 이벤트가 공개되었다.`);
    }
    inspectPublicValue(nested, `${path}.${key}`, failures, canaries, seen);
  }
}

function hiddenReasoningGate(bundle) {
  const failures = [];
  const canaries = [bundle.hiddenReasoningCanary, ...(bundle.forbiddenPublicCanaries || [])].filter(Boolean);
  if (canaries.length === 0) failures.push('비노출 검사용 canary가 설정되지 않았다.');
  const publicEvidence = {
    // 사용자가 직접 입력한 canary는 사용자 레인에 보이는 것이 정상이다.
    // 에이전트·시스템 출력으로 재노출되는지만 검사한다.
    events: Array.isArray(bundle.publicEvents)
      ? bundle.publicEvents.filter((event) => String(event && event.role || '').toLowerCase() !== 'user')
      : [],
    artifacts: Array.isArray(bundle.publicArtifacts) ? bundle.publicArtifacts : [],
  };
  inspectPublicValue(publicEvidence, 'public', failures, canaries, new Set());
  return result('CF_HIDDEN_REASONING_OR_CANARY', failures, [
    `publicEvents:${publicEvidence.events.length}`,
    `publicArtifacts:${publicEvidence.artifacts.length}`,
    `canaries:${canaries.length}`,
  ]);
}

function getPath(value, path) {
  return String(path).split('.').reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    return current[key];
  }, value);
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function includesValue(actual, expected) {
  if (Array.isArray(actual)) return actual.some((item) => deepEqual(item, expected) || (typeof item === 'string' && item.includes(expected)));
  if (typeof actual === 'string') return actual.includes(expected);
  return false;
}

function feedbackGate(bundle) {
  const failures = [];
  const feedback = bundle.feedback || {};
  const requiredIds = Array.isArray(feedback.requiredIds) ? feedback.requiredIds : [];
  const submittedIds = new Set(feedback.submittedIds || []);
  const synthesis = feedback.nextSynthesis;
  const addressed = new Set((synthesis && synthesis.addressedFeedbackIds) || []);
  const evidenceById = (synthesis && synthesis.evidenceByFeedbackId) || {};

  if (requiredIds.length === 0) failures.push('고정 피드백 요구사항 ID가 없다.');
  if (!synthesis || typeof synthesis !== 'object') failures.push('피드백 이후 Synthesis가 없다.');
  for (const id of requiredIds) {
    if (!submittedIds.has(id)) failures.push(`${id}: 사용자 피드백 제출 기록이 없다.`);
    if (!addressed.has(id)) failures.push(`${id}: 다음 Synthesis의 addressedFeedbackIds에 없다.`);
    if (typeof evidenceById[id] !== 'string' || evidenceById[id].trim() === '') {
      failures.push(`${id}: 피드백 반영 근거가 없다.`);
    }
  }
  for (const assertion of feedback.expectedAssertions || []) {
    const actual = getPath(synthesis, assertion.path);
    if (Object.prototype.hasOwnProperty.call(assertion, 'equals') && !deepEqual(actual, assertion.equals)) {
      failures.push(`${assertion.id}: ${assertion.path} 값이 기대값과 다르다.`);
    }
    // The structured summary can legitimately use a translated module label
    // (for example, "Price-yield sensitivity matrix") while the final plan
    // preserves the user's Korean wording.  Treat the actual plan body as
    // authoritative fallback evidence instead of failing on label language.
    const planBody = bundle.synthesis && typeof bundle.synthesis.planMarkdown === 'string'
      ? bundle.synthesis.planMarkdown
      : '';
    if (Object.prototype.hasOwnProperty.call(assertion, 'includes')
      && !includesValue(actual, assertion.includes)
      && !includesValue(planBody, assertion.includes)) {
      failures.push(`${assertion.id}: ${assertion.path}에 기대 항목이 없다.`);
    }
  }
  return result('CF_FEEDBACK_NOT_REFLECTED', failures, requiredIds.map((id) => `feedback:${id}`));
}

function evaluateEvidence(bundle) {
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new TypeError('evidence bundle은 객체여야 한다.');
  }
  const gates = [
    schemaGate(bundle),
    stageGate(bundle),
    harnessGate(bundle),
    sessionGate(bundle),
    reviewerGate(bundle),
    questionApprovalGate(bundle),
    hiddenReasoningGate(bundle),
    feedbackGate(bundle),
  ];
  return {
    passed: gates.every((gate) => gate.passed),
    gates,
  };
}

module.exports = {
  evaluateEvidence,
  getPath,
  _gates: {
    schemaGate,
    stageGate,
    harnessGate,
    sessionGate,
    reviewerGate,
    questionApprovalGate,
    hiddenReasoningGate,
    feedbackGate,
  },
};
