'use strict';

const crypto = require('node:crypto');
const net = require('node:net');

const ACCESS_MODES = Object.freeze(['local', 'tailscale']);
const TAILSCALE_HEADERS_INFO = 'https://tailscale.com/s/serve-headers';
const ALLOWED_FORWARDED_HEADERS = new Set([
  'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto',
]);
const tailscaleAddresses = new net.BlockList();
tailscaleAddresses.addSubnet('100.64.0.0', 10, 'ipv4');
tailscaleAddresses.addSubnet('fd7a:115c:a1e0::', 48, 'ipv6');

class AccessPolicyError extends Error {
  constructor(message, { status = 403, code = 'ACCESS_DENIED', field } = {}) {
    super(message);
    this.name = 'AccessPolicyError';
    this.status = status;
    this.code = code;
    this.field = field;
  }
}

function isLoopback(address) {
  const value = String(address || '').trim().toLowerCase();
  return value === '127.0.0.1' || value === '::1' || value === '[::1]'
    || value === '::ffff:127.0.0.1' || value === 'localhost';
}

function normalizeTailnetHostname(value) {
  const hostname = String(value || '').trim().replace(/\.$/, '').toLowerCase();
  if (hostname.length < 7 || hostname.length > 253 || !hostname.endsWith('.ts.net')) {
    throw new AccessPolicyError('Tailnet hostname must be an exact *.ts.net DNS name.', {
      status: 400, code: 'TAILNET_HOST_INVALID', field: 'tailnetHostname',
    });
  }
  const labels = hostname.split('.');
  if (labels.length < 4 || labels.some((label) => (
    !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)
  ))) {
    throw new AccessPolicyError('Tailnet hostname contains an invalid DNS label.', {
      status: 400, code: 'TAILNET_HOST_INVALID', field: 'tailnetHostname',
    });
  }
  return hostname;
}

function normalizeAllowedUsers(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(',');
  const users = [];
  for (const item of raw) {
    const user = String(item || '').trim().toLowerCase();
    if (!user) continue;
    if (user.length > 254 || /[\u0000-\u0020\u007f,]/.test(user)) {
      throw new AccessPolicyError('Allowed Tailscale login contains unsafe characters.', {
        status: 400, code: 'TAILNET_USER_INVALID', field: 'allowedUsers',
      });
    }
    if (!users.includes(user)) users.push(user);
  }
  return users;
}

function normalizeAccessPolicy(input = {}) {
  const mode = String(input.mode || 'local').trim().toLowerCase();
  if (!ACCESS_MODES.includes(mode)) {
    throw new AccessPolicyError(`Unknown access mode: ${mode}`, {
      status: 400, code: 'ACCESS_MODE_INVALID', field: 'mode',
    });
  }
  const mutationLimit = Number(input.mutationLimit ?? 60);
  const mutationWindowMs = Number(input.mutationWindowMs ?? 60_000);
  if (!Number.isSafeInteger(mutationLimit) || mutationLimit < 1 || mutationLimit > 10_000) {
    throw new AccessPolicyError('Remote mutation limit must be an integer between 1 and 10000.', {
      status: 400, code: 'REMOTE_RATE_INVALID', field: 'mutationLimit',
    });
  }
  if (!Number.isSafeInteger(mutationWindowMs)
      || mutationWindowMs < 1_000 || mutationWindowMs > 3_600_000) {
    throw new AccessPolicyError('Remote mutation window must be between 1000 and 3600000 ms.', {
      status: 400, code: 'REMOTE_RATE_INVALID', field: 'mutationWindowMs',
    });
  }
  if (mode === 'local') {
    return {
      mode, tailnetHostname: null, allowedUsers: [], mutationLimit, mutationWindowMs,
    };
  }
  const tailnetHostname = normalizeTailnetHostname(input.tailnetHostname);
  const allowedUsers = normalizeAllowedUsers(input.allowedUsers);
  if (!allowedUsers.length) {
    throw new AccessPolicyError('Tailscale access requires at least one allowed user login.', {
      status: 400, code: 'TAILNET_USER_REQUIRED', field: 'allowedUsers',
    });
  }
  return { mode, tailnetHostname, allowedUsers, mutationLimit, mutationWindowMs };
}

