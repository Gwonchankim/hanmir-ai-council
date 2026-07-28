'use strict';

const crypto = require('crypto');
const config = require('./config');
const defaultStore = require('./state');
const prompts = require('./agents/prompts');
const { callBrain: defaultBrainCaller } = require('./agents/brain');
const { schemaFor, parseStructured, validateArtifact } = require('./schemas');
const { roleToMarkdown } = require('./harnesses');
const {
  activeCircuit,
  classifyFallbackError,
  isFallbackEligible,
  publicRoute,
  routeChain,
  routeKey,
} = require('./lib/model-router');

const {
  abortError,
  assertPromptWithinLimit,
  convergenceReached,
  feedbackIdsFromCycles,
  providerConfig,
  roleMeta,
} = require('./lib/engine-support');
const { semanticErrors } = require('./lib/semantic-validation');
const {
  councilProtocolEvaluation,
  executeDecisionCouncil,
  revalidateDecisionCouncilArtifacts,
} = require('./lib/council-flow');

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
    return revalidateDecisionCouncilArtifacts(this, cycle);
  }

  _executeDecisionCouncil(cycle, runId, signal) {
    return executeDecisionCouncil(this, cycle, runId, signal);
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
    return councilProtocolEvaluation(this, cycle);
  }
}

const singleton = new PlanningEngine();

module.exports = singleton;
module.exports.PlanningEngine = PlanningEngine;
module.exports.convergenceReached = convergenceReached;
module.exports.semanticErrors = semanticErrors;
