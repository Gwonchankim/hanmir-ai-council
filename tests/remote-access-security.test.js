'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createApp } = require('../server');
const { StateStore } = require('../state');
const {
  TAILSCALE_HEADERS_INFO,
  evaluateTailscalePreflight,
  isTailscaleAddress,
  normalizeAccessPolicy,
  normalizeAllowedUsers,
  normalizeTailnetHostname,
} = require('../lib/access-security');

const REMOTE_HOST = 'council.example-tailnet.ts.net';
const REMOTE_ORIGIN = `https://${REMOTE_HOST}`;
const REMOTE_USER = 'owner@example.com';
const REMOTE_IP = '100.100.100.10';

function inertEngine() {
  return {
    setEmitter(fn) { this.emitter = fn; },
    cancel() {},
    retry() { throw new Error('Remote access regression must not run an agent.'); },
    runPlanning() { throw new Error('Remote access regression must not run an agent.'); },
  };
}

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-council-remote-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = new StateStore({ snapshotPath: path.join(dir, 'session.json'), autoLoad: false });
  store.snapshot();
  return { dir, store };
}

function remotePolicy(overrides = {}) {
  return {
    mode: 'tailscale',
    tailnetHostname: REMOTE_HOST,
    allowedUsers: [REMOTE_USER],
    mutationLimit: 60,
    mutationWindowMs: 60_000,
    ...overrides,
  };
}

async function startServer(t, {
  store = fixture(t).store,
  accessPolicy = { mode: 'local' },
  accessGuardOptions = {},
} = {}) {
  const app = createApp({ store, engine: inertEngine(), accessPolicy, accessGuardOptions });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => {
    app.locals.closeStreams();
    server.close(resolve);
  }));
  return { app, server, store, base: `http://127.0.0.1:${server.address().port}` };
}

function withOverrides(base, overrides = {}) {
  const result = { ...base };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null || value === undefined) delete result[name];
    else result[name] = value;
  }
  return result;
}

function remoteHeaders(overrides = {}) {
  return withOverrides({
    Host: REMOTE_HOST,
    'Sec-Fetch-Site': 'same-origin',
    'X-Forwarded-For': REMOTE_IP,
    'X-Forwarded-Host': REMOTE_HOST,
    'X-Forwarded-Proto': 'https',
    'Tailscale-Headers-Info': TAILSCALE_HEADERS_INFO,
    'Tailscale-User-Login': REMOTE_USER,
    'Tailscale-User-Name': 'Council Owner',
  }, overrides);
}

async function jsonRequest(base, route, {
  method = 'GET', headers = {}, body,
} = {}) {
  const requestHeaders = { ...headers };
  if (body !== undefined && !Object.keys(requestHeaders).some((name) => name.toLowerCase() === 'content-type')) {
    requestHeaders['Content-Type'] = 'application/json';
  }
  const requestBody = body === undefined
    ? null
    : (typeof body === 'string' ? body : JSON.stringify(body));
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: route,
      method,
      headers: requestHeaders,
    }, (incoming) => {
      const chunks = [];
      incoming.on('data', (chunk) => chunks.push(chunk));
      incoming.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let payload = null;
        try { payload = text ? JSON.parse(text) : null; } catch (_) { payload = null; }
        resolve({
          response: {
            status: incoming.statusCode,
            headers: {
              get(name) { return incoming.headers[String(name).toLowerCase()] || null; },
            },
          },
          payload,
        });
      });
    });
    request.on('error', reject);
    if (requestBody !== null) request.write(requestBody);
    request.end();
  });
}

async function securityContext(base, headers = remoteHeaders()) {
  const result = await jsonRequest(base, '/api/security-context', { headers });
  assert.equal(result.response.status, 200);
  return result;
}

function remoteMutationHeaders({ csrfToken, sessionId, overrides = {} }) {
  return remoteHeaders(withOverrides({
    Origin: REMOTE_ORIGIN,
    'Content-Type': 'application/json',
    'X-AI-Council-CSRF': csrfToken,
    'X-AI-Council-Session': sessionId,
  }, overrides));
}

