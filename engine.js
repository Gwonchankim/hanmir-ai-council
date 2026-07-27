'use strict';

const crypto = require('crypto');
const config = require('./config');
const defaultStore = require('./state');
const prompts = require('./agents/prompts');
const { callBrain: defaultBrainCaller } = require('./agents/brain');
const { schemaFor, parseStructured, validateArtifact } = require('./schemas');
const { roleToMarkdown } = require('./harnesses');

const ROLE_META = Object.freeze({
  orchestrator: { provider: null, eventRole: 'orchestrator', label: 'Orchestrator' },
  claudeWorker: { provider: 'claude', eventRole: 'claude', label: 'Claude 워커' },
  codexWorker: { provider: 'codex', eventRole: 'codex', label: 'ChatGPT 워커' },
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
  if (roleKey === 'orchestrator') {
    return {
      brain: state.config.orchestrator.brain,
      model: state.config.orchestrator.model,
      effort: state.config.orchestrator.effort,
    };
  }
  if (roleKey === 'claudeWorker') {
    return { brain: 'claude', ...state.config.claudeWorker };
  }
  if (roleKey === 'codexWorker') {
    return { brain: 'codex', ...state.config.codexWorker };
  }
  throw new Error(`알 수 없는 역할: ${roleKey}`);
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
    const role = ROLE_META[roleKey];
    const selected = this._roleConfig(roleKey);
    this.emit({
      type: 'status', role: role.eventRole,
      message: `${role.label} · ${selected.model} · effort ${selected.effort} 시작`,
      artifactType, runId,
    });

    let latestText = '';
    let validation = null;
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
      const previousSession = state.sessions[roleKey];
      const result = await this.brainCaller({
        ...selected,
        prompt: callPrompt,
        session: state.sessions[roleKey],
        schema: schemaFor(artifactType),
        signal,
        // 어댑터의 공개 가능한 진행 이벤트만 허용하며 본문/추론 청크는 중계하지 않는다.
        onEvent: (kind, content) => {
          if (kind === 'status' && content) {
            this.emit({ type: 'status', role: role.eventRole, message: String(content).slice(0, 500), artifactType, runId });
          }
        },
      });
      this._assertCurrent(runId, signal);
      if (!result?.session) throw new Error(`${role.label}가 세션 ID를 반환하지 않았습니다.`);
      this.store.recordSessionInvocation({
        role: roleKey,
        artifactType,
        attempt,
        previousSession,
        returnedSession: result.session,
        execution: result.execution,
        promptBinding,
      });
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
              message: `${role.label}의 ${artifactType} 완료`,
              artifactType, artifact, runId,
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
    const error = new Error(`${role.label}의 ${artifactType} 구조 검증에 실패했습니다: ${validation.map((item) => `${item.path} ${item.message}`).join('; ')}`);
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
    const promise = this._execute(cycle, runId, controller.signal)
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
}

const singleton = new PlanningEngine();

module.exports = singleton;
module.exports.PlanningEngine = PlanningEngine;
module.exports.convergenceReached = convergenceReached;
module.exports.semanticErrors = semanticErrors;
