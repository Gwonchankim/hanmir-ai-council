'use strict';

// 5관점 Decision Council 실행 흐름.
// 중립 프레이밍 → 다섯 독립 분석 → 익명화 → 동료평가 → 의장 종합 → 보고서.
// PlanningEngine 인스턴스를 첫 인자(engine)로 받아 호출 원시연산을 위임한다.

const config = require('../config');
const councilPrompts = require('../agents/council-prompts');
const { anonymizeResponse, validateAnonymousBundle } = require('./council-anonymity');
const { writeCouncilReport } = require('./council-report');
const { shuffled } = require('./engine-support');

// 재개(resume) 시 남아 있는 아티팩트 중 더 이상 유효하지 않은 것을 버린다.
// 상류가 무효화되면 하류도 함께 폐기해야 일관성이 유지된다.
function revalidateDecisionCouncilArtifacts(engine, cycle) {
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
  if (artifacts.decisionFrame && !engine._checkpointValid(
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
    if (artifacts.advisorAnalyses[advisor] && !engine._checkpointValid(
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
    if (artifacts.peerReviews[reviewer] && !engine._checkpointValid(
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
  if (artifacts.councilVerdict && !engine._checkpointValid(
    'councilVerdict',
    artifacts.councilVerdict,
    { cycle: cycle.number, planVersion: engine.store.get().planVersion + 1 },
  )) {
    delete artifacts.councilVerdict;
    delete artifacts.councilReports;
  }
}

async function executeDecisionCouncil(engine, cycle, runId, signal) {
  const state = engine.store.get();
  const artifacts = cycle.artifacts ||= {};
  const advisorKeys = config.COUNCIL_ADVISOR_KEYS;
  const priorPlan = cycle.isFeedback ? state.currentPlan : null;
  const checkpoint = (container, key, task) => async (childSignal) => {
    const value = await task(childSignal);
    engine._assertCurrent(runId, childSignal);
    container[key] = value;
    engine.store.touch();
    engine.store.snapshot();
    return value;
  };
  try {
    engine._assertCurrent(runId, signal);
    revalidateDecisionCouncilArtifacts(engine, cycle);

    if (!artifacts.decisionFrame) {
      engine._setStage(cycle, 'framing', 0, runId);
      artifacts.decisionFrame = await engine._invoke(
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
      engine.store.snapshot();
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
      engine.emit({
        type: 'checkpoint',
        role: 'orchestrator',
        message: 'Council 분석 전 확인 질문이 하나 필요합니다.',
        artifactType: 'council_clarification',
        artifact: state.currentPlan,
        runId,
      });
      state.runId = null;
      engine.store.snapshot();
      return state.currentPlan;
    }

    artifacts.advisorAnalyses ||= {};
    const missingAdvisors = advisorKeys.filter((advisor) => !artifacts.advisorAnalyses[advisor]);
    if (missingAdvisors.length) {
      engine._setStage(cycle, 'independent_analysis', 0, runId);
      const tasks = missingAdvisors.map((advisor) => checkpoint(
        artifacts.advisorAnalyses,
        advisor,
        (childSignal) => engine._invoke(
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
      await engine._runPool(tasks, state.config.council.maxParallel, signal);
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
      engine.store.snapshot();
    }

    artifacts.peerReviews ||= {};
    const missingReviewers = advisorKeys.filter((reviewer) => !artifacts.peerReviews[reviewer]);
    if (missingReviewers.length) {
      engine._setStage(cycle, 'anonymous_peer_review', 1, runId);
      const tasks = missingReviewers.map((reviewer) => checkpoint(
        artifacts.peerReviews,
        reviewer,
        (childSignal) => engine._invoke(
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
      await engine._runPool(tasks, state.config.council.maxParallel, signal);
    }

    if (!artifacts.councilVerdict) {
      engine._setStage(cycle, 'chair_synthesis', 2, runId);
      const nextVersion = state.planVersion + 1;
      const deAnonymized = advisorKeys.map((advisor) => ({
        advisor,
        label: councilPrompts.ADVISORS[advisor].label,
        response: artifacts.advisorAnalyses[advisor],
      }));
      artifacts.councilVerdict = await engine._invoke(
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
        dataDir: engine.store.dataDir,
        sessionId: state.sessionKey,
        originalQuestion: cycle.instruction,
        frame: artifacts.decisionFrame,
        advisorResponses,
        anonymousResponses: artifacts.anonymousResponses,
        anonymizationMapping: artifacts.anonymizationMapping,
        peerReviews: advisorKeys.map((reviewer) => artifacts.peerReviews[reviewer]),
        verdict: artifacts.councilVerdict,
        routing: engine.store.publicState().modelRouting,
        generatedAt,
      });
      state.councilReports = [...(state.councilReports || []), artifacts.councilReports].slice(-20);
      engine.emit({
        type: 'artifact',
        role: 'orchestrator',
        message: 'Council HTML 보고서와 Markdown 트랜스크립트를 생성했습니다.',
        artifactType: 'council_reports',
        artifact: artifacts.councilReports,
        runId,
      });
    }

    engine._assertCurrent(runId, signal);
    state.currentPlan = artifacts.councilVerdict;
    state.planVersion = artifacts.councilVerdict.planVersion;
    state.phase = 'awaiting_approval';
    state.round = 2;
    cycle.status = 'completed';
    cycle.stage = state.phase;
    cycle.completedAt = new Date().toISOString();
    state.lastError = null;
    state.currentEvaluation = councilProtocolEvaluation(engine, cycle);
    engine.emit({
      type: 'checkpoint',
      role: 'orchestrator',
      message: `Council verdict v${state.planVersion}: 승인할 수 있습니다.`,
      artifactType: 'council_verdict',
      artifact: artifacts.councilVerdict,
      runId,
    });
    engine.emit({
      type: 'evaluation',
      role: 'system',
      message: '5관점 Council 프로토콜 게이트 평가 완료',
      evaluation: state.currentEvaluation,
      runId,
    });
    state.runId = null;
    engine.store.snapshot();
    return artifacts.councilVerdict;
  } catch (error) {
    if (error.name === 'AbortError') {
      if (state.runId === runId) {
        state.phase = 'cancelled';
        cycle.status = 'cancelled';
        cycle.completedAt = new Date().toISOString();
        state.runId = null;
        engine.store.snapshot();
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
    engine.emit({ type: 'error', role: 'system', message: state.lastError.message, runId });
    state.runId = null;
    engine.store.snapshot();
    return null;
  }
}

// Council 프로토콜이 실제로 지켜졌는지 사후 검증하는 게이트.
function councilProtocolEvaluation(engine, cycle) {
  const state = engine.store.get();
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

module.exports = {
  councilProtocolEvaluation,
  executeDecisionCouncil,
  revalidateDecisionCouncilArtifacts,
};