function streamProbe(base, route, headers, timeoutMs = 2_000) {
  const url = new URL(route, base);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: `${url.pathname}${url.search}`,
      method: 'GET',
      headers,
    }, (response) => {
      let data = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        data += chunk;
        finish({ status: response.statusCode, headers: response.headers, data });
        request.destroy();
      });
      response.on('end', () => finish({ status: response.statusCode, headers: response.headers, data }));
    });
    const timer = setTimeout(() => {
      request.destroy();
      reject(new Error(`Timed out probing ${route}`));
    }, timeoutMs);
    request.on('error', (error) => {
      if (settled && error.code === 'ECONNRESET') return;
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

test('Tailscale policy parsing is strict and preflight derives only the current node identity', () => {
  assert.equal(normalizeTailnetHostname('Council.Example-Tailnet.ts.net.'), REMOTE_HOST);
  assert.throws(() => normalizeTailnetHostname(`${REMOTE_HOST}.attacker.example`), /exact.*\.ts\.net/i);
  assert.throws(() => normalizeTailnetHostname('*.example-tailnet.ts.net'), /invalid DNS label/i);
  assert.deepEqual(normalizeAllowedUsers(' Owner@Example.com,second@example.com,OWNER@example.com '), [
    REMOTE_USER, 'second@example.com',
  ]);
  assert.throws(() => normalizeAllowedUsers('owner@example.com\nattacker@example.com'), /unsafe/i);
  assert.throws(() => normalizeAccessPolicy({ mode: 'tailscale', tailnetHostname: REMOTE_HOST }), /at least one allowed/i);
  assert.throws(() => normalizeAccessPolicy({ mode: 'internet' }), /Unknown access mode/i);
  assert.equal(isTailscaleAddress(REMOTE_IP), true);
  assert.equal(isTailscaleAddress('fd7a:115c:a1e0::1234'), true);
  assert.equal(isTailscaleAddress('192.168.1.2'), false);
  assert.equal(isTailscaleAddress('8.8.8.8'), false);

  const status = {
    BackendState: 'Running',
    Self: { Online: true, DNSName: `${REMOTE_HOST}.`, UserID: 42 },
    User: { 42: { LoginName: 'Owner@Example.com' } },
  };
  const report = evaluateTailscalePreflight(status, { expectedHostname: REMOTE_HOST });
  assert.equal(report.ok, true);
  assert.equal(report.hostname, REMOTE_HOST);
  assert.equal(report.selfUser, REMOTE_USER);
  assert.deepEqual(report.allowedUsers, [REMOTE_USER]);
  assert.equal(Object.hasOwn(report, 'User'), false, 'raw status must not be echoed');

  const offline = evaluateTailscalePreflight({ ...status, BackendState: 'Stopped' });
  assert.equal(offline.ok, false);
  assert.ok(offline.errors.some((item) => item.code === 'TAILSCALE_NOT_RUNNING'));
  const mismatch = evaluateTailscalePreflight(status, { expectedHostname: 'other.example-tailnet.ts.net' });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.some((item) => item.code === 'TAILNET_HOST_MISMATCH'));
});

test('local mode keeps its original contract and rejects forged proxy or Tailscale headers', async (t) => {
  const { base, store } = await startServer(t);
  const local = await jsonRequest(base, '/api/security-context');
  assert.equal(local.response.status, 200);
  assert.match(local.response.headers.get('cache-control') || '', /no-store/);
  assert.deepEqual(local.payload, {
    accessMode: 'local',
    remote: false,
    remoteIdentity: null,
    origin: null,
    csrfRequired: false,
    csrfToken: null,
    csrfHeader: 'X-AI-Council-CSRF',
  });

  const forgedIdentity = await jsonRequest(base, '/api/state', {
    headers: {
      'Tailscale-Headers-Info': TAILSCALE_HEADERS_INFO,
      'Tailscale-User-Login': REMOTE_USER,
    },
  });
  assert.equal(forgedIdentity.response.status, 403);
  assert.equal(forgedIdentity.payload.error.code, 'UNTRUSTED_PROXY_HEADERS');

  const forgedForwarded = await jsonRequest(base, '/api/state', {
    headers: { 'X-Forwarded-Host': REMOTE_HOST },
  });
  assert.equal(forgedForwarded.response.status, 403);
  assert.equal(forgedForwarded.payload.error.code, 'UNTRUSTED_PROXY_HEADERS');

  const remoteHostWhileDisabled = await jsonRequest(base, '/api/state', { headers: remoteHeaders() });
  assert.equal(remoteHostWhileDisabled.response.status, 403);
  assert.equal(remoteHostWhileDisabled.payload.error.code, 'REMOTE_MODE_DISABLED');

  const mutation = await jsonRequest(base, '/api/session', {
    method: 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      'X-AI-Council-Session': store.get().sessionKey,
    },
    body: { config: store.get().config, reset: false },
  });
  assert.equal(mutation.response.status, 200, 'local mutations must not gain a CSRF requirement');
});