function hostHeaderIsLoopback(value) {
  try {
    return isLoopback(new URL(`http://${String(value || '')}`).hostname);
  } catch (_) {
    return false;
  }
}

function exactTailnetAuthority(value, hostname) {
  const authority = String(value || '').trim().toLowerCase();
  return authority === hostname || authority === `${hostname}:443`;
}

function isTailscaleAddress(value) {
  const address = String(value || '').trim();
  const family = net.isIP(address);
  if (family === 4) return tailscaleAddresses.check(address, 'ipv4');
  if (family === 6) return tailscaleAddresses.check(address, 'ipv6');
  return false;
}

function reject(code, message, status = 403) {
  throw new AccessPolicyError(message, { code, status });
}

function assertFetchSite(req) {
  const fetchSite = String(req.get('sec-fetch-site') || '').toLowerCase();
  if (!fetchSite || ['same-origin', 'same-site', 'none'].includes(fetchSite)) return;

  // A phone opening the app from Messages, mail, or another application sends
  // Sec-Fetch-Site: cross-site for the first top-level navigation. Permit only
  // the two static application entry documents. API, SSE, subresource, and
  // mutation requests remain blocked. Some embedded mobile browsers omit one
  // or both of Mode/Dest, so treat missing metadata as compatible but reject
  // any explicit non-navigation or non-document value.
  const method = String(req.method || '').toUpperCase();
  const pathname = String(req.path || '');
  const fetchMode = String(req.get('sec-fetch-mode') || '').toLowerCase();
  const fetchDest = String(req.get('sec-fetch-dest') || '').toLowerCase();
  const appEntryNavigation = fetchSite === 'cross-site'
    && ['GET', 'HEAD'].includes(method)
    && ['/', '/index.html'].includes(pathname)
    && (!fetchMode || fetchMode === 'navigate')
    && (!fetchDest || fetchDest === 'document');
  if (!appEntryNavigation) {
    reject('CROSS_SITE_REQUEST', 'Cross-site browser requests are not allowed.');
  }
}

function assertLocalOrigin(req) {
  const origin = req.get('origin');
  if (!origin) return;
  try {
    const parsed = new URL(origin);
    if (!isLoopback(parsed.hostname)
      || parsed.host.toLowerCase() !== String(req.get('host')).toLowerCase()) {
      reject('ORIGIN_MISMATCH', 'Origin must exactly match the local request Host.');
    }
  } catch (error) {
    if (error instanceof AccessPolicyError) throw error;
    reject('ORIGIN_INVALID', 'Invalid Origin header.');
  }
}

function assertRemoteOrigin(req, hostname, { required = false } = {}) {
  const origin = req.get('origin');
  if (!origin) {
    if (required) reject('ORIGIN_REQUIRED', 'Remote mutations require the exact Tailnet HTTPS Origin.');
    return;
  }
  try {
    const parsed = new URL(origin);
    if (parsed.origin.toLowerCase() !== `https://${hostname}`
      || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      reject('ORIGIN_MISMATCH', 'Origin must exactly match the allowlisted Tailnet HTTPS origin.');
    }
  } catch (error) {
    if (error instanceof AccessPolicyError) throw error;
    reject('ORIGIN_INVALID', 'Invalid Origin header.');
  }
}

function forwardedHeaderNames(req) {
  return Object.keys(req.headers || {}).filter((name) => (
    name === 'forwarded' || name.startsWith('x-forwarded-')
  ));
}

