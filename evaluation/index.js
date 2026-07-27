'use strict';

const rubric = require('./rubric.json');
const canonicalScenario = require('./canonical-hm-thermashield.json');
const scenarios = require('./scenarios.json');
const { evaluateEvidence } = require('./evidence-gates');
const { scoreEvaluation } = require('./scorer');
const { toMarkdown, writeReports } = require('./report');

function normalizeManualGates(manualGates) {
  const expected = rubric.criticalGates.filter((gate) => gate.mode === 'evaluator');
  if (!manualGates || typeof manualGates !== 'object' || Array.isArray(manualGates)) {
    throw new TypeError('평가자 판정이 필요한 manualGates 객체가 필요하다.');
  }
  const known = new Set(expected.map((gate) => gate.id));
  const extra = Object.keys(manualGates).filter((id) => !known.has(id));
  if (extra.length) throw new Error(`알 수 없는 수동 치명 게이트: ${extra.join(', ')}`);
  return expected.map((definition) => {
    const gate = manualGates[definition.id];
    if (!gate || typeof gate.passed !== 'boolean') throw new Error(`${definition.id}: 평가자의 boolean 판정이 필요하다.`);
    if (!Array.isArray(gate.evidence) || !gate.evidence.some((item) => typeof item === 'string' && item.trim() !== '')) {
      throw new Error(`${definition.id}: 평가자 판정 증거가 필요하다.`);
    }
    return {
      id: definition.id,
      passed: gate.passed,
      evidence: gate.evidence.map(String),
      failures: gate.passed ? [] : (Array.isArray(gate.failures) && gate.failures.length ? gate.failures.map(String) : ['평가자가 치명 결함으로 판정했다.']),
    };
  });
}

function runEvaluation({ evidenceBundle, scores, manualGates, metadata = {} }) {
  const deterministic = evaluateEvidence(evidenceBundle);
  const evaluatorGates = normalizeManualGates(manualGates);
  return scoreEvaluation({
    scores,
    gateResults: [...deterministic.gates, ...evaluatorGates],
    metadata: {
      scenarioId: evidenceBundle.scenarioId || canonicalScenario.id,
      ...metadata,
    },
  });
}

module.exports = {
  rubric,
  canonicalScenario,
  scenarios,
  evaluateEvidence,
  runEvaluation,
  scoreEvaluation,
  toMarkdown,
  writeReports,
};
