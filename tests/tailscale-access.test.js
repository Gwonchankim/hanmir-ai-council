'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { StateStore } = require('../state');
const { createApp, startServer } = require('../server');
const {
  TAILSCALE_HEADERS_INFO,
  evaluateTailscalePreflight,
  isTailscaleAddress,
  normalizeAccessPolicy,
  normalizeTailnetHostname,
} = require('../lib/access-security');

const HOSTNAME = 'council.example-tailnet.ts.net';
const USER = 'owner@example.com';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-council-tailscale-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new StateStore({ snapshotPath: path.join(dir, 'session.json'), autoLoad: false });
}

function inertEngine() {
  return {
    setEmitter() {},
    cancel() {},
    retry() { throw new Error('not used'); },
    runPlanning() { throw new Error('not used'); },
  };
}

async function serverFixture(t, options = {}) {
  const store = fixture(t);
  const accessPolicy = normalizeAccessPolicy({
    mode: 'tailscale',
    tailnetHostname: HOSTNAME,
    allowedUsers: [USER],
    mutationLimit: options.mutationLimit || 60,
    mutationWindowMs: 60_000,
  });
  const app = createApp({
    store,
    engine: inertEngine(),
    accessPolicy,
    accessGuardOptions: options.accessGuardOptions,
  });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => {
    app.locals.closeStreams();
    server.close(resolve);
  }));
  return { store, app, base: `http://127.0.0.1:${server.address().port}` };
}

function serveHeaders(overrides = {}) {
  return {
    host: HOSTNAME,
    'x-forwarded-host': HOSTNAME,
    'x-forwarded-proto': 'https',
    'x-forwarded-for': '100.100.10.20',
    'tailscale-user-login': USER,
    'tailscale-user-name': 'Owner',
    'tailscale-headers-info': TAILSCALE_HEADERS_INFO,
    'sec-fetch-site': 'same-origin',
    ...overrides,
  };
}

async function remoteFetch(base, route, options = {}) {
  return rawRequest(base, route, {
    ...options, headers: { ...serveHeaders(), ...(options.headers || {}) },
  });
}

function rawRequest(base, route, {
  method = 'GET', headers = {}, body, stream = false,
} = {}) {
  const url = new URL(base);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: url.hostname,
      port: url.port,
      path: route,
      method,
      headers,
    }, (response) => {
      if (stream) {
        resolve({
          status: response.statusCode,
          headers: { get: (name) => response.headers[String(name).toLowerCase()] || null },
          destroy: () => { response.destroy(); request.destroy(); },
        });
        return;
      }
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve({
          status: response.statusCode,
          headers: { get: (name) => response.headers[String(name).toLowerCase()] || null },
          text: async () => text,
          json: async () => JSON.parse(text),
        });
      });
    });
    request.on('error', reject);
    if (body !== undefined) request.write(body);
    request.end();
  });
}

test('access policy accepts exact Tailnet hostnames/users and Tailscale address ranges only', () => {
  assert.equal(normalizeTailnetHostname('Host.Example-Tailnet.ts.net.'), 'host.example-tailnet.ts.net');
  assert.equal(isTailscaleAddress('100.64.0.1'), true);
  assert.equal(isTailscaleAddress('100.127.255.254'), true);
  assert.equal(isTailscaleAddress('100.128.0.1'), false);
  assert.equal(isTailscaleAddress('fd7a:115c:a1e0::1234'), true);
  assert.equal(isTailscaleAddress('fd7a:115c:a1e1::1'), false);
  assert.throws(() => normalizeAccessPolicy({
    mode: 'tailscale', tailnetHostname: '*.ts.net', allowedUsers: [USER],
  }), { code: 'TAILNET_HOST_INVALID' });
  assert.throws(() => normalizeAccessPolicy({
    mode: 'tailscale', tailnetHostname: HOSTNAME, allowedUsers: [],
  }), { code: 'TAILNET_USER_REQUIRED' });
  assert.equal(normalizeAccessPolicy({ mode: 'local' }).mode, 'local');
});

