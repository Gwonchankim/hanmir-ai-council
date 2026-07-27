'use strict';

const rubric = require('./rubric.json');

function round(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function criterionIndex(selectedRubric = rubric) {
  const index = new Map();
  for (const category of selectedRubric.categories) {
    for (const criterion of category.criteria) {
      index.set(criterion.id, { ...criterion, categoryId: category.id, categoryName: category.name });
    }
  }
  return index;
}

function validateRubric(selectedRubric = rubric) {
  const categoryWeight = selectedRubric.categories.reduce((sum, category) => sum + category.weight, 0);
  if (categoryWeight !== 100) throw new Error(`루브릭 영역 배점 합계가 100이 아니다: ${categoryWeight}`);
  const ids = new Set();
  for (const category of selectedRubric.categories) {
    const criteriaWeight = category.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
    if (criteriaWeight !== category.weight) throw new Error(`${category.id} 세부 배점 합계가 영역 배점과 다르다.`);
    for (const criterion of category.criteria) {
      if (ids.has(criterion.id)) throw new Error(`중복 criterion ID: ${criterion.id}`);
      ids.add(criterion.id);
    }
  }
  const gateIds = new Set();
  for (const gate of selectedRubric.criticalGates) {
    if (gateIds.has(gate.id)) throw new Error(`중복 gate ID: ${gate.id}`);
    gateIds.add(gate.id);
  }
  return true;
}

function validateScores(scores, selectedRubric = rubric) {
  if (!scores || typeof scores !== 'object' || Array.isArray(scores)) throw new TypeError('scores는 criterion ID별 객체여야 한다.');
  const index = criterionIndex(selectedRubric);
  const provided = Object.keys(scores);
  const missing = [...index.keys()].filter((id) => !Object.prototype.hasOwnProperty.call(scores, id));
  const extra = provided.filter((id) => !index.has(id));
  if (missing.length) throw new Error(`누락된 평가항목: ${missing.join(', ')}`);
  if (extra.length) throw new Error(`알 수 없는 평가항목: ${extra.join(', ')}`);
  const anchors = new Set(selectedRubric.anchors.map((anchor) => anchor.value));
  for (const [id, entry] of Object.entries(scores)) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new TypeError(`${id}: 점수 입력은 객체여야 한다.`);
    if (!anchors.has(entry.anchor)) throw new Error(`${id}: 허용되지 않은 anchor ${entry.anchor}`);
    if (typeof entry.finding !== 'string' || entry.finding.trim() === '') throw new Error(`${id}: finding이 필요하다.`);
    if (!Array.isArray(entry.evidence)) throw new Error(`${id}: evidence 배열이 필요하다.`);
    if (entry.anchor > 0 && !entry.evidence.some((item) => typeof item === 'string' && item.trim() !== '')) {
      throw new Error(`${id}: 0보다 큰 점수에는 구체적 evidence가 필요하다.`);
    }
  }
}

function validateGateResults(gateResults, selectedRubric = rubric) {
  if (!Array.isArray(gateResults)) throw new TypeError('gateResults는 배열이어야 한다.');
  const expected = new Map(selectedRubric.criticalGates.map((gate) => [gate.id, gate]));
  const actual = new Map();
  for (const gate of gateResults) {
    if (!gate || !expected.has(gate.id)) throw new Error(`알 수 없는 치명 게이트: ${gate && gate.id}`);
    if (actual.has(gate.id)) throw new Error(`중복 치명 게이트 결과: ${gate.id}`);
    if (typeof gate.passed !== 'boolean') throw new Error(`${gate.id}: passed는 boolean이어야 한다.`);
    if (!Array.isArray(gate.evidence) || !gate.evidence.some((item) => typeof item === 'string' && item.trim() !== '')) {
      throw new Error(`${gate.id}: 판정 증거가 필요하다.`);
    }
    actual.set(gate.id, gate);
  }
  const missing = [...expected.keys()].filter((id) => !actual.has(id));
  if (missing.length) throw new Error(`누락된 치명 게이트 결과: ${missing.join(', ')}`);
}

function scoreEvaluation({ scores, gateResults, metadata = {} }, selectedRubric = rubric) {
  validateRubric(selectedRubric);
  validateScores(scores, selectedRubric);
  validateGateResults(gateResults, selectedRubric);

  const index = criterionIndex(selectedRubric);
  const criterionResults = [];
  const categories = selectedRubric.categories.map((category) => ({
    id: category.id,
    name: category.name,
    score: 0,
    maximum: category.weight,
    ratio: 0,
  }));
  const categoryById = new Map(categories.map((category) => [category.id, category]));

  for (const [id, criterion] of index) {
    const input = scores[id];
    const weightedScore = round(criterion.weight * input.anchor);
    criterionResults.push({
      id,
      categoryId: criterion.categoryId,
      name: criterion.name,
      weight: criterion.weight,
      anchor: input.anchor,
      score: weightedScore,
      finding: input.finding.trim(),
      evidence: input.evidence.filter((item) => typeof item === 'string' && item.trim() !== '').map((item) => item.trim()),
    });
    categoryById.get(criterion.categoryId).score += weightedScore;
  }

  for (const category of categories) {
    category.score = round(category.score);
    category.ratio = round(category.score / category.maximum);
  }
  const total = round(categories.reduce((sum, category) => sum + category.score, 0));
  const policy = selectedRubric.passPolicy;
  const gateFailures = gateResults.filter((gate) => !gate.passed).map((gate) => gate.id);
  const categoryFloorFailures = Object.entries(policy.categoryMinimumRatios)
    .filter(([id, minimum]) => !categoryById.has(id) || categoryById.get(id).ratio < minimum)
    .map(([id]) => id);
  const criterionFloorFailures = criterionResults
    .filter((criterion) => criterion.anchor < policy.minimumCriterionAnchor)
    .map((criterion) => criterion.id);
  const reasons = [];
  if (gateFailures.length) reasons.push(`치명 게이트 실패: ${gateFailures.join(', ')}`);
  if (total < policy.minimumTotal) reasons.push(`총점 ${total} < ${policy.minimumTotal}`);
  if (categoryFloorFailures.length) reasons.push(`핵심 영역 최저비율 미달: ${categoryFloorFailures.join(', ')}`);
  if (criterionFloorFailures.length) reasons.push(`개별 anchor ${policy.minimumCriterionAnchor} 미만: ${criterionFloorFailures.join(', ')}`);

  return {
    rubricId: selectedRubric.id,
    rubricVersion: selectedRubric.version,
    generatedAt: new Date().toISOString(),
    metadata,
    passPolicy: policy,
    total,
    maximum: 100,
    passed: reasons.length === 0,
    decision: reasons.length === 0 ? 'PASS' : 'FAIL',
    reasons,
    gates: gateResults,
    categories,
    criteria: criterionResults,
  };
}

module.exports = {
  rubric,
  criterionIndex,
  validateRubric,
  validateScores,
  validateGateResults,
  scoreEvaluation,
};