test('remote security context requires the exact Serve boundary and exposes only minimal identity', async (t) => {
  const { base } = await startServer(t, { accessPolicy: remotePolicy() });
  const context = await securityContext(base);
  assert.match(context.response.headers.get('cache-control') || '', /no-store/);
  assert.equal(context.payload.accessMode, 'tailscale');
  assert.equal(context.payload.remote, true);
  assert.deepEqual(context.payload.remoteIdentity, { login: REMOTE_USER, name: null });
  assert.equal(context.payload.csrfRequired, true);
  assert.equal(context.payload.csrfHeader, 'X-AI-Council-CSRF');
  assert.match(context.payload.csrfToken, /^[A-Za-z0-9_-]{43}$/);
  assert.doesNotMatch(JSON.stringify(context.payload), /profile|picture|Council Owner/i);

  const alias = await jsonRequest(base, '/api/access', { headers: remoteHeaders() });
  assert.equal(alias.response.status, 200);
  assert.equal(alias.payload.csrfToken, context.payload.csrfToken);

  const cases = [
    ['wrong Host', { Host: 'evil.example-tailnet.ts.net' }, 'TAILNET_HOST_MISMATCH'],
    ['Host suffix attack', { Host: `${REMOTE_HOST}.attacker.example` }, 'TAILNET_HOST_MISMATCH'],
    ['wrong Host port', { Host: `${REMOTE_HOST}:444` }, 'TAILNET_HOST_MISMATCH'],
    ['missing forwarded Host', { 'X-Forwarded-Host': null }, 'FORWARDED_HOST_MISMATCH'],
    ['forwarded Host suffix attack', { 'X-Forwarded-Host': `${REMOTE_HOST}.attacker.example` }, 'FORWARDED_HOST_MISMATCH'],
    ['HTTP proxy scheme', { 'X-Forwarded-Proto': 'http' }, 'FORWARDED_PROTO_INVALID'],
    ['LAN forwarded client', { 'X-Forwarded-For': '192.168.1.20' }, 'FORWARDED_CLIENT_INVALID'],
    ['forwarding chain', { 'X-Forwarded-For': `${REMOTE_IP}, 100.100.100.11` }, 'FORWARDED_CLIENT_INVALID'],
    ['missing Serve marker', { 'Tailscale-Headers-Info': null }, 'TAILSCALE_IDENTITY_UNVERIFIED'],
    ['wrong Serve marker', { 'Tailscale-Headers-Info': 'forged' }, 'TAILSCALE_IDENTITY_UNVERIFIED'],
    ['missing identity', { 'Tailscale-User-Login': null }, 'TAILSCALE_USER_FORBIDDEN'],
    ['non-allowlisted identity', { 'Tailscale-User-Login': 'attacker@example.com' }, 'TAILSCALE_USER_FORBIDDEN'],
    ['Funnel marker', { 'Tailscale-Funnel-Request': '?1' }, 'FUNNEL_FORBIDDEN'],
    ['RFC Forwarded spoof', { Forwarded: `host=${REMOTE_HOST};proto=https` }, 'UNTRUSTED_FORWARDED_HEADER'],
    ['unexpected proxy header', { 'X-Forwarded-Port': '443' }, 'UNTRUSTED_PROXY_HEADERS'],
  ];
  for (const [label, overrides, code] of cases) {
    const result = await jsonRequest(base, '/api/security-context', {
      headers: remoteHeaders(overrides),
    });
    assert.equal(result.response.status, 403, label);
    assert.equal(result.payload.error.code, code, label);
  }

  const wrongOrigin = await jsonRequest(base, '/api/security-context', {
    headers: remoteHeaders({ Origin: 'https://attacker.example' }),
  });
  assert.equal(wrongOrigin.response.status, 403);
  assert.equal(wrongOrigin.payload.error.code, 'ORIGIN_MISMATCH');
});