test('remote security context authenticates an allowlisted Serve user without exposing profile data', async (t) => {
  const { base } = await serverFixture(t, {
    accessGuardOptions: { randomBytes: () => Buffer.alloc(32, 7) },
  });
  const response = await remoteFetch(base, '/api/security-context');
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const body = await response.json();
  assert.deepEqual(body.remoteIdentity, { login: USER, name: null });
  assert.equal(body.accessMode, 'tailscale');
  assert.equal(body.csrfRequired, true);
  assert.equal(body.csrfHeader, 'X-AI-Council-CSRF');
  assert.equal(typeof body.csrfToken, 'string');
  assert.equal(JSON.stringify(body).includes('Profile'), false);

  const alias = await remoteFetch(base, '/api/access');
  assert.equal(alias.status, 200);
  assert.equal((await alias.json()).csrfToken, body.csrfToken);
});

test('cross-site phone navigation may enter the UI but cannot reach APIs or masquerade as a subresource', async (t) => {
  const { base } = await serverFixture(t);
  const navigationHeaders = {
    'sec-fetch-site': 'cross-site',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-dest': 'document',
    'sec-fetch-user': '?1',
  };

  for (const route of ['/', '/index.html']) {
    const response = await remoteFetch(base, route, { headers: navigationHeaders });
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    assert.match(await response.text(), /Hanmir AI Council/);
  }

  const apiNavigation = await remoteFetch(base, '/api/state', { headers: navigationHeaders });
  assert.equal(apiNavigation.status, 403);
  assert.equal((await apiNavigation.json()).error.code, 'CROSS_SITE_REQUEST');

  const embeddedRoot = await remoteFetch(base, '/', {
    headers: {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'no-cors',
      'sec-fetch-dest': 'image',
    },
  });
  assert.equal(embeddedRoot.status, 403);
  assert.equal((await embeddedRoot.json()).error.code, 'CROSS_SITE_REQUEST');

  const crossSitePost = await remoteFetch(base, '/', {
    method: 'POST',
    headers: {
      'sec-fetch-site': 'cross-site',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-dest': 'document',
      'content-type': 'application/json',
    },
    body: '{}',
  });
  assert.equal(crossSitePost.status, 403);
  assert.equal((await crossSitePost.json()).error.code, 'CROSS_SITE_REQUEST');
});

test('remote SSE and POST work only with Serve identity, exact Origin, session, and CSRF', async (t) => {
  const { base, store } = await serverFixture(t);
  const context = await (await remoteFetch(base, '/api/security-context')).json();
  const stream = await remoteFetch(base, '/stream', { stream: true });
  assert.equal(stream.status, 200);
  assert.match(stream.headers.get('content-type'), /text\/event-stream/);
  stream.destroy();

  const mutationHeaders = serveHeaders({
    origin: `https://${HOSTNAME}`,
    'content-type': 'application/json',
    'x-ai-council-session': store.get().sessionKey,
    'x-ai-council-csrf': context.csrfToken,
  });
  const accepted = await rawRequest(base, '/api/cancel', {
    method: 'POST', headers: mutationHeaders, body: '{}',
  });
  assert.equal(accepted.status, 202);

  const noOriginHeaders = { ...mutationHeaders };
  delete noOriginHeaders.origin;
  const noOrigin = await rawRequest(base, '/api/cancel', {
    method: 'POST', headers: noOriginHeaders, body: '{}',
  });
  assert.equal(noOrigin.status, 403);
  assert.equal((await noOrigin.json()).error.code, 'ORIGIN_REQUIRED');

  const noCsrfHeaders = { ...mutationHeaders };
  delete noCsrfHeaders['x-ai-council-csrf'];
  const noCsrf = await rawRequest(base, '/api/cancel', {
    method: 'POST', headers: noCsrfHeaders, body: '{}',
  });
  assert.equal(noCsrf.status, 403);
  assert.equal((await noCsrf.json()).error.code, 'CSRF_TOKEN_INVALID');
});

