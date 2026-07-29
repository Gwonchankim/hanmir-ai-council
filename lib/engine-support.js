'use strict';

// PlanningEngine이 쓰는 상태 없는 보조 함수 모음.
// 엔진 인스턴스에 의존하지 않으므로 단독 테스트가 가능하다.

const crypto = require('crypto');
const config = require('../config');

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

module.exports = {
  ROLE_META,
  abortError,
  assertPromptWithinLimit,
  convergenceReached,
  feedbackIdsFromCycles,
  providerConfig,
  roleMeta,
  shuffled,
};
