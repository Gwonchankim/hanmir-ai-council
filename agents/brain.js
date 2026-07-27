'use strict';

const { runClaude } = require('../adapters/claude');
const { runCodex } = require('../adapters/codex');

function appendSchemaContract(prompt, schema) {
  if (!schema) return prompt;
  return [
    prompt,
    '',
    '[OUTPUT_JSON_SCHEMA_BEGIN]',
    JSON.stringify(schema),
    '[OUTPUT_JSON_SCHEMA_END]',
    '위 스키마를 만족하는 JSON 객체 하나만 출력하라.',
  ].join('\n');
}

/**
 * 역할과 공급자에 무관한 단일 호출 인터페이스.
 * 내부 reasoning 이벤트는 어댑터에서 폐기하며 이 계층으로 올라오지 않는다.
 */
async function callBrain({ brain, model, effort, prompt, session, schema, signal, onEvent }) {
  if (brain === 'codex') {
    const result = await runCodex({
      prompt, model, effort, threadId: session, schema, signal, onEvent,
    });
    return {
      text: result.text, session: result.threadId, usage: result.usage || null,
      execution: result.execution || null,
    };
  }
  if (brain !== 'claude') throw new Error(`지원하지 않는 브레인: ${brain}`);
  const result = await runClaude({
    // Claude의 복잡한 native --json-schema는 내부 재시도 폭주가 발생할 수 있다.
    // 스키마를 명시적 출력 계약으로 전달하고 상위 엔진의 Ajv 검증/복구를 사용한다.
    prompt: appendSchemaContract(prompt, schema),
    model, effort, sessionId: session, signal, onEvent,
  });
  return {
    text: result.text, session: result.sessionId, usage: result.usage || null,
    execution: result.execution || null,
  };
}

module.exports = { callBrain, appendSchemaContract };