test('remote mutations require exact Origin, JSON, CSRF and active session while CORS stays closed', async (t) => {
  const { base, store } = await startServer(t, { accessPolicy: remotePolicy() });
  const context = await securityContext(base);
  const token = context.payload.csrfToken;
  const sessionId = store.get().sessionKey;
  const body = { config: store.get().config, reset: false };
  const validHeaders = remoteMutationHeaders({ csrfToken: token, sessionId });

  const missingOrigin = await jsonRequest(base, '/api/session', {
    method: 'POST', headers: withOverrides(validHeaders, { Origin: null }), body,
  });
  assert.equal(missingOrigin.response.status, 403);
  assert.equal(missingOrigin.payload.error.code, 'ORIGIN_REQUIRED');

  const wrongOrigin = await jsonRequest(base, '/api/session', {
    method: 'POST', headers: { ...validHeaders, Origin: 'https://attacker.example' }, body,
  });
  assert.equal(wrongOrigin.response.status, 403);
  assert.equal(wrongOrigin.payload.error.code, 'ORIGIN_MISMATCH');

  for (const [label, overrides] of [
    ['missing CSRF', { 'X-AI-Council-CSRF': null }],
    ['wrong CSRF', { 'X-AI-Council-CSRF': 'not-the-token' }],
  ]) {
    const result = await jsonRequest(base, '/api/session', {
      method: 'POST', headers: withOverrides(validHeaders, overrides), body,
    });
    assert.equal(result.response.status, 403, label);
    assert.equal(result.payload.error.code, 'CSRF_TOKEN_INVALID', label);
  }

  const bodyTokenIsNotAuth = await jsonRequest(base, `/api/session?csrfToken=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: withOverrides(validHeaders, { 'X-AI-Council-CSRF': null }),
    body: { ...body, csrfToken: token },
  });
  assert.equal(bodyTokenIsNotAuth.response.status, 403);
  assert.equal(bodyTokenIsNotAuth.payload.error.code, 'CSRF_TOKEN_INVALID');

  const wrongType = await jsonRequest(base, '/api/session', {
    method: 'POST',
    headers: withOverrides(validHeaders, { 'Content-Type': 'text/plain' }),
    body: JSON.stringify(body),
  });
  assert.equal(wrongType.response.status, 415);

  const crossSite = await jsonRequest(base, '/api/session', {
    method: 'POST',
    headers: { ...validHeaders, 'Sec-Fetch-Site': 'cross-site' },
    body,
  });
  assert.equal(crossSite.response.status, 403);
  assert.equal(crossSite.payload.error.code, 'CROSS_SITE_REQUEST');

  const valid = await jsonRequest(base, '/api/session', {
    method: 'POST', headers: validHeaders, body,
  });
  assert.equal(valid.response.status, 200);
  assert.doesNotMatch(JSON.stringify(valid.payload), new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const preflight = await jsonRequest(base, '/api/session', {
    method: 'OPTIONS',
    headers: remoteHeaders({
      Origin: 'https://attacker.example',
      'Sec-Fetch-Site': 'cross-site',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-ai-council-csrf',
    }),
  });
  assert.equal(preflight.response.status, 403);
  assert.equal(preflight.response.headers.get('access-control-allow-origin'), null);

  const sameOriginOptions = await jsonRequest(base, '/api/session', {
    method: 'OPTIONS',
    headers: remoteHeaders({
      Origin: REMOTE_ORIGIN,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type,x-ai-council-csrf',
    }),
  });
  assert.equal(sameOriginOptions.response.status, 404,
    'the app must not expose an implicit CORS preflight endpoint');
  assert.equal(sameOriginOptions.response.headers.get('access-control-allow-origin'), null);
});

test('remote mutation rate limiting is per identity and returns Retry-After', async (t) => {
  let now = 10_000;
  const { base, store } = await startServer(t, {
    accessPolicy: remotePolicy({ mutationLimit: 2, mutationWindowMs: 1_000 }),
    accessGuardOptions: {
      clock: () => now,
      randomBytes: (length) => Buffer.alloc(length, 0x5a),
    },
  });
  const context = await securityContext(base);
  const headers = remoteMutationHeaders({
    csrfToken: context.payload.csrfToken,
    sessionId: store.get().sessionKey,
  });
  const body = { config: store.get().config, reset: false };
  for (let index = 0; index < 2; index += 1) {
    const accepted = await jsonRequest(base, '/api/session', { method: 'POST', headers, body });
    assert.equal(accepted.response.status, 200);
  }
  const limited = await jsonRequest(base, '/api/session', { method: 'POST', headers, body });
  assert.equal(limited.response.status, 429);
  assert.equal(limited.payload.error.code, 'REMOTE_RATE_LIMIT');
  assert.equal(limited.response.headers.get('retry-after'), '1');

  now += 1_001;
  const recovered = await jsonRequest(base, '/api/session', { method: 'POST', headers, body });
  assert.equal(recovered.response.status, 200);
});

test('SSE authenticates through Serve without putting CSRF secrets in its URL', async (t) => {
  const { base, store } = await startServer(t, { accessPolicy: remotePolicy() });
  const context = await securityContext(base);
  const token = context.payload.csrfToken;
  const sessionId = store.get().sessionKey;

  const allowed = await streamProbe(
    base,
    `/stream?sessionId=${encodeURIComponent(sessionId)}`,
    remoteHeaders(),
  );
  assert.equal(allowed.status, 200);
  assert.match(allowed.headers['content-type'] || '', /text\/event-stream/);
  assert.match(allowed.headers['cache-control'] || '', /no-store/);
  assert.doesNotMatch(allowed.data, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

  const missingIdentity = await streamProbe(
    base,
    `/stream?sessionId=${encodeURIComponent(sessionId)}&csrfToken=${encodeURIComponent(token)}`,
    remoteHeaders({ 'Tailscale-User-Login': null }),
  );
  assert.equal(missingIdentity.status, 403);
  assert.doesNotMatch(missingIdentity.data, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('two remote devices receive stale-session and stale-metadata conflicts instead of overwriting', async (t) => {
  const { store } = fixture(t);
  const sessionA = store.get().sessionKey;
  store.configure(store.get().config, { reset: true });
  const sessionB = store.get().sessionKey;
  store.activateSession(sessionA);
  const { base } = await startServer(t, { store, accessPolicy: remotePolicy() });
  const context = await securityContext(base);
  const csrfToken = context.payload.csrfToken;

  const activateB = await jsonRequest(base, `/api/sessions/${encodeURIComponent(sessionB)}/activate`, {
    method: 'POST',
    headers: remoteMutationHeaders({ csrfToken, sessionId: sessionA }),
    body: {},
  });
  assert.equal(activateB.response.status, 200);
  assert.equal(store.get().sessionKey, sessionB);

  const staleDeviceA = await jsonRequest(base, '/api/session', {
    method: 'POST',
    headers: remoteMutationHeaders({ csrfToken, sessionId: sessionA }),
    body: { config: store.get().config, reset: false },
  });
  assert.equal(staleDeviceA.response.status, 409);
  assert.equal(staleDeviceA.payload.error.activeSessionId, sessionB);

  const metadata = await jsonRequest(base, `/api/sessions/${encodeURIComponent(sessionB)}`, {
    headers: remoteHeaders(),
  });
  assert.equal(metadata.response.status, 200);
  const etag = metadata.response.headers.get('etag');
  assert.match(etag || '', /^"session-\d+"$/);
  const mutationHeaders = remoteMutationHeaders({ csrfToken, sessionId: sessionB });
  const firstRename = await jsonRequest(base, `/api/sessions/${encodeURIComponent(sessionB)}`, {
    method: 'PATCH',
    headers: { ...mutationHeaders, 'If-Match': etag },
    body: { title: 'Remote controller B' },
  });
  assert.equal(firstRename.response.status, 200);

  const staleRename = await jsonRequest(base, `/api/sessions/${encodeURIComponent(sessionB)}`, {
    method: 'PATCH',
    headers: { ...mutationHeaders, 'If-Match': etag },
    body: { title: 'Stale remote overwrite' },
  });
  assert.equal(staleRename.response.status, 409);
});

test('Tailscale launcher keeps Node on loopback, owns one HTTPS Serve mapping, and cleans it up', () => {
  const script = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'start-tailscale.ps1'), 'utf8');
  const paramBlock = script.slice(0, script.indexOf('$ErrorActionPreference'));
  assert.doesNotMatch(paramBlock, /\$PSScriptRoot/,
    'PowerShell may evaluate param defaults before PSScriptRoot is populated');
  assert.match(script, /\$PSCommandPath/,
    'the default project path must be resolved from the running script after param binding');
  assert.match(script, /AI_COUNCIL_HOST\s*=\s*'127\.0\.0\.1'/);
  assert.doesNotMatch(script, /AI_COUNCIL_HOST\s*=\s*'0\.0\.0\.0'/);
  assert.match(script, /AI_COUNCIL_ACCESS_MODE\s*=\s*'tailscale'/);
  assert.match(script, /status',\s*'--json'/);
  assert.match(script, /Self\.DNSName|Get-JsonProperty \$self 'DNSName'/);
  assert.match(script, /User\.LoginName|Get-JsonProperty \$selfUserRecord 'LoginName'/);
  assert.match(script, /\{2,\}ts\\\.net/,
    'normal device.tailnet.ts.net names must pass the launcher regex');
  assert.match(script, /existing Tailscale Serve\/Funnel configuration is present/i);
  assert.match(script, /serve --bg --yes \$target/);
  assert.match(script, /proxyTarget -ne \$target/);
  assert.match(script, /finally\s*\{/);
  assert.match(script, /serve --https=443 off/);
  assert.doesNotMatch(script, /funnel\s+(?:--bg|--https|--http)/i);
});
