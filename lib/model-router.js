'use strict';

const LIMIT_PATTERN = [
  'monthly spend limit',
  'session limit',
  'usage limit',
  'rate limit',
  'rate_limit',
  'insufficient_quota',
  'quota exceeded',
  'billing limit',
  'credit balance',
  'too many requests',
  'model not found',
  'model is not available',
  'unsupported model',
  'overloaded',
  'capacity',
].join('|');

const FALLBACK_ERROR = new RegExp(LIMIT_PATTERN, 'i');
const PROVIDER_SCOPE_ERROR = /monthly spend|session limit|usage limit|rate[_ ]?limit|insufficient_quota|quota exceeded|billing limit|credit balance|too many requests|overloaded|capacity/i;
const ROUTE_SCOPE_ERROR = /model not found|model is not available|unsupported model/i;

function routeKey(route) {
  return `${route.brain}:${route.model}:${route.effort}`;
}

function routeChain(config = {}) {
  const candidates = [{
    brain: config.brain,
    model: config.model,
    effort: config.effort,
  }, ...(Array.isArray(config.fallbacks) ? config.fallbacks : [])];
  const seen = new Set();
  return candidates.filter((item) => {
    if (!item?.brain || !item?.model || !item?.effort) return false;
    const key = routeKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isFallbackEligible(error) {
  if (!error || error.name === 'AbortError' || error.name === 'PromptLimitError'
    || error.name === 'StructuredOutputError') return false;
  if ([402, 408, 429, 502, 503, 504].includes(Number(error.status))) return true;
  if (['ETIMEDOUT', 'ECONNRESET', 'EAI_AGAIN'].includes(String(error.code || '').toUpperCase())) return true;
  return FALLBACK_ERROR.test(String(error.message || error));
}

function classifyFallbackError(error) {
  if (!isFallbackEligible(error)) return null;
  const message = String(error?.message || error || '');
  if (ROUTE_SCOPE_ERROR.test(message)) return { reason: 'model_unavailable', scope: 'route' };
  if (PROVIDER_SCOPE_ERROR.test(message) || [402, 429, 502, 503].includes(Number(error?.status))) {
    return { reason: 'provider_limit_or_availability', scope: 'provider' };
  }
  return { reason: 'transient_route_failure', scope: 'route' };
}

function circuitKeys(route) {
  return [`provider:${route.brain}`, `route:${routeKey(route)}`];
}

function activeCircuit(routeHealth = {}, route, at = Date.now()) {
  return circuitKeys(route)
    .map((key) => routeHealth[key])
    .find((entry) => entry && Date.parse(entry.openUntil || '') > at) || null;
}

function publicRoute(route) {
  return { brain: route.brain, model: route.model, effort: route.effort };
}

module.exports = {
  activeCircuit,
  circuitKeys,
  classifyFallbackError,
  isFallbackEligible,
  publicRoute,
  routeChain,
  routeKey,
};