test('remote boundary rejects spoofing, Funnel, wrong identity, host, origin, and forwarded chains', async (t) => {
  const { base } = await serverFixture(t);
  const cases = [
    [{ host: 'attacker.ts.net' }, 'TAILNET_HOST_MISMATCH'],
    [{ 'x-forwarded-host': 'attacker.ts.net' }, 'FORWARDED_HOST_MISMATCH'],
    [{ 'x-forwarded-proto': 'http' }, 'FORWARDED_PROTO_INVALID'],
    [{ 'x-forwarded-for': '192.168.1.20' }, 'FORWARDED_CLIENT_INVALID'],
    [{ 'x-forwarded-for': '100.100.10.20, 100.100.10.21' }, 'FORWARDED_CLIENT_INVALID'],
    [{ 'tailscale-user-login': 'intruder@example.com' }, 'TAILSCALE_USER_FORBIDDEN'],
    [{ 'tailscale-headers-info': 'spoofed' }, 'TAILSCALE_IDENTITY_UNVERIFIED'],
    [{ 'tailscale-funnel-request': '?1' }, 'FUNNEL_FORBIDDEN'],
    [{ forwarded: 'for=100.100.10.20;proto=https' }, 'UNTRUSTED_FORWARDED_HEADER'],
    [{ 'x-forwarded-prefix': '/evil' }, 'UNTRUSTED_PROXY_HEADERS'],
    [{ origin: 'https://attacker.example' }, 'ORIGIN_MISMATCH'],
  ];
  for (const [override, code] of cases) {
    const response = await remoteFetch(base, '/api/state', { headers: override });
    assert.equal(response.status, 403, code);
    assert.equal((await response.json()).error.code, code);
  }

  const localSpoof = await fetch(`${base}/api/state`, {
    headers: {
      host: `127.0.0.1:${new URL(base).port}`,
      'x-forwarded-for': '100.100.10.20',
      'tailscale-user-login': USER,
    },
  });
  assert.equal(localSpoof.status, 403);
  assert.equal((await localSpoof.json()).error.code, 'UNTRUSTED_PROXY_HEADERS');
});

test('per-user remote mutation limiter returns Retry-After without affecting localhost mode', async (t) => {
  let timestamp = 1_000_000;
  const { base, store } = await serverFixture(t, {
    mutationLimit: 2,
    accessGuardOptions: { clock: () => timestamp },
  });
  const context = await (await remoteFetch(base, '/api/security-context')).json();
  const headers = serveHeaders({
    origin: `https://${HOSTNAME}`,
    'content-type': 'application/json',
    'x-ai-council-session': store.get().sessionKey,
    'x-ai-council-csrf': context.csrfToken,
  });
  for (let index = 0; index < 2; index += 1) {
    assert.equal((await rawRequest(base, '/api/cancel', { method: 'POST', headers, body: '{}' })).status, 202);
  }
  const limited = await rawRequest(base, '/api/cancel', { method: 'POST', headers, body: '{}' });
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '60');
  timestamp += 60_001;
  assert.equal((await rawRequest(base, '/api/cancel', { method: 'POST', headers, body: '{}' })).status, 202);

  const localStore = fixture(t);
  const localApp = createApp({ store: localStore, engine: inertEngine(), accessPolicy: { mode: 'local' } });
  const localServer = await new Promise((resolve) => {
    const instance = localApp.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => { localApp.locals.closeStreams(); localServer.close(resolve); }));
  const localBase = `http://127.0.0.1:${localServer.address().port}`;
  const local = await fetch(`${localBase}/api/cancel`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-ai-council-session': localStore.get().sessionKey,
    },
    body: '{}',
  });
  assert.equal(local.status, 202);
});