function authenticateRequest(req, inputPolicy) {
  const policy = normalizeAccessPolicy(inputPolicy);
  if (!isLoopback(req.socket?.remoteAddress)) {
    reject('NON_LOOPBACK_PROXY', 'The application only accepts a local browser or loopback Tailscale Serve proxy.');
  }
  assertFetchSite(req);
  const host = String(req.get('host') || '').trim().toLowerCase();
  if (hostHeaderIsLoopback(host)) {
    const suspicious = forwardedHeaderNames(req);
    const tailscaleMarkers = [
      'tailscale-user-login', 'tailscale-user-name', 'tailscale-user-profile-pic',
      'tailscale-headers-info', 'tailscale-funnel-request',
    ].filter((name) => req.get(name) !== undefined);
    if (suspicious.length || tailscaleMarkers.length) {
      reject('UNTRUSTED_PROXY_HEADERS', 'Forwarded and Tailscale headers are not accepted on direct localhost requests.');
    }
    assertLocalOrigin(req);
    return { kind: 'local', user: null, origin: null };
  }

  if (policy.mode !== 'tailscale') {
    reject('REMOTE_MODE_DISABLED', 'Remote access is disabled; use localhost.');
  }
  if (!exactTailnetAuthority(host, policy.tailnetHostname)) {
    reject('TAILNET_HOST_MISMATCH', 'Request Host is not the allowlisted Tailnet hostname.');
  }
  if (req.get('forwarded') !== undefined) {
    reject('UNTRUSTED_FORWARDED_HEADER', 'RFC Forwarded headers are not trusted on the Serve boundary.');
  }
  const unexpectedForwarded = forwardedHeaderNames(req)
    .filter((name) => name !== 'forwarded' && !ALLOWED_FORWARDED_HEADERS.has(name));
  if (unexpectedForwarded.length) {
    reject('UNTRUSTED_PROXY_HEADERS', `Unexpected proxy header: ${unexpectedForwarded[0]}`);
  }
  if (!exactTailnetAuthority(req.get('x-forwarded-host'), policy.tailnetHostname)) {
    reject('FORWARDED_HOST_MISMATCH', 'X-Forwarded-Host is not the allowlisted Tailnet hostname.');
  }
  if (String(req.get('x-forwarded-proto') || '').toLowerCase() !== 'https') {
    reject('FORWARDED_PROTO_INVALID', 'Tailscale Serve must terminate HTTPS.');
  }
  const forwardedFor = String(req.get('x-forwarded-for') || '').trim();
  if (forwardedFor.includes(',') || !isTailscaleAddress(forwardedFor)) {
    reject('FORWARDED_CLIENT_INVALID', 'X-Forwarded-For must be one Tailnet address supplied by Serve.');
  }
  if (req.get('tailscale-funnel-request') !== undefined) {
    reject('FUNNEL_FORBIDDEN', 'Tailscale Funnel traffic is never accepted.');
  }
  if (req.get('tailscale-headers-info') !== TAILSCALE_HEADERS_INFO) {
    reject('TAILSCALE_IDENTITY_UNVERIFIED', 'Verified Tailscale Serve identity headers are required.');
  }
  const user = String(req.get('tailscale-user-login') || '').trim().toLowerCase();
  if (!user || !policy.allowedUsers.includes(user)) {
    reject('TAILSCALE_USER_FORBIDDEN', 'The Tailscale user is not allowlisted.');
  }
  assertRemoteOrigin(req, policy.tailnetHostname, {
    required: !['GET', 'HEAD', 'OPTIONS'].includes(req.method),
  });
  return { kind: 'tailscale', user, origin: `https://${policy.tailnetHostname}` };
}

