'use strict';

const crypto = require('crypto');

const CONTENT_FIELDS = Object.freeze([
  'headline',
  'assessment',
  'recommendation',
  'keyRisks',
  'keyOpportunities',
  'firstAction',
]);

const IDENTITY_PATTERNS = Object.freeze([
  { label: 'Contrarian', pattern: /\bcontrarian\b/i },
  { label: 'First Principles Thinker', pattern: /\bfirst[\s_-]*principles?(?:[\s_-]*thinker)?\b/i },
  { label: 'Expansionist', pattern: /\bexpansionist\b/i },
  { label: 'Outsider', pattern: /\boutsider\b/i },
  { label: 'Executor', pattern: /\bexecutor\b/i },
  { label: 'Claude', pattern: /\b(?:claude|anthropic|sonnet|haiku|opus)\b/i },
  { label: 'Codex/OpenAI', pattern: /\b(?:codex|chatgpt|openai|gpt[-\s]?\d)\b/i },
]);

function contentObject(analysis = {}) {
  return {
    headline: String(analysis.headline || ''),
    assessment: String(analysis.assessment || ''),
    recommendation: String(analysis.recommendation || ''),
    keyRisks: Array.isArray(analysis.keyRisks) ? analysis.keyRisks.map(String) : [],
    keyOpportunities: Array.isArray(analysis.keyOpportunities)
      ? analysis.keyOpportunities.map(String) : [],
    firstAction: String(analysis.firstAction || ''),
  };
}

function contentText(analysis = {}) {
  const content = contentObject(analysis);
  return CONTENT_FIELDS.flatMap((field) => (
    Array.isArray(content[field]) ? content[field] : [content[field]]
  )).join('\n');
}

function identityLeaks(analysis = {}) {
  const text = contentText(analysis);
  return IDENTITY_PATTERNS
    .filter(({ pattern }) => pattern.test(text))
    .map(({ label }) => label);
}

function sourceDigest(analysis = {}) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(contentObject(analysis)), 'utf8')
    .digest('hex');
}

function anonymizeResponse(responseId, analysis = {}) {
  return {
    responseId,
    ...contentObject(analysis),
    sourceDigest: sourceDigest(analysis),
  };
}

function validateAnonymousBundle({
  mapping = {},
  responses = [],
  advisorAnalyses = {},
  advisorKeys = [],
} = {}) {
  const errors = [];
  const letters = advisorKeys.map((_, index) => String.fromCharCode(65 + index));
  if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
    errors.push('mapping must be an object');
    return errors;
  }
  const mappingKeys = Object.keys(mapping);
  const mappingValues = Object.values(mapping);
  if (mappingKeys.length !== letters.length
    || letters.some((letter) => !mappingKeys.includes(letter))
    || new Set(mappingValues).size !== advisorKeys.length
    || advisorKeys.some((advisor) => !mappingValues.includes(advisor))) {
    errors.push('mapping must contain a one-to-one A–E advisor assignment');
  }
  if (!Array.isArray(responses) || responses.length !== letters.length) {
    errors.push('responses must contain exactly one item for every response letter');
    return errors;
  }
  const responseIds = responses.map((item) => item?.responseId);
  if (new Set(responseIds).size !== letters.length
    || letters.some((letter) => !responseIds.includes(letter))) {
    errors.push('response IDs must be unique and complete');
  }
  for (const letter of letters) {
    const response = responses.find((item) => item?.responseId === letter);
    const advisor = mapping[letter];
    const source = advisorAnalyses[advisor];
    if (!response || !source) {
      errors.push(`Response ${letter} has no matching advisor analysis`);
      continue;
    }
    if (response.advisor || response.model || response.brain || response.provider || response.reviewer) {
      errors.push(`Response ${letter} exposes identity metadata`);
    }
    const expected = anonymizeResponse(letter, source);
    if (JSON.stringify(response) !== JSON.stringify(expected)) {
      errors.push(`Response ${letter} does not match its source analysis`);
    }
    const leaks = identityLeaks(response);
    if (leaks.length) errors.push(`Response ${letter} exposes identity text: ${leaks.join(', ')}`);
  }
  return errors;
}

module.exports = {
  CONTENT_FIELDS,
  anonymizeResponse,
  contentObject,
  identityLeaks,
  sourceDigest,
  validateAnonymousBundle,
};
