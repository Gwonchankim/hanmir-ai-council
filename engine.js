'use strict';

const crypto = require('crypto');
const config = require('./config');
const defaultStore = require('./state');
const prompts = require('./agents/prompts');
const councilPrompts = require('./agents/council-prompts');
const { callBrain: defaultBrainCaller } = require('./agents/brain');
const { schemaFor, parseStructured, validateArtifact } = require('./schemas');
const { roleToMarkdown } = require('./harnesses');
const { writeCouncilReport } = require('./lib/council-report');
const {
  anonymizeResponse,
  identityLeaks,
  validateAnonymousBundle,
} = require('./lib/council-anonymity');
const {
  activeCircuit,
  classifyFallbackError,
  isFallbackEligible,
  publicRoute,
  routeChain,
  routeKey,
} = require('./lib/model-router');

const ROLE_META = Object.freeze({
  orchestrator: { eventRole: 'orchestrator', label: 'Orchestrator' },
  claudeWorker: { eventRole: 'claude', label: 'Claude 워커' },
  codexWorker: { eventRole: 'codex', label: 'ChatGPT 워커' },
});

function abortError(message = '실행이 취소되었습니다.') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function assertPromptWithinLimit(prompt) {
  const value = typeof prompt === 'string' ? prompt : String(prompt ?? '');
  const limit = config.limits.promptChars;
  const characterLength = value.length;
  const utf8Bytes = Buffer.byteLength(value, 'utf8');
  if (characterLength > limit || utf8Bytes > limit) {
    const error = new Error(
      `LLM 호출 프롬프트가 허용 한도(${limit.toLocaleString()}자/UTF-8 바이트)를 초과했습니다.`,
    );
    error.name = 'PromptLimitError';
    error.code = 'PROMPT_TOO_LARGE';
    error.status = 413;
    throw error;
  }
  return value;
}

function providerConfig(state, roleKey) {
  if (ROLE_META[roleKey]) return state.config[roleKey];
  if (roleKey === 'councilChair' || roleKey === 'councilFramer') return state.config.council.chair;
  const advisorMatch = roleKey.match(/^council(?:Advisor|Reviewer):(.+)$/);
  if (advisorMatch && state.config.council.advisors[advisorMatch[1]]) {
    return state.config.council.advisors[advisorMatch[1]];
  }
  throw new Error(`알 수 없는 역할: ${roleKey}`);
}

function roleMeta(roleKey, selected = {}) {
  if (ROLE_META[roleKey]) return ROLE_META[roleKey];
  if (roleKey === 'councilChair' || roleKey === 'councilFramer') {
    return { eventRole: 'orchestrator', label: roleKey === 'councilFramer' ? 'Council Framer' : 'Council Chair' };
  }
  const advisorMatch = roleKey.match(/^council(Advisor|Reviewer):(.+)$/);
  if (advisorMatch) {
    const label = advisorMatch[1] === 'Reviewer' ? '익명 동료평가자' : '독립 조언자';
    return {
      eventRole: selected.brain === 'claude' ? 'claude' : 'codex',
      label: `${label} · ${advisorMatch[2]}`,
    };
  }
  return { eventRole: 'orchestrator', label: roleKey };
}