function safeTokenEqual(actual, expected) {
  const left = Buffer.from(String(actual || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

class RemoteMutationGuard {
  constructor(policy, { clock = () => Date.now(), randomBytes = crypto.randomBytes } = {}) {
    this.policy = normalizeAccessPolicy(policy);
    this.clock = clock;
    this.randomBytes = randomBytes;
    this.tokens = new Map();
    this.attempts = new Map();
  }

  accessPayload(access) {
    if (access.kind !== 'tailscale') {
      return { mode: 'local', remote: false, csrf: { required: false } };
    }
    let token = this.tokens.get(access.user);
    if (!token) {
      token = this.randomBytes(32).toString('base64url');
      this.tokens.set(access.user, token);
    }
    return {
      mode: 'tailscale',
      remote: true,
      origin: access.origin,
      identity: { login: access.user },
      csrf: { required: true, token, header: 'X-AI-Council-CSRF' },
    };
  }

  authorizeMutation(req, access) {
    if (access.kind !== 'tailscale') return { ok: true, remote: false };
    const expected = this.tokens.get(access.user);
    if (!safeTokenEqual(req.get('x-ai-council-csrf'), expected)) {
      reject('CSRF_TOKEN_INVALID', 'Fetch /api/security-context and provide its CSRF token for remote mutations.', 403);
    }
    const timestamp = this.clock();
    const cutoff = timestamp - this.policy.mutationWindowMs;
    const prior = (this.attempts.get(access.user) || []).filter((item) => item > cutoff);
    if (prior.length >= this.policy.mutationLimit) {
      const retryAfterMs = Math.max(1, prior[0] + this.policy.mutationWindowMs - timestamp);
      const error = new AccessPolicyError('Remote mutation rate limit exceeded.', {
        status: 429, code: 'REMOTE_RATE_LIMIT',
      });
      error.retryAfter = Math.ceil(retryAfterMs / 1000);
      throw error;
    }
    prior.push(timestamp);
    this.attempts.set(access.user, prior);
    return { ok: true, remote: true, user: access.user };
  }
}

function evaluateTailscalePreflight(status, { expectedHostname, allowedUsers } = {}) {
  const errors = [];
  const add = (code, message) => errors.push({ code, message });
  if (!status || typeof status !== 'object' || Array.isArray(status)) {
    return { ok: false, errors: [{ code: 'TAILSCALE_STATUS_INVALID', message: 'Tailscale status is not a JSON object.' }] };
  }
  if (status.BackendState !== 'Running') {
    add('TAILSCALE_NOT_RUNNING', `Tailscale BackendState must be Running, not ${status.BackendState || 'unknown'}.`);
  }
  if (!status.Self || typeof status.Self !== 'object') add('TAILSCALE_SELF_MISSING', 'Tailscale Self status is missing.');
  if (status.Self?.Online === false) add('TAILSCALE_SELF_OFFLINE', 'The local Tailscale node is offline.');
  let hostname = null;
  try { hostname = normalizeTailnetHostname(status.Self?.DNSName); } catch (error) { add(error.code, error.message); }
  const userId = status.Self?.UserID;
  const userRecord = status.User?.[String(userId)] || status.Users?.[String(userId)];
  const selfUser = String(userRecord?.LoginName || '').trim().toLowerCase() || null;
  if (!selfUser) add('TAILSCALE_USER_MISSING', 'Self.UserID does not resolve to User.LoginName.');
  let normalizedAllowed = [];
  try { normalizedAllowed = normalizeAllowedUsers(allowedUsers?.length ? allowedUsers : [selfUser]); }
  catch (error) { add(error.code, error.message); }
  if (!normalizedAllowed.length) add('TAILNET_USER_REQUIRED', 'At least one allowed user is required.');
  if (expectedHostname) {
    try {
      if (normalizeTailnetHostname(expectedHostname) !== hostname) {
        add('TAILNET_HOST_MISMATCH', 'Configured Tailnet hostname does not match status Self.DNSName.');
      }
    } catch (error) { add(error.code, error.message); }
  }
  return {
    ok: errors.length === 0,
    backendState: status.BackendState || null,
    hostname,
    selfUser,
    allowedUsers: normalizedAllowed,
    errors,
  };
}

module.exports = {
  ACCESS_MODES,
  TAILSCALE_HEADERS_INFO,
  AccessPolicyError,
  RemoteMutationGuard,
  authenticateRequest,
  evaluateTailscalePreflight,
  hostHeaderIsLoopback,
  isLoopback,
  isTailscaleAddress,
  normalizeAccessPolicy,
  normalizeAllowedUsers,
  normalizeTailnetHostname,
  safeTokenEqual,
};
