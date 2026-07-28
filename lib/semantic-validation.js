'use strict';

// 스키마(JSON Schema)로는 표현할 수 없는 아티팩트 간 의미 규칙을 검증한다.
// 예) cycle 번호 일치, reviewer≠author, 요구사항 추적성, 피드백 반영 유지.

const { identityLeaks } = require('./council-anonymity');

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

module.exports = {
  instructionMentionsMetric,
  semanticErrors,
};