function shuffled(values) {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = crypto.randomInt(index + 1);
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

function convergenceReached(claudeCritique, codexCritique) {
  return [claudeCritique, codexCritique].every((critique) => (
    critique.verdict === 'accept'
    && critique.missingRequirementIds.length === 0
    && !critique.issues.some((issue) => ['high', 'critical'].includes(issue.severity))
  ));
}

function feedbackIdsFromCycles(cycles, throughCycle = Infinity) {
  const ids = new Set();
  for (const cycle of cycles || []) {
    if (Number(cycle?.number) > throughCycle) continue;
    const matches = String(cycle?.instruction || '').match(/\bFB-[A-Z0-9-]+\b/gi) || [];
    matches.forEach((id) => ids.add(id.toUpperCase()));
  }
  return [...ids];
}

function instructionMentionsMetric(instruction, value, units) {
  if (!Number.isFinite(Number(value))) return false;
  const escapedUnits = units.map((unit) => unit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return new RegExp(`(?:^|\\D)${Number(value)}\\s*(?:${escapedUnits})(?:\\D|$)`, 'i')
    .test(String(instruction || ''));
}

function semanticErrors(type, artifact, context = {}) {
  const errors = [];
  if (['decisionFrame', 'advisorAnalysis', 'peerReview', 'councilVerdict'].includes(type)
    && artifact.cycle !== context.cycle) {
    errors.push({ path: '/cycle', message: `cycle must be ${context.cycle}.` });
  }
  if (type === 'decisionFrame') {
    if (artifact.needsInput && !String(artifact.clarifyingQuestion || '').trim()) {
      errors.push({ path: '/clarifyingQuestion', message: 'needsInput=true이면 확인 질문 하나가 필요합니다.' });
    }
    if (!artifact.needsInput && String(artifact.clarifyingQuestion || '').trim()) {
      errors.push({ path: '/clarifyingQuestion', message: 'needsInput=false이면 clarifyingQuestion은 빈 문자열이어야 합니다.' });
    }
  }
  if (type === 'advisorAnalysis' && artifact.advisor !== context.advisor) {
    errors.push({ path: '/advisor', message: `advisor는 ${context.advisor}이어야 합니다.` });
  }
  if (type === 'advisorAnalysis') {
    const leaks = identityLeaks(artifact);
    if (leaks.length) {
      errors.push({
        path: '/assessment',
        message: `익명 평가에 노출되는 본문에는 역할명·모델명·Provider명을 쓸 수 없습니다: ${leaks.join(', ')}`,
      });
    }
  }
  if (type === 'peerReview' && artifact.reviewer !== context.reviewer) {
    errors.push({ path: '/reviewer', message: `reviewer는 ${context.reviewer}이어야 합니다.` });
  }
  if (type === 'councilVerdict') {
    if (artifact.planVersion !== context.planVersion) {
      errors.push({ path: '/planVersion', message: `planVersion은 ${context.planVersion}이어야 합니다.` });
    }
    const headings = [
      'Where the Council Agrees',
      'Where the Council Clashes',
      'Blind Spots the Council Caught',
      'The Recommendation',
      'The One Thing to Do First',
    ];
    for (const heading of headings) {
      if (!String(artifact.planMarkdown || '').includes(heading)) {
        errors.push({ path: '/planMarkdown', message: `${heading} 섹션이 필요합니다.` });
      }
    }
  }
  if (type === 'harnessSet' && artifact.cycle !== context.cycle) {
    errors.push({ path: '/cycle', message: `cycle must be ${context.cycle}.` });
  }
  if (type === 'taskPackage' && artifact.cycle !== context.cycle) {
    errors.push({ path: '/cycle', message: `cycle은 ${context.cycle}이어야 합니다.` });
  }
  if (type === 'taskPackage') {
    const prefix = `C${context.cycle}-`;
    for (const item of artifact.missingInformation || []) {
      if (!item.id.startsWith(prefix)) {
        errors.push({ path: '/missingInformation', message: `질문 ID ${item.id}는 ${prefix} 접두사를 사용해야 합니다.` });
      }
    }
  }
  if (type === 'draft' && artifact.author !== context.author) {
    errors.push({ path: '/author', message: `author는 ${context.author}이어야 합니다.` });
  }
  if (type === 'critique') {
    if (artifact.reviewer !== context.reviewer) errors.push({ path: '/reviewer', message: `reviewer는 ${context.reviewer}이어야 합니다.` });
    if (artifact.subjectAuthor !== context.subjectAuthor) errors.push({ path: '/subjectAuthor', message: `subjectAuthor는 ${context.subjectAuthor}이어야 합니다.` });
    if (artifact.reviewer === artifact.subjectAuthor) errors.push({ path: '/', message: 'reviewer와 subjectAuthor는 달라야 합니다.' });
  }
  if (type === 'revision' && artifact.author !== context.author) {
    errors.push({ path: '/author', message: `author는 ${context.author}이어야 합니다.` });
  }
  if (type === 'synthesis') {
    if (artifact.planVersion !== context.planVersion) {
      errors.push({ path: '/planVersion', message: `planVersion은 ${context.planVersion}이어야 합니다.` });
    }
    const requiredQuestions = artifact.requiredQuestions || [];
    const expectedStatus = requiredQuestions.length ? 'needs_input' : 'ready_for_approval';
    if (artifact.status !== expectedStatus) {
      errors.push({ path: '/status', message: `requiredQuestions 수에 따라 status는 ${expectedStatus}이어야 합니다.` });
    }
    const requiredMissingIds = (context.taskPackage?.missingInformation || [])
      .filter((item) => item.required)
      .map((item) => item.id);
    const questionIds = new Set(requiredQuestions.map((item) => item.id));
    for (const id of requiredMissingIds) {
      if (!questionIds.has(id)) errors.push({ path: '/requiredQuestions', message: `필수 누락 정보 ${id}에 대한 질문이 없습니다.` });
    }
    const requirementIds = (context.taskPackage?.requirements || []).map((item) => item.id);
    const traced = new Set((artifact.requirementTraceability || []).map((item) => item.requirementId));
    for (const id of requirementIds) {
      if (!traced.has(id)) errors.push({ path: '/requirementTraceability', message: `요구사항 ${id}가 추적되지 않았습니다.` });
    }
    const tested = new Set((artifact.validationPlan || []).flatMap((item) => item.requirementIds || []));
    for (const id of requirementIds) {
      if (!tested.has(id)) errors.push({ path: '/validationPlan', message: `요구사항 ${id}의 직접 검증 항목이 없습니다.` });
    }
    if (!artifact.integration?.acceptedFromClaude?.length) {
      errors.push({ path: '/integration/acceptedFromClaude', message: 'Claude 워커의 실질 기여가 한 건 이상 필요합니다.' });
    }
    if (!artifact.integration?.acceptedFromCodex?.length) {
      errors.push({ path: '/integration/acceptedFromCodex', message: 'Codex 워커의 실질 기여가 한 건 이상 필요합니다.' });
    }
    if (context.isFeedback && !artifact.feedbackTraceability?.length) {
      errors.push({ path: '/feedbackTraceability', message: '피드백 cycle에는 반영 추적 항목이 한 건 이상 필요합니다.' });
    }
    const requiredFeedbackIds = context.requiredFeedbackIds || [];
    const feedbackTrace = new Map((artifact.feedbackTraceability || []).map((item) => [
      String(item.feedbackId || '').toUpperCase(), item,
    ]));
    for (const id of requiredFeedbackIds) {
      const item = feedbackTrace.get(id);
      if (!item) {
        errors.push({ path: '/feedbackTraceability', message: `사용자 피드백 ${id} 추적이 누락됐습니다.` });
      } else if (item.status !== 'addressed' || !String(item.evidence || '').trim()) {
        errors.push({ path: '/feedbackTraceability', message: `사용자 피드백 ${id}는 addressed 상태와 구체적 근거가 필요합니다.` });
      }
    }
    if (context.priorPlan?.feedbackTraceability?.length) {
      const retainedFeedbackIds = new Set((artifact.feedbackTraceability || []).map((item) => item.feedbackId));
      for (const prior of context.priorPlan.feedbackTraceability.filter((item) => item.status === 'addressed')) {
        if (!retainedFeedbackIds.has(prior.feedbackId)) {
          errors.push({ path: '/feedbackTraceability', message: `이전 반영 피드백 ${prior.feedbackId} 추적이 누락됐습니다.` });
        }
      }
    }
    const feedbackIds = new Set([
      ...(artifact.feedbackTraceability || []).map((item) => item.feedbackId),
      ...(context.priorPlan?.feedbackTraceability || []).map((item) => item.feedbackId),
    ]);
    if (feedbackIds.has('FB-SENSITIVITY')) {
      if (!(artifact.measurableTargets?.analysisModules || []).some((item) => item.includes('가격·수율 민감도'))) {
        errors.push({ path: '/measurableTargets/analysisModules', message: '사용자 표현 "가격·수율 민감도"를 그대로 포함해야 합니다.' });
      }
      if ((artifact.measurableTargets?.priceScenarios || []).length < 3) {
        errors.push({ path: '/measurableTargets/priceScenarios', message: '실제 가격 변수를 쓰는 시나리오가 3개 이상 필요합니다.' });
      }
      if ((artifact.measurableTargets?.yieldScenarios || []).length < 3) {
        errors.push({ path: '/measurableTargets/yieldScenarios', message: '수율 시나리오가 3개 이상 필요합니다.' });
      }
    }
    if (feedbackIds.has('FB-GATE') && !(artifact.measurableTargets?.validationDays > 0)) {
      errors.push({ path: '/measurableTargets/validationDays', message: 'FB-GATE를 반영한 검증 기간은 0보다 커야 합니다.' });
    }
    if (feedbackIds.has('FB-OUTLINE') && !(artifact.measurableTargets?.targetPages > 0)) {
      errors.push({ path: '/measurableTargets/targetPages', message: 'FB-OUTLINE을 반영한 보고서 분량은 0보다 커야 합니다.' });
    }
    const priorTargets = context.priorPlan?.measurableTargets || {};
    const nextTargets = artifact.measurableTargets || {};
    if (priorTargets.targetPages > 0 && nextTargets.targetPages !== priorTargets.targetPages
      && !instructionMentionsMetric(context.instruction, nextTargets.targetPages, ['쪽', '페이지', 'page', 'pages'])) {
      errors.push({
        path: '/measurableTargets/targetPages',
        message: `이전 보고서 분량 ${priorTargets.targetPages}쪽을 유지하거나 사용자 피드백에 새 분량을 명시해야 합니다.`,
      });
    }
    if (priorTargets.validationDays > 0 && nextTargets.validationDays !== priorTargets.validationDays
      && !instructionMentionsMetric(context.instruction, nextTargets.validationDays, ['일', 'day', 'days'])) {
      errors.push({
        path: '/measurableTargets/validationDays',
        message: `이전 검증 기간 ${priorTargets.validationDays}일을 유지하거나 사용자 피드백에 새 기간을 명시해야 합니다.`,
      });
    }
    if (context.priorPlan?.title && /harness/i.test(artifact.title)
      && !/harness/i.test(context.priorPlan.title)
      && !/harness/i.test(String(context.instruction || ''))) {
      errors.push({ path: '/title', message: '피드백 통합안이 기존 기획안 대신 Harness 자체를 최종 산출물로 바꾸면 안 됩니다.' });
    }
  }
  return errors;
}

class PlanningEngine {
  constructor({ store = defaultStore, brainCaller = defaultBrainCaller } = {}) {
    this.store = store;
    this.brainCaller = brainCaller;
    this.sink = () => {};
    this.active = null;
  }

  setEmitter(fn) { this.sink = typeof fn === 'function' ? fn : () => {}; }

  emit(event) {
    const envelope = this.store.appendEvent(event);
    this.sink(envelope);
    return envelope;
  }

  _assertCurrent(runId, signal) {
    if (signal?.aborted) throw abortError();
    if (this.store.get().runId !== runId) throw abortError('더 최신 실행이 시작되어 이전 결과를 폐기했습니다.');
  }

  _setStage(cycle, phase, round, runId) {
    this._assertCurrent(runId);
    const state = this.store.get();
    state.phase = phase;
    state.round = round;
    cycle.stage = phase;
    this.store.touch();
    this.store.snapshot();
    this.emit({ type: 'stage', role: 'system', message: phase, phase, round, runId });
  }

  _roleConfig(roleKey) { return providerConfig(this.store.get(), roleKey); }

  async _invoke(roleKey, prompt, artifactType, context, runId, signal) {
    this._assertCurrent(runId, signal);
    const state = this.store.get();
    const selected = this._roleConfig(roleKey);
    const routes = routeChain(selected);
    if (!routes.length) throw new Error(`${roleKey}에 사용할 모델 경로가 없습니다.`);

    let latestText = '';
    let validation = null;
    let preferredRouteIndex = 0;
    let lastRole = roleMeta(roleKey, routes[0]);
    for (let attempt = 0; attempt <= config.loop.structuredRetries; attempt += 1) {
      const callPrompt = assertPromptWithinLimit(attempt === 0
        ? prompt
        : prompts.repair({
          artifactType,
          invalidText: latestText,
          errors: validation,
          harness: context.harness,
          role: roleKey,
        }));
      const harnessMarkdown = context.harness ? roleToMarkdown(context.harness) : '';
      const harnessDigest = harnessMarkdown
        ? crypto.createHash('sha256').update(harnessMarkdown, 'utf8').digest('hex')
        : null;
      const promptBinding = harnessDigest ? {
        harnessRevision: this.store.currentCycle()?.harnessRevision ?? null,
        harnessDigest,
        promptHarnessDigest: callPrompt.includes(harnessMarkdown) ? harnessDigest : null,
        included: callPrompt.includes(harnessMarkdown),
      } : null;
      let result = null;
      let activeRoute = null;
      let activeRouteIndex = preferredRouteIndex;
      let previousSession = null;
      let fallbackFrom = null;
      for (let routeIndex = preferredRouteIndex; routeIndex < routes.length; routeIndex += 1) {
        const candidate = routes[routeIndex];
        const role = roleMeta(roleKey, candidate);
        const circuit = activeCircuit(state.routeHealth, candidate);
        const hasCircuitFallback = routeIndex + 1 < routes.length;
        if (circuit && hasCircuitFallback) {
          const next = routes[routeIndex + 1];
          fallbackFrom = candidate;
          this.emit({
            type: 'status',
            role: role.eventRole,
            logicalRole: roleKey,
            message: `${role.label}의 ${candidate.brain}/${candidate.model} 회로가 열려 있어 ${next.brain}/${next.model}로 바로 전환합니다.`,
            artifactType,
            circuit: { ...circuit, skipped: publicRoute(candidate) },
            fallback: {
              from: publicRoute(candidate),
              to: publicRoute(next),
              reason: 'circuit_open',
            },
            runId,
          });
          continue;
        }
        const sessionKey = routeKey(candidate);
        state.routeSessions ||= {};
        state.routeSessions[roleKey] ||= {};
        previousSession = state.routeSessions[roleKey][sessionKey]
          || (routeIndex === 0 ? state.sessions[roleKey] : null);
        this.emit({
          type: 'status',
          role: role.eventRole,
          logicalRole: roleKey,
          message: `${role.label} · ${candidate.brain}/${candidate.model} · effort ${candidate.effort} 시작`,
          artifactType,
          modelRoute: publicRoute(candidate),
          routeIndex,
          runId,
        });
        try {
          result = await this.brainCaller({
            ...candidate,
            prompt: callPrompt,
            session: previousSession,
            schema: schemaFor(artifactType),
            signal,
            // 어댑터의 공개 가능한 진행 이벤트만 허용하며 본문/추론 청크는 중계하지 않는다.
            onEvent: (kind, content) => {
              if (kind === 'status' && content) {
                this.emit({
                  type: 'status',
                  role: role.eventRole,
                  logicalRole: roleKey,
                  message: String(content).slice(0, 500),
                  artifactType,
                  runId,
                });
              }
            },
          });
          activeRoute = candidate;
          activeRouteIndex = routeIndex;
          preferredRouteIndex = routeIndex;
          break;
        } catch (error) {
          const hasNext = routeIndex + 1 < routes.length;
          if (!hasNext || !isFallbackEligible(error)) throw error;
          const classification = classifyFallbackError(error);
          const openedCircuit = this.store.openRouteCircuit(candidate, classification);
          fallbackFrom = candidate;
          const next = routes[routeIndex + 1];
          this.emit({
            type: 'status',
            role: role.eventRole,
            logicalRole: roleKey,
            message: `${role.label}의 ${candidate.brain}/${candidate.model} 사용량·가용성 오류로 ${next.brain}/${next.model} 대체 경로를 사용합니다.`,
            artifactType,
            fallback: {
              from: publicRoute(candidate),
              to: publicRoute(next),
              reason: classification?.reason || 'provider_limit_or_availability',
            },
            circuit: openedCircuit,
            runId,
          });
        }
      }
      this._assertCurrent(runId, signal);
      const role = roleMeta(roleKey, activeRoute || selected);
      lastRole = role;
      if (!result?.session) throw new Error(`${role.label}가 세션 ID를 반환하지 않았습니다.`);
      this.store.recordSessionInvocation({
        role: roleKey,
        artifactType,
        attempt,
        previousSession,
        returnedSession: result.session,
        execution: result.execution,
        promptBinding,
        ...publicRoute(activeRoute),
        routeIndex: activeRouteIndex,
        fallbackFrom,
        usage: result.usage,
      });
      this.store.closeRouteCircuit(activeRoute);
      state.routeSessions[roleKey][routeKey(activeRoute)] = result.session;
      state.sessions[roleKey] = result.session;
      latestText = result.text;

      try {
        const artifact = parseStructured(latestText);
        const schemaResult = validateArtifact(artifactType, artifact);
        const semantic = schemaResult.valid ? semanticErrors(artifactType, artifact, context) : [];
        validation = [...schemaResult.errors, ...semantic];
        if (schemaResult.valid && semantic.length === 0) {
          if (!context.deferArtifactEvent) {
            this.emit({
              type: 'artifact', role: role.eventRole,
              logicalRole: roleKey,
              message: `${role.label}의 ${artifactType} 완료`,
              artifactType, artifact, modelRoute: publicRoute(activeRoute),
              routeIndex: activeRouteIndex, usage: result.usage, runId,
            });
          }
          this.store.touch();
          this.store.snapshot();
          return artifact;
        }
      } catch (error) {
        validation = [{ path: '/', message: error.message }];
      }
    }
    const error = new Error(`${lastRole.label}의 ${artifactType} 구조 검증에 실패했습니다: ${validation.map((item) => `${item.path} ${item.message}`).join('; ')}`);
    error.name = 'StructuredOutputError';
    throw error;
  }

  async _runPair(tasks, parentSignal) {
    const controllers = tasks.map(() => new AbortController());
    const abortAll = () => controllers.forEach((controller) => controller.abort());
    if (parentSignal) parentSignal.addEventListener('abort', abortAll, { once: true });
    let firstRealError = null;
    const promises = tasks.map((task, index) => task(controllers[index].signal).catch((error) => {
      if (error.name !== 'AbortError' && !firstRealError) firstRealError = error;
      controllers.forEach((controller, other) => { if (other !== index) controller.abort(); });
      throw error;
    }));
    const settled = await Promise.allSettled(promises);
    if (parentSignal) parentSignal.removeEventListener('abort', abortAll);
    const rejected = settled.find((item) => item.status === 'rejected');
    if (rejected) throw firstRealError || rejected.reason;
    return settled.map((item) => item.value);
  }

  async _runPool(tasks, maxParallel, signal) {
    const results = new Array(tasks.length);
    const errors = new Array(tasks.length);
    let cursor = 0;
    const worker = async () => {
      while (cursor < tasks.length) {
        this._assertCurrent(this.store.get().runId, signal);
        const index = cursor;
        cursor += 1;
        try {
          results[index] = await tasks[index](signal);
        } catch (error) {
          errors[index] = error;
        }
      }
    };
    const count = Math.max(1, Math.min(Number(maxParallel) || 1, tasks.length));
    await Promise.all(Array.from({ length: count }, () => worker()));
    const failure = errors.find(Boolean);
    if (failure) throw failure;
    return results;
  }

  runInstruction(instruction, isFeedback = false) {
    return this.store.get().config.mode === 'decision_council'
      ? this.runDecisionCouncil(instruction, isFeedback)
      : this.runPlanning(instruction, isFeedback);
  }

  runDecisionCouncil(instruction, isFeedback = false) {
    const text = String(instruction || '').trim();
    if (!text) throw new Error('의사결정 질문 또는 피드백 내용이 비어 있습니다.');
    if (text.length > config.limits.instructionChars) throw new Error('입력 길이가 허용 한도를 초과했습니다.');
    const state = this.store.get();
    if (this.store.isRunning() || this.active) throw new Error('이미 실행 중입니다.');
    if (isFeedback) {
      if (!state.currentPlan || !['awaiting_input', 'awaiting_approval'].includes(state.phase)) {
        throw new Error('피드백을 반영할 Council 결과가 없습니다.');
      }
    } else if (!['idle', 'approved', 'cancelled'].includes(state.phase)) {
      throw new Error('새 Council을 시작할 수 없는 상태입니다. 피드백 또는 재시도를 사용하세요.');
    }

    const cycle = this.store.beginCycle(text, isFeedback);
    cycle.stage = 'framing';
    const runId = this.store.get().runId;
    this.emit({
      type: 'user',
      role: 'user',
      message: text,
      intent: isFeedback ? 'feedback' : 'instruction',
      runId,
    });
    const controller = new AbortController();
    const promise = this._executeDecisionCouncil(cycle, runId, controller.signal)
      .finally(() => {
        if (this.active?.runId === runId) this.active = null;
      });
    this.active = { runId, controller, promise };
    return { runId, cycle: cycle.number, promise };
  }

  runPlanning(instruction, isFeedback = false) {
    const text = String(instruction || '').trim();
    if (!text) throw new Error('지시 또는 피드백 내용이 비어 있습니다.');
    if (text.length > config.limits.instructionChars) throw new Error('입력 길이가 허용 한도를 초과했습니다.');
    const state = this.store.get();
    if (this.store.isRunning() || this.active) throw new Error('이미 실행 중입니다.');
    if (isFeedback) {
      if (!state.currentPlan || !['awaiting_input', 'awaiting_approval'].includes(state.phase)) {
        throw new Error('피드백을 반영할 수 있는 기획안이 없습니다.');
      }
    } else if (!['idle', 'approved', 'cancelled'].includes(state.phase)) {
      throw new Error('새 지시를 시작할 수 없는 상태입니다. 피드백 또는 재시도를 사용하세요.');
    }

    const cycle = this.store.beginCycle(text, isFeedback);
    const runId = this.store.get().runId;
    this.emit({
      type: 'user', role: 'user', message: text,
      intent: isFeedback ? 'feedback' : 'instruction', runId,
    });
    const controller = new AbortController();
    const promise = this._execute(cycle, runId, controller.signal)
      .finally(() => {
        if (this.active?.runId === runId) this.active = null;
      });
    this.active = { runId, controller, promise };
    return { runId, cycle: cycle.number, promise };
  }

  retry() {
    const state = this.store.get();
    const cycle = this.store.currentCycle();
    if (state.phase !== 'failed' || !cycle || this.active) throw new Error('재시도할 실패 단계가 없습니다.');
    const runId = crypto.randomUUID();
    state.runId = runId;
    state.phase = cycle.stage || 'dispatching';
    state.lastError = null;
    cycle.status = 'running';
    const controller = new AbortController();
    const execute = state.config.mode === 'decision_council'
      ? this._executeDecisionCouncil.bind(this)
      : this._execute.bind(this);
    const promise = execute(cycle, runId, controller.signal)
      .finally(() => { if (this.active?.runId === runId) this.active = null; });
    this.active = { runId, controller, promise };
    this.store.snapshot();
    return { runId, cycle: cycle.number, promise };
  }

  cancel() {
    if (!this.active || !this.store.isRunning()) throw new Error('취소할 실행이 없습니다.');
    const previousRunId = this.active.runId;
    this.store.get().runId = crypto.randomUUID();
    this.active.controller.abort();
    const cycle = this.store.currentCycle();
    if (cycle) { cycle.status = 'cancelled'; cycle.completedAt = new Date().toISOString(); }
    this.store.get().phase = 'cancelled';
    this.store.get().lastError = null;
    this.emit({ type: 'status', role: 'system', message: '사용자가 실행을 취소했습니다.', runId: previousRunId });
    this.store.snapshot();
  }

  _checkpointValid(type, artifact, context) {
    if (!artifact || typeof artifact !== 'object') return false;
    const schemaResult = validateArtifact(type, artifact);
    return schemaResult.valid && semanticErrors(type, artifact, context).length === 0;
  }

  _revalidateCheckpointArtifacts(cycle) {
    if (!cycle.artifacts || typeof cycle.artifacts !== 'object' || Array.isArray(cycle.artifacts)) {
      cycle.artifacts = {};
    }
    const artifacts = cycle.artifacts;
    const state = this.store.get();
    const drop = (...keys) => keys.forEach((key) => { delete artifacts[key]; });
    const downstream = [
      'taskPackage', 'claudeDraft', 'codexDraft', 'claudeCritique', 'codexCritique',
      'claudeRevision', 'codexRevision', 'convergedAtR1', 'synthesis',
    ];

    if (!artifacts.harnessSet) {
      drop(...downstream);
      return;
    }
    if (!this._checkpointValid('harnessSet', artifacts.harnessSet, { cycle: cycle.number })
      || JSON.stringify(artifacts.harnessSet) !== JSON.stringify(state.harnesses)) {
      drop('harnessSet', ...downstream);
      cycle.harnessRevision = null;
      return;
    }
    if (artifacts.taskPackage
      && !this._checkpointValid('taskPackage', artifacts.taskPackage, { cycle: cycle.number })) {
      drop(...downstream);
      return;
    }
    if (!artifacts.taskPackage) {
      drop('claudeDraft', 'codexDraft', 'claudeCritique', 'codexCritique',
        'claudeRevision', 'codexRevision', 'convergedAtR1', 'synthesis');
      return;
    }

    let draftInvalid = false;
    if (artifacts.claudeDraft && !this._checkpointValid('draft', artifacts.claudeDraft, { author: 'claude' })) {
      drop('claudeDraft');
      draftInvalid = true;
    }
    if (artifacts.codexDraft && !this._checkpointValid('draft', artifacts.codexDraft, { author: 'codex' })) {
      drop('codexDraft');
      draftInvalid = true;
    }
    if (draftInvalid || !artifacts.claudeDraft || !artifacts.codexDraft) {
      drop('claudeCritique', 'codexCritique', 'claudeRevision', 'codexRevision', 'convergedAtR1', 'synthesis');
      return;
    }

    let critiqueInvalid = false;
    if (artifacts.claudeCritique && !this._checkpointValid('critique', artifacts.claudeCritique, {
      reviewer: 'claude', subjectAuthor: 'codex',
    })) {
      drop('claudeCritique');
      critiqueInvalid = true;
    }
    if (artifacts.codexCritique && !this._checkpointValid('critique', artifacts.codexCritique, {
      reviewer: 'codex', subjectAuthor: 'claude',
    })) {
      drop('codexCritique');
      critiqueInvalid = true;
    }
    if (critiqueInvalid || !artifacts.claudeCritique || !artifacts.codexCritique) {
      drop('claudeRevision', 'codexRevision', 'convergedAtR1', 'synthesis');
      return;
    }

    let revisionInvalid = false;
    if (artifacts.claudeRevision && !this._checkpointValid('revision', artifacts.claudeRevision, { author: 'claude' })) {
      drop('claudeRevision');
      revisionInvalid = true;
    }
    if (artifacts.codexRevision && !this._checkpointValid('revision', artifacts.codexRevision, { author: 'codex' })) {
      drop('codexRevision');
      revisionInvalid = true;
    }
    if (revisionInvalid) drop('synthesis');
    if (artifacts.synthesis && !this._checkpointValid('synthesis', artifacts.synthesis, {
      planVersion: state.planVersion + 1,
      taskPackage: artifacts.taskPackage,
      isFeedback: cycle.isFeedback,
      priorPlan: cycle.isFeedback ? state.currentPlan : null,
      instruction: cycle.instruction,
      requiredFeedbackIds: feedbackIdsFromCycles(state.cycles, cycle.number),
    })) drop('synthesis');
  }

  _revalidateDecisionCouncilArtifacts(cycle) {
    if (!cycle.artifacts || typeof cycle.artifacts !== 'object' || Array.isArray(cycle.artifacts)) {
      cycle.artifacts = {};
    }
    const artifacts = cycle.artifacts;
    const advisorKeys = config.COUNCIL_ADVISOR_KEYS;
    const dropDownstream = () => {
      delete artifacts.anonymizationMapping;
      delete artifacts.anonymousResponses;
      delete artifacts.peerReviews;
      delete artifacts.councilVerdict;
      delete artifacts.councilReports;
    };
    if (artifacts.decisionFrame && !this._checkpointValid(
      'decisionFrame', artifacts.decisionFrame, { cycle: cycle.number },
    )) {
      delete artifacts.decisionFrame;
      delete artifacts.advisorAnalyses;
      dropDownstream();
      return;
    }
    if (!artifacts.decisionFrame || artifacts.decisionFrame.needsInput) return;
    artifacts.advisorAnalyses ||= {};
    for (const advisor of advisorKeys) {
      if (artifacts.advisorAnalyses[advisor] && !this._checkpointValid(
        'advisorAnalysis',
        artifacts.advisorAnalyses[advisor],
        { cycle: cycle.number, advisor },
      )) delete artifacts.advisorAnalyses[advisor];
    }
    if (advisorKeys.some((advisor) => !artifacts.advisorAnalyses[advisor])) {
      dropDownstream();
      return;
    }
    const mappingValues = Object.values(artifacts.anonymizationMapping || {});
    if (mappingValues.length !== advisorKeys.length
      || new Set(mappingValues).size !== advisorKeys.length
      || advisorKeys.some((advisor) => !mappingValues.includes(advisor))) {
      dropDownstream();
      return;
    }
    if (validateAnonymousBundle({
      mapping: artifacts.anonymizationMapping,
      responses: artifacts.anonymousResponses,
      advisorAnalyses: artifacts.advisorAnalyses,
      advisorKeys,
    }).length) {
      dropDownstream();
      return;
    }
    artifacts.peerReviews ||= {};
    for (const reviewer of advisorKeys) {
      if (artifacts.peerReviews[reviewer] && !this._checkpointValid(
        'peerReview',
        artifacts.peerReviews[reviewer],
        { cycle: cycle.number, reviewer },
      )) delete artifacts.peerReviews[reviewer];
    }
    if (advisorKeys.some((reviewer) => !artifacts.peerReviews[reviewer])) {
      delete artifacts.councilVerdict;
      delete artifacts.councilReports;
      return;
    }
    if (artifacts.councilVerdict && !this._checkpointValid(
      'councilVerdict',
      artifacts.councilVerdict,
      { cycle: cycle.number, planVersion: this.store.get().planVersion + 1 },
    )) {
      delete artifacts.councilVerdict;
      delete artifacts.councilReports;
    }
  }

  async _executeDecisionCouncil(cycle, runId, signal) {
    const state = this.store.get();
    const artifacts = cycle.artifacts ||= {};
    const advisorKeys = config.COUNCIL_ADVISOR_KEYS;
    const priorPlan = cycle.isFeedback ? state.currentPlan : null;
    const checkpoint = (container, key, task) => async (childSignal) => {
      const value = await task(childSignal);
      this._assertCurrent(runId, childSignal);
      container[key] = value;
      this.store.touch();
      this.store.snapshot();
      return value;
    };
    try {
      this._assertCurrent(runId, signal);
      this._revalidateDecisionCouncilArtifacts(cycle);

      if (!artifacts.decisionFrame) {
        this._setStage(cycle, 'framing', 0, runId);
        artifacts.decisionFrame = await this._invoke(
          'councilFramer',
          councilPrompts.frame({
            instruction: cycle.instruction,
            priorPlan,
            cycle: cycle.number,
          }),
          'decisionFrame',
          { cycle: cycle.number },
          runId,
          signal,
        );
        this.store.snapshot();
      }

      if (artifacts.decisionFrame.needsInput) {
        const nextVersion = state.planVersion + 1;
        state.currentPlan = {
          schemaVersion: 1,
          artifactType: 'council_clarification',
          cycle: cycle.number,
          planVersion: nextVersion,
          title: 'Council 판단 전 확인이 필요합니다',
          status: 'needs_input',
          planMarkdown: `## Neutral Decision Frame\n${artifacts.decisionFrame.decision}\n\n## Clarifying Question\n${artifacts.decisionFrame.clarifyingQuestion}`,
          requiredQuestions: [{
            id: `C${cycle.number}-Q1`,
            question: artifacts.decisionFrame.clarifyingQuestion,
            impact: '다섯 조언자가 구체적이고 비교 가능한 판단을 내리는 데 필요한 정보입니다.',
          }],
          optionalQuestions: [],
        };
        state.planVersion = nextVersion;
        state.phase = 'awaiting_input';
        state.round = 0;
        cycle.status = 'completed';
        cycle.stage = state.phase;
        cycle.completedAt = new Date().toISOString();
        state.lastError = null;
        state.currentEvaluation = {
          kind: 'council_protocol_gate',
          passed: true,
          gates: { neutralFrame: true, singleClarifyingQuestion: true },
          note: '확인 답변을 받은 뒤 독립 분석을 시작합니다.',
        };
        this.emit({
          type: 'checkpoint',
          role: 'orchestrator',
          message: 'Council 분석 전 확인 질문이 하나 필요합니다.',
          artifactType: 'council_clarification',
          artifact: state.currentPlan,
          runId,
        });
        state.runId = null;
        this.store.snapshot();
        return state.currentPlan;
      }

      artifacts.advisorAnalyses ||= {};
      const missingAdvisors = advisorKeys.filter((advisor) => !artifacts.advisorAnalyses[advisor]);
      if (missingAdvisors.length) {
        this._setStage(cycle, 'independent_analysis', 0, runId);
        const tasks = missingAdvisors.map((advisor) => checkpoint(
          artifacts.advisorAnalyses,
          advisor,
          (childSignal) => this._invoke(
            `councilAdvisor:${advisor}`,
            councilPrompts.analyze({
              frame: artifacts.decisionFrame,
              advisor,
              cycle: cycle.number,
            }),
            'advisorAnalysis',
            { cycle: cycle.number, advisor },
            runId,
            childSignal,
          ),
        ));
        await this._runPool(tasks, state.config.council.maxParallel, signal);
      }

      if (!artifacts.anonymizationMapping || !artifacts.anonymousResponses) {
        const shuffledAdvisors = shuffled(advisorKeys);
        const letters = ['A', 'B', 'C', 'D', 'E'];
        artifacts.anonymizationMapping = Object.fromEntries(
          letters.map((letter, index) => [letter, shuffledAdvisors[index]]),
        );
        artifacts.anonymousResponses = letters.map((letter) => anonymizeResponse(
          letter,
          artifacts.advisorAnalyses[artifacts.anonymizationMapping[letter]],
        ));
        this.store.snapshot();
      }

      artifacts.peerReviews ||= {};
      const missingReviewers = advisorKeys.filter((reviewer) => !artifacts.peerReviews[reviewer]);
      if (missingReviewers.length) {
        this._setStage(cycle, 'anonymous_peer_review', 1, runId);
        const tasks = missingReviewers.map((reviewer) => checkpoint(
          artifacts.peerReviews,
          reviewer,
          (childSignal) => this._invoke(
            `councilReviewer:${reviewer}`,
            councilPrompts.peerReview({
              frame: artifacts.decisionFrame,
              reviewer,
              anonymousResponses: artifacts.anonymousResponses,
              cycle: cycle.number,
            }),
            'peerReview',
            { cycle: cycle.number, reviewer },
            runId,
            childSignal,
          ),
        ));
        await this._runPool(tasks, state.config.council.maxParallel, signal);
      }

      if (!artifacts.councilVerdict) {
        this._setStage(cycle, 'chair_synthesis', 2, runId);
        const nextVersion = state.planVersion + 1;
        const deAnonymized = advisorKeys.map((advisor) => ({
          advisor,
          label: councilPrompts.ADVISORS[advisor].label,
          response: artifacts.advisorAnalyses[advisor],
        }));
        artifacts.councilVerdict = await this._invoke(
          'councilChair',
          councilPrompts.chair({
            frame: artifacts.decisionFrame,
            advisorResponses: deAnonymized,
            peerReviews: advisorKeys.map((reviewer) => artifacts.peerReviews[reviewer]),
            anonymizationMapping: artifacts.anonymizationMapping,
            planVersion: nextVersion,
            cycle: cycle.number,
          }),
          'councilVerdict',
          { cycle: cycle.number, planVersion: nextVersion },
          runId,
          signal,
        );
      }

      if (!artifacts.councilReports) {
        const generatedAt = new Date().toISOString();
        const advisorResponses = advisorKeys.map((advisor) => ({
          advisor,
          label: councilPrompts.ADVISORS[advisor].label,
          response: artifacts.advisorAnalyses[advisor],
        }));
        artifacts.councilReports = writeCouncilReport({
          dataDir: this.store.dataDir,
          sessionId: state.sessionKey,
          originalQuestion: cycle.instruction,
          frame: artifacts.decisionFrame,
          advisorResponses,
          anonymousResponses: artifacts.anonymousResponses,
          anonymizationMapping: artifacts.anonymizationMapping,
          peerReviews: advisorKeys.map((reviewer) => artifacts.peerReviews[reviewer]),
          verdict: artifacts.councilVerdict,
          routing: this.store.publicState().modelRouting,
          generatedAt,
        });
        state.councilReports = [...(state.councilReports || []), artifacts.councilReports].slice(-20);
        this.emit({
          type: 'artifact',
          role: 'orchestrator',
          message: 'Council HTML 보고서와 Markdown 트랜스크립트를 생성했습니다.',
          artifactType: 'council_reports',
          artifact: artifacts.councilReports,
          runId,
        });
      }

      this._assertCurrent(runId, signal);
      state.currentPlan = artifacts.councilVerdict;
      state.planVersion = artifacts.councilVerdict.planVersion;
      state.phase = 'awaiting_approval';
      state.round = 2;
      cycle.status = 'completed';
      cycle.stage = state.phase;
      cycle.completedAt = new Date().toISOString();
      state.lastError = null;
      state.currentEvaluation = this._councilProtocolEvaluation(cycle);
      this.emit({
        type: 'checkpoint',
        role: 'orchestrator',
        message: `Council verdict v${state.planVersion}: 승인할 수 있습니다.`,
        artifactType: 'council_verdict',
        artifact: artifacts.councilVerdict,
        runId,
      });
      this.emit({
        type: 'evaluation',
        role: 'system',
        message: '5관점 Council 프로토콜 게이트 평가 완료',
        evaluation: state.currentEvaluation,
        runId,
      });
      state.runId = null;
      this.store.snapshot();
      return artifacts.councilVerdict;
    } catch (error) {
      if (error.name === 'AbortError') {
        if (state.runId === runId) {
          state.phase = 'cancelled';
          cycle.status = 'cancelled';
          cycle.completedAt = new Date().toISOString();
          state.runId = null;
          this.store.snapshot();
        }
        return null;
      }
      if (state.runId !== runId) return null;
      state.phase = 'failed';
      cycle.status = 'failed';
      state.lastError = {
        stage: cycle.stage,
        role: error.role || 'system',
        retryable: true,
        message: String(error.message || error).slice(0, 2_000),
        at: new Date().toISOString(),
      };
      this.emit({ type: 'error', role: 'system', message: state.lastError.message, runId });
      state.runId = null;
      this.store.snapshot();
      return null;
    }
  }

  async _execute(cycle, runId, signal) {
    const state = this.store.get();
    if (!cycle.artifacts || typeof cycle.artifacts !== 'object' || Array.isArray(cycle.artifacts)) {
      cycle.artifacts = {};
    }
    const artifacts = cycle.artifacts;
    const checkpointTask = (key, task) => async (childSignal) => {
      const value = await task(childSignal);
      this._assertCurrent(runId, childSignal);
      artifacts[key] = value;
      this.store.touch();
      this.store.snapshot();
      return value;
    };
    try {
      this._assertCurrent(runId, signal);
      this._revalidateCheckpointArtifacts(cycle);
      if (artifacts.harnessSet && cycle.harnessRevision !== state.harnessRevision) {
        // A user edit after a failed/cancelled run invalidates every artifact produced
        // under the previously pinned harness revision.
        for (const key of Object.keys(artifacts)) delete artifacts[key];
        cycle.harnessRevision = null;
      }

      if (!artifacts.harnessSet) {
        this._setStage(cycle, 'harnessing', 0, runId);
        const designedHarnesses = await this._invoke(
          'orchestrator',
          prompts.designHarnesses({
            instruction: cycle.instruction,
            isFeedback: cycle.isFeedback,
            priorPlan: cycle.isFeedback ? state.currentPlan : null,
            previousHarnesses: state.harnesses,
            cycle: cycle.number,
          }),
          'harnessSet', { cycle: cycle.number, deferArtifactEvent: true }, runId, signal,
        );
        artifacts.harnessSet = designedHarnesses;
        const harnessState = this.store.replaceHarnesses(designedHarnesses, {
          source: 'orchestrator', cycle: cycle.number, requireAll: true,
        });
        artifacts.harnessSet = JSON.parse(JSON.stringify(state.harnesses));
        cycle.harnessRevision = harnessState.revision;
        this.emit({
          type: 'artifact', role: 'orchestrator',
          message: 'Orchestrator instruction harnesses ready.',
          artifactType: 'harness_set', artifact: artifacts.harnessSet, runId,
        });
        this.emit({
          type: 'config', role: 'orchestrator',
          message: `Instruction harnesses prepared at revision ${cycle.harnessRevision}.`,
          artifactType: 'harness_set', runId,
        });
      }

      const activeHarnesses = artifacts.harnessSet;
      if (cycle.harnessRevision !== state.harnessRevision) {
        const error = new Error('The active harness revision changed before dispatch. Retry the cycle.');
        error.status = 409;
        throw error;
      }

      if (!artifacts.taskPackage) {
        this._setStage(cycle, 'dispatching', 0, runId);
        artifacts.taskPackage = await this._invoke(
          'orchestrator',
          prompts.dispatch({
            instruction: cycle.instruction,
            isFeedback: cycle.isFeedback,
            priorPlan: cycle.isFeedback ? state.currentPlan : null,
            cycle: cycle.number,
            harness: activeHarnesses.orchestrator,
          }),
          'taskPackage', { cycle: cycle.number, harness: activeHarnesses.orchestrator }, runId, signal,
        );
      }

      if (!artifacts.claudeDraft || !artifacts.codexDraft) {
        this._setStage(cycle, 'drafting', 0, runId);
        const tasks = [];
        const keys = [];
        if (!artifacts.claudeDraft) {
          keys.push('claudeDraft');
          tasks.push(checkpointTask('claudeDraft', (childSignal) => this._invoke(
            'claudeWorker', prompts.draft({
              taskPackage: artifacts.taskPackage, author: 'claude', harness: activeHarnesses.claudeWorker,
            }),
            'draft', { author: 'claude', harness: activeHarnesses.claudeWorker }, runId, childSignal,
          )));
        }
        if (!artifacts.codexDraft) {
          keys.push('codexDraft');
          tasks.push(checkpointTask('codexDraft', (childSignal) => this._invoke(
            'codexWorker', prompts.draft({
              taskPackage: artifacts.taskPackage, author: 'codex', harness: activeHarnesses.codexWorker,
            }),
            'draft', { author: 'codex', harness: activeHarnesses.codexWorker }, runId, childSignal,
          )));
        }
        const values = await this._runPair(tasks, signal);
        keys.forEach((key, index) => { artifacts[key] = values[index]; });
        this.store.snapshot();
      }

      if (!artifacts.claudeCritique || !artifacts.codexCritique) {
        this._setStage(cycle, 'critiquing', 1, runId);
        const tasks = [];
        const keys = [];
        if (!artifacts.claudeCritique) {
          keys.push('claudeCritique');
          tasks.push(checkpointTask('claudeCritique', (childSignal) => this._invoke(
            'claudeWorker', prompts.critique({
              taskPackage: artifacts.taskPackage, otherDraft: artifacts.codexDraft,
              reviewer: 'claude', subjectAuthor: 'codex', harness: activeHarnesses.claudeWorker,
            }),
            'critique', {
              reviewer: 'claude', subjectAuthor: 'codex', harness: activeHarnesses.claudeWorker,
            }, runId, childSignal,
          )));
        }
        if (!artifacts.codexCritique) {
          keys.push('codexCritique');
          tasks.push(checkpointTask('codexCritique', (childSignal) => this._invoke(
            'codexWorker', prompts.critique({
              taskPackage: artifacts.taskPackage, otherDraft: artifacts.claudeDraft,
              reviewer: 'codex', subjectAuthor: 'claude', harness: activeHarnesses.codexWorker,
            }),
            'critique', {
              reviewer: 'codex', subjectAuthor: 'claude', harness: activeHarnesses.codexWorker,
            }, runId, childSignal,
          )));
        }
        const values = await this._runPair(tasks, signal);
        keys.forEach((key, index) => { artifacts[key] = values[index]; });
        this.store.snapshot();
      }

      artifacts.convergedAtR1 = convergenceReached(artifacts.claudeCritique, artifacts.codexCritique);
      if (!artifacts.convergedAtR1 && (!artifacts.claudeRevision || !artifacts.codexRevision)) {
        this._setStage(cycle, 'revising', 2, runId);
        const tasks = [];
        const keys = [];
        if (!artifacts.claudeRevision) {
          keys.push('claudeRevision');
          tasks.push(checkpointTask('claudeRevision', (childSignal) => this._invoke(
            'claudeWorker', prompts.revise({
              taskPackage: artifacts.taskPackage, ownDraft: artifacts.claudeDraft,
              receivedCritique: artifacts.codexCritique, author: 'claude', harness: activeHarnesses.claudeWorker,
            }),
            'revision', { author: 'claude', harness: activeHarnesses.claudeWorker }, runId, childSignal,
          )));
        }
        if (!artifacts.codexRevision) {
          keys.push('codexRevision');
          tasks.push(checkpointTask('codexRevision', (childSignal) => this._invoke(
            'codexWorker', prompts.revise({
              taskPackage: artifacts.taskPackage, ownDraft: artifacts.codexDraft,
              receivedCritique: artifacts.claudeCritique, author: 'codex', harness: activeHarnesses.codexWorker,
            }),
            'revision', { author: 'codex', harness: activeHarnesses.codexWorker }, runId, childSignal,
          )));
        }
        const values = await this._runPair(tasks, signal);
        keys.forEach((key, index) => { artifacts[key] = values[index]; });
        this.store.snapshot();
      } else if (artifacts.convergedAtR1) {
        this.emit({ type: 'status', role: 'system', message: '양쪽 비평이 수렴하여 R2 개정을 생략합니다.', round: 1, runId });
      }

      if (!artifacts.synthesis) {
        this._setStage(cycle, 'synthesizing', artifacts.convergedAtR1 ? 1 : 2, runId);
        const nextVersion = state.planVersion + 1;
        artifacts.synthesis = await this._invoke(
          'orchestrator',
          prompts.synthesize({
            taskPackage: artifacts.taskPackage,
            claudePlan: artifacts.claudeRevision || artifacts.claudeDraft,
            codexPlan: artifacts.codexRevision || artifacts.codexDraft,
            claudeCritique: artifacts.claudeCritique,
            codexCritique: artifacts.codexCritique,
            priorPlan: cycle.isFeedback ? state.currentPlan : null,
            instruction: cycle.instruction,
            planVersion: nextVersion,
            harness: activeHarnesses.orchestrator,
          }),
          'synthesis', {
            planVersion: nextVersion,
            taskPackage: artifacts.taskPackage,
            isFeedback: cycle.isFeedback,
            priorPlan: cycle.isFeedback ? state.currentPlan : null,
            harness: activeHarnesses.orchestrator,
            instruction: cycle.instruction,
            requiredFeedbackIds: feedbackIdsFromCycles(state.cycles, cycle.number),
          }, runId, signal,
        );
      }

      this._assertCurrent(runId, signal);
      state.currentPlan = artifacts.synthesis;
      state.planVersion = artifacts.synthesis.planVersion;
      state.phase = artifacts.synthesis.status === 'needs_input' ? 'awaiting_input' : 'awaiting_approval';
      state.round = artifacts.convergedAtR1 ? 1 : 2;
      cycle.status = 'completed';
      cycle.stage = state.phase;
      cycle.completedAt = new Date().toISOString();
      state.lastError = null;
      state.currentEvaluation = this._protocolEvaluation(cycle);
      this.emit({
        type: 'checkpoint', role: 'orchestrator',
        message: artifacts.synthesis.status === 'needs_input'
          ? `통합 기획안 v${state.planVersion}: 필수 확인이 필요합니다.`
          : `통합 기획안 v${state.planVersion}: 승인할 수 있습니다.`,
        artifactType: 'synthesis', artifact: artifacts.synthesis, runId,
      });
      this.emit({
        type: 'evaluation', role: 'system', message: '프로토콜 자동 게이트 평가 완료',
        evaluation: state.currentEvaluation, runId,
      });
      state.runId = null;
      this.store.touch();
      this.store.snapshot();
      return artifacts.synthesis;
    } catch (error) {
      if (error.name === 'AbortError') {
        if (state.runId === runId) {
          state.phase = 'cancelled';
          cycle.status = 'cancelled';
          cycle.completedAt = new Date().toISOString();
          state.runId = null;
          this.store.snapshot();
        }
        return null;
      }
      if (state.runId !== runId) return null;
      state.phase = 'failed';
      cycle.status = 'failed';
      state.lastError = {
        stage: cycle.stage,
        role: error.role || 'system',
        retryable: true,
        message: String(error.message || error).slice(0, 2_000),
        at: new Date().toISOString(),
      };
      this.emit({ type: 'error', role: 'system', message: state.lastError.message, runId });
      state.runId = null;
      this.store.snapshot();
      return null;
    }
  }

  _protocolEvaluation(cycle) {
    const state = this.store.get();
    const artifacts = cycle.artifacts;
    const sessions = Object.values(state.sessions);
    const gates = {
      structuredArtifacts: Boolean(
        artifacts.harnessSet && artifacts.taskPackage && artifacts.claudeDraft && artifacts.codexDraft
        && artifacts.claudeCritique && artifacts.codexCritique && artifacts.synthesis,
      ),
      harnessRevisionPinned: Number.isInteger(cycle.harnessRevision)
        && cycle.harnessRevision === state.harnessRevision
        && artifacts.harnessSet?.cycle === cycle.number,
      reviewerNotAuthor: artifacts.claudeCritique?.reviewer === 'claude'
        && artifacts.claudeCritique?.subjectAuthor === 'codex'
        && artifacts.codexCritique?.reviewer === 'codex'
        && artifacts.codexCritique?.subjectAuthor === 'claude',
      roleSessionsSeparated: sessions.every(Boolean) && new Set(sessions).size === 3,
      maxThreeRounds: state.round <= config.loop.maxRounds - 1,
      requiredQuestionGate: artifacts.synthesis.status === (
        artifacts.synthesis.requiredQuestions.length ? 'needs_input' : 'ready_for_approval'
      ),
      bothWorkersIntegrated: artifacts.synthesis.integration.acceptedFromClaude.length > 0
        && artifacts.synthesis.integration.acceptedFromCodex.length > 0,
      hiddenReasoningAbsent: !state.transcript.some((event) => ['thinking', 'reasoning', 'chain_of_thought'].includes(event.type)),
    };
    return {
      kind: 'protocol_gate',
      passed: Object.values(gates).every(Boolean),
      gates,
      qualityScore: null,
      note: '의미 품질 점수는 독립 평가 하네스에서 별도로 산정합니다.',
    };
  }

  _councilProtocolEvaluation(cycle) {
    const state = this.store.get();
    const artifacts = cycle.artifacts || {};
    const advisorKeys = config.COUNCIL_ADVISOR_KEYS;
    const mapping = artifacts.anonymizationMapping || {};
    const auditRoles = new Set((state.sessionAudit || [])
      .filter((entry) => Number(entry.cycle) === Number(cycle.number))
      .map((entry) => entry.role));
    const gates = {
      neutralDecisionFrame: Boolean(artifacts.decisionFrame && !artifacts.decisionFrame.needsInput),
      fiveIndependentAnalyses: advisorKeys.every((advisor) => (
        artifacts.advisorAnalyses?.[advisor]?.advisor === advisor
      )),
      anonymousMappingComplete: validateAnonymousBundle({
        mapping,
        responses: artifacts.anonymousResponses,
        advisorAnalyses: artifacts.advisorAnalyses,
        advisorKeys,
      }).length === 0,
      fivePeerReviews: advisorKeys.every((reviewer) => (
        artifacts.peerReviews?.[reviewer]?.reviewer === reviewer
      )),
      chairmanSynthesis: artifacts.councilVerdict?.artifactType === 'council_verdict',
      roleRoutesAudited: auditRoles.has('councilFramer')
        && auditRoles.has('councilChair')
        && advisorKeys.every((advisor) => (
          auditRoles.has(`councilAdvisor:${advisor}`)
          && auditRoles.has(`councilReviewer:${advisor}`)
        )),
      reportsGenerated: Boolean(
        artifacts.councilReports?.html?.name && artifacts.councilReports?.transcript?.name,
      ),
      hiddenReasoningAbsent: !state.transcript.some((event) => (
        ['thinking', 'reasoning', 'chain_of_thought'].includes(event.type)
      )),
    };
    return {
      kind: 'council_protocol_gate',
      passed: Object.values(gates).every(Boolean),
      gates,
      fallbackCount: (state.sessionAudit || []).filter((entry) => (
        Number(entry.cycle) === Number(cycle.number) && Number(entry.routeIndex) > 0
      )).length,
      note: '다섯 독립 관점, 익명화, 동료평가, 의장 종합, 보고서 생성을 검증합니다.',
    };
  }
}

const singleton = new PlanningEngine();

module.exports = singleton;
module.exports.PlanningEngine = PlanningEngine;
module.exports.convergenceReached = convergenceReached;
module.exports.semanticErrors = semanticErrors;
