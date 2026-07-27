'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  evaluateIsolationPreflight,
  identityMatches,
  inspectCurrentToken,
  isLoopbackHost,
  isUncPath,
  parseWindowsGroups,
} = require('../lib/os-isolation');
const { parseArgs } = require('../scripts/isolation-preflight');

function projectFixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-council-isolation-'));
  fs.writeFileSync(path.join(dir, 'server.js'), '', 'utf8');
  fs.writeFileSync(path.join(dir, 'package.json'), '{}', 'utf8');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function token(overrides = {}) {
  return {
    platform: 'win32',
    identity: 'DESKTOP\\worker',
    detected: true,
    integrityRid: 8192,
    integrityLevel: 'medium',
    isElevated: false,
    isAdministratorsMember: false,
    ...overrides,
  };
}

test('Windows group parsing uses stable SIDs for integrity and admin membership', () => {
  const parsed = parseWindowsGroups([
    '"BUILTIN\\Administrators","Alias","S-1-5-32-544","Group used for deny only"',
    '"Mandatory Label\\High Mandatory Level","Label","S-1-16-12288",""',
  ].join('\r\n'));
  assert.deepEqual(parsed, {
    integrityRid: 12288,
    integrityLevel: 'high',
    isElevated: true,
    isAdministratorsMember: true,
  });
});

test('Windows token inspection fails closed when whoami cannot be executed', () => {
  const inspected = inspectCurrentToken({
    platform: 'win32',
    execFileSyncImpl() { throw new Error('blocked'); },
  });
  assert.equal(inspected.detected, false);
  assert.equal(inspected.isElevated, null);
  assert.match(inspected.detectionError, /blocked/);
});

test('standard-user profile passes a medium token and warns about same-user access', (t) => {
  const report = evaluateIsolationPreflight({
    profile: 'standard-user',
    projectRoot: projectFixture(t),
    host: '127.0.0.1',
    platform: 'win32',
    nodeVersion: '20.11.1',
    token: token({ isAdministratorsMember: true }),
    cliChecks: [{ name: 'Claude CLI', ok: true }, { name: 'Codex CLI', ok: true }],
  });
  assert.equal(report.ok, true);
  assert.deepEqual(report.errors, []);
  assert.ok(report.warnings.some((warning) => warning.code === 'SAME_USER_BOUNDARY'));
});

test('preflight rejects elevation, remote binding, missing CLI and network project without probing SMB', () => {
  let fsProbeCount = 0;
  const report = evaluateIsolationPreflight({
    profile: 'standard-user',
    projectRoot: '\\\\server\\share\\ai-council',
    host: '0.0.0.0',
    platform: 'win32',
    nodeVersion: '20.11.1',
    token: token({ integrityRid: 12288, integrityLevel: 'high', isElevated: true }),
    cliChecks: [{ name: 'Claude CLI', ok: false, message: 'missing' }],
    fsImpl: new Proxy({}, {
      get() {
        fsProbeCount += 1;
        throw new Error('UNC filesystem must not be probed');
      },
    }),
  });
  const codes = new Set(report.errors.map((error) => error.code));
  assert.equal(report.ok, false);
  assert.ok(codes.has('ELEVATED_TOKEN'));
  assert.ok(codes.has('NON_LOOPBACK_HOST'));
  assert.ok(codes.has('NETWORK_PROJECT'));
  assert.ok(codes.has('CLI_UNAVAILABLE'));
  assert.equal(fsProbeCount, 0);
});

test('dedicated-user requires the target identity and rejects admin membership', (t) => {
  const projectRoot = projectFixture(t);
  const mismatch = evaluateIsolationPreflight({
    profile: 'dedicated-user', projectRoot, host: '127.0.0.1', platform: 'win32',
    nodeVersion: '24.0.0', expectedUser: '.\\other', env: { COMPUTERNAME: 'DESKTOP' }, token: token(),
  });
  assert.ok(mismatch.errors.some((error) => error.code === 'IDENTITY_MISMATCH'));

  const admin = evaluateIsolationPreflight({
    profile: 'dedicated-user', projectRoot, host: '127.0.0.1', platform: 'win32',
    nodeVersion: '24.0.0', expectedUser: '.\\worker', env: { COMPUTERNAME: 'DESKTOP' },
    token: token({ isAdministratorsMember: true }),
  });
  assert.ok(admin.errors.some((error) => error.code === 'ADMIN_GROUP_MEMBER'));
});

test('sandbox-vm never claims a strong boundary from inside the local process', (t) => {
  const report = evaluateIsolationPreflight({
    profile: 'sandbox-vm', projectRoot: projectFixture(t), host: '127.0.0.1',
    platform: 'win32', nodeVersion: '24.0.0', token: token(),
  });
  assert.equal(report.ok, false);
  assert.ok(report.errors.some((error) => error.code === 'EXTERNAL_BOUNDARY_REQUIRED'));
});

test('identity, loopback, UNC and CLI argument helpers are strict', () => {
  assert.equal(identityMatches('DESKTOP\\Worker', '.\\worker', { COMPUTERNAME: 'DESKTOP' }), true);
  assert.equal(identityMatches('DOMAIN\\Worker', 'worker', {}), true);
  assert.equal(identityMatches('DOMAIN\\Worker', 'OTHER\\worker', {}), false);
  assert.equal(isLoopbackHost('127.0.0.1'), true);
  assert.equal(isLoopbackHost('localhost'), false);
  assert.equal(isUncPath('\\\\host\\share', 'win32'), true);
  assert.equal(isUncPath('C:\\AI-Council', 'win32'), false);

  const options = parseArgs([
    '--profile', 'dedicated-user', '--project', '.', '--host', '127.0.0.1',
    '--expected-user', '.\\worker', '--no-cli', '--json',
  ]);
  assert.equal(options.profile, 'dedicated-user');
  assert.equal(options.expectedUser, '.\\worker');
  assert.equal(options.checkClis, false);
  assert.equal(options.json, true);
});

test('PowerShell launchers gate server startup and never mutate accounts or ACLs', () => {
  const root = path.resolve(__dirname, '..');
  const standard = fs.readFileSync(path.join(root, 'scripts', 'start-low-privilege.ps1'), 'utf8');
  const dedicated = fs.readFileSync(path.join(root, 'scripts', 'start-dedicated-user.ps1'), 'utf8');
  assert.ok(standard.indexOf('isolation-preflight.js') < standard.indexOf('& node $server'));
  assert.match(standard, /AI_COUNCIL_HOST\s*=\s*'127\.0\.0\.1'/);
  assert.match(dedicated, /Get-Credential/);
  assert.match(dedicated, /-Credential \$credential/);
  for (const script of [standard, dedicated]) {
    assert.doesNotMatch(script, /\b(?:New-LocalUser|Add-LocalGroupMember|Set-Acl|icacls|net\s+user)\b/i);
    assert.doesNotMatch(script, /ConvertFrom-SecureString|Export-Clixml/i);
  }
});