test('Tailscale status preflight extracts Self DNS/user and fails closed when logged out or mismatched', () => {
  const running = {
    BackendState: 'Running',
    Self: { DNSName: `${HOSTNAME}.`, UserID: 42, Online: true },
    User: { 42: { LoginName: USER } },
  };
  assert.deepEqual(evaluateTailscalePreflight(running), {
    ok: true,
    backendState: 'Running',
    hostname: HOSTNAME,
    selfUser: USER,
    allowedUsers: [USER],
    errors: [],
  });
  assert.equal(evaluateTailscalePreflight({ BackendState: 'NeedsLogin' }).ok, false);
  const mismatch = evaluateTailscalePreflight(running, { expectedHostname: 'other.example-tailnet.ts.net' });
  assert.equal(mismatch.ok, false);
  assert.ok(mismatch.errors.some((error) => error.code === 'TAILNET_HOST_MISMATCH'));
});

test('launcher is opt-in, loopback-only, identity allowlisted, and never enables Funnel or resets config', () => {
  const scriptsDir = path.join(__dirname, '..', 'scripts');
  const script = fs.readFileSync(path.join(scriptsDir, 'start-tailscale.ps1'), 'utf8');
  const safeScript = fs.readFileSync(path.join(scriptsDir, 'start-low-privilege.ps1'), 'utf8');
  assert.match(script, /AI_COUNCIL_ACCESS_MODE\s*=\s*'tailscale'/);
  assert.match(script, /AI_COUNCIL_HOST\s*=\s*'127\.0\.0\.1'/);
  assert.match(script, /Self.*DNSName|DNSName/s);
  assert.match(script, /UserID/);
  assert.match(script, /LoginName/);
  assert.match(script, /AllowedUser/);
  assert.match(script, /Program Files|ProgramFiles/);
  assert.match(script, /serve --bg --yes \$target/);
  assert.match(script, /serve --https=443 off/);
  assert.doesNotMatch(script, /tailscalePath funnel|serve reset/i);
  assert.ok(script.indexOf('& node $server') < script.indexOf('exit $nodeExitCode'));
  assert.match(safeScript, /AI_COUNCIL_ACCESS_MODE\s*=\s*'local'/);
  assert.match(safeScript, /Remove-Item Env:AI_COUNCIL_TAILNET_HOSTNAME/);
});

test('Windows PowerShell default launcher path reaches Tailscale preflight without ProjectPath', {
  skip: process.platform !== 'win32',
}, (t) => {
  const emptyTools = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-council-empty-path-'));
  t.after(() => fs.rmSync(emptyTools, { recursive: true, force: true }));
  // Windows PowerShell restores ProgramFiles from the machine even when the
  // child environment overrides it. Put a harmless system executable first on
  // PATH under the expected name so the launcher reaches status preflight but
  // can never touch the installed Tailscale configuration.
  fs.copyFileSync(
    path.join(process.env.SystemRoot, 'System32', 'where.exe'),
    path.join(emptyTools, 'tailscale.exe'),
  );
  const powershell = path.join(
    process.env.SystemRoot,
    'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe',
  );
  const launcher = path.join(__dirname, '..', 'scripts', 'start-tailscale.ps1');
  const isolatedEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => (
    !['path', 'programfiles', 'programfiles(x86)'].includes(key.toLowerCase())
  )));
  const result = spawnSync(powershell, [
    '-NoLogo', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher,
  ], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    env: {
      ...isolatedEnv,
      Path: emptyTools,
      ProgramFiles: emptyTools,
      'ProgramFiles(x86)': emptyTools,
    },
    windowsHide: true,
    timeout: 15_000,
  });
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.notEqual(result.status, 0);
  assert.match(output, /tailscale status --json failed with exit code/i);
  assert.doesNotMatch(output, /Split-Path.*empty string|Cannot bind argument.*Path/i);
});

test('server startup refuses non-loopback binding even when called directly', () => {
  assert.throws(() => startServer({ host: '0.0.0.0', port: 0 }), /refuses non-loopback binding/);
});
