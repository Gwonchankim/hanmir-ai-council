'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { appendSchemaContract } = require('../agents/brain');

test('Claude용 schema contract는 원 프롬프트 뒤에 완전한 JSON Schema를 붙인다', () => {
  const schema = { type: 'object', additionalProperties: false, required: ['ok'], properties: { ok: { type: 'boolean' } } };
  const prompt = appendSchemaContract('원 지시', schema);
  assert.match(prompt, /^원 지시/);
  assert.match(prompt, /OUTPUT_JSON_SCHEMA_BEGIN/);
  assert.match(prompt, /"required":\["ok"\]/);
  assert.match(prompt, /JSON 객체 하나만 출력/);
});
