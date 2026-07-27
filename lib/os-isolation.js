'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const WINDOWS_INTEGRITY = Object.freeze({
  untrusted: 0,
  low: 4096,
  medium: 8192,
  high: 12288,
  system: 16384,
  protected: 20480,
});

const ISOLATION_PROFILES = Object.freeze([
  'standard-user',
  'dedicated-user',
  'sandbox-vm',
]);

function runIdentityCommand(command, args, execFileSyncImpl = execFileSync) {
  return String(execFileSyncImpl(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }) || '').trim();
}

function integrityName(rid) {
  if (!Number.isFinite(rid)) return 'unknown';
  if (rid >= WINDOWS_INTEGRITY.protected) return 'protected';
  if (rid >= WINDOWS_INTEGRITY.system) return 'system';
  if (rid >= WINDOWS_INTEGRITY.high) return 'high';
  if (rid >= WINDOWS_INTEGRITY.medium) return 'medium';
  if (rid >= WINDOWS_INTEGRITY.low) return 'low';
  return 'untrusted';
}

function parseWindowsGroups(output) {
  const text = String(output || '');
  const integrityRids = Array.from(text.matchAll(/S-1-16-(\d+)/gi), (match) => Number(match[1]))
    .filter(Number.isFinite);
  const integrityRid = integrityRids.length ? Math.max(...integrityRids) : null;
  return {
    integrityRid,
    integrityLevel: integrityName(integrityRid),
    isElevated: Number.isFinite(integrityRid) && integrityRid >= WINDOWS_INTEGRITY.high,
    isAdministratorsMember: /S-1-5-32-544(?:\D|$)/i.test(text),
  };
}

function inspectCurrentToken({
  platform = process.platform,
  env = process.env,
  execFileSyncImpl = execFileSync,
  getuid = typeof process.getuid === 'function' ? () => process.getuid() : null,
} = {}) {
  if (platform === 'win32') {
    try {
      const groups = runIdentityCommand(
        'whoami.exe',
        ['/groups', '/fo', 'csv', '/nh'],
        execFileSyncImpl,
      );
      const identity = runIdentityCommand('whoami.exe', [], execFileSyncImpl);
      return {
        platform,
        identity,
        detected: true,
        ...parseWindowsGroups(groups),
      };
    } catch (error) {
      return {
        platform,
        identity: '',
        detected: false,
        integrityRid: null,
        integrityLevel: 'unknown',
        isElevated: null,
        isAdministratorsMember: null,
        detectionError: error && error.message ? error.message : String(error),
      };
    }
  }

  const uid = getuid ? getuid() : null;
  const identity = String(env.USER || env.LOGNAME || env.USERNAME || '').trim();
  return {
    platform,
    identity,
    detected: Number.isInteger(uid),
    uid,
    integrityRid: null,
    integrityLevel: uid === 0 ? 'root' : (Number.isInteger(uid) ? 'standard' : 'unknown'),
    isElevated: Number.isInteger(uid) ? uid === 0 : null,
    isAdministratorsMember: Number.isInteger(uid) ? uid === 0 : null,
  };
}

function isLoopbackHost(value) {
  const host = String(value || '').trim().toLowerCase();
  return host === '127.0.0.1' || host === '::1' || host === '[::1]';
}

function isUncPath(value, platform = process.platform) {
  if (platform !== 'win32') return false;
  return /^(?:\\\\|\/\/)/.test(String(value || '').trim());
}

function identityMatches(actual, expected, env = process.env) {
  const normalize = (value) => String(value || '').trim().replace(/\//g, '\\').toLowerCase();
  const actualValue = normalize(actual);
  let expectedValue = normalize(expected);
  if (!actualValue || !expectedValue) return false;
  if (expectedValue.startsWith('.\\')) {
    expectedValue = `${normalize(env.COMPUTERNAME)}\\${expectedValue.slice(2)}`;
  }
  if (actualValue === expectedValue) return true;
  if (!expectedValue.includes('\\')) return actualValue.split('\\').at(-1) === expectedValue;
  return false;
}

function pathAccess(projectRoot, fsImpl = fs) {
  const resolved = path.resolve(projectRoot);
  const result = {
    requested: projectRoot,
    resolved,
    exists: false,
    readable: false,
    writable: false,
    hasServer: false,
    hasPackage: false,
  };
  try {
    result.exists = fsImpl.statSync(resolved).isDirectory();
    fsImpl.accessSync(resolved, fs.constants.R_OK);
    result.readable = true;
    fsImpl.accessSync(resolved, fs.constants.W_OK);
    result.writable = true;
    result.hasServer = fsImpl.statSync(path.join(resolved, 'server.js')).isFile();
    result.hasPackage = fsImpl.statSync(path.join(resolved, 'package.json')).isFile();
  } catch (_) {
    // The individual flags above intentionally retain the last proven state.
  }
  return result;
}

function evaluateIsolationPreflight({
  profile = 'standard-user',
  projectRoot = path.resolve(__dirname, '..'),
  host = process.env.AI_COUNCIL_HOST || '127.0.0.1',
  expectedUser = process.env.AI_COUNCIL_EXPECTED_USER || '',
  platform = process.platform,
  env = process.env,
  nodeVersion = process.versions.node,
  token = inspectCurrentToken({ platform, env }),
  cliChecks = [],
  fsImpl = fs,
} = {}) {
  const errors = [];
  const warnings = [];
  const addError = (code, message) => errors.push({ code, message });
  const addWarning = (code, message) => warnings.push({ code, message });
  const networkProject = isUncPath(projectRoot, platform);
  // Never probe a caller-supplied UNC path. Even a read-only stat can initiate
  // outbound SMB authentication before the preflight has a chance to reject it.
  const project = networkProject
    ? {
      requested: projectRoot,
      resolved: String(projectRoot),
      exists: false,
      readable: false,
      writable: false,
      hasServer: false,
      hasPackage: false,
    }
    : pathAccess(projectRoot, fsImpl);

  if (!ISOLATION_PROFILES.includes(profile)) {
    addError('UNKNOWN_PROFILE', `Unknown isolation profile: ${profile}`);
  }

  const nodeMajor = Number.parseInt(String(nodeVersion || '').split('.')[0], 10);
  if (!Number.isFinite(nodeMajor) || nodeMajor < 20) {
    addError('NODE_VERSION', `Node.js 20 or newer is required (detected: ${nodeVersion || 'unknown'}).`);
  }
  if (!isLoopbackHost(host)) {
    addError('NON_LOOPBACK_HOST', `The isolated launcher only permits loopback binding, not ${host || '(empty)'}.`);
  }
  if (networkProject) {
    addError('NETWORK_PROJECT', 'The project must run from a local disk, not a UNC/network path.');
  }
  if (!project.exists || !project.readable || !project.hasServer || !project.hasPackage) {
    addError('PROJECT_INVALID', 'The project directory must be readable and contain server.js and package.json.');
  }
  if (!project.writable) {
    addError('PROJECT_READ_ONLY', 'The selected identity cannot persist checkpoints in the project directory.');
  }

  if (profile === 'sandbox-vm') {
    addError(
      'EXTERNAL_BOUNDARY_REQUIRED',
      'Windows Sandbox/VM isolation must be started outside this process; the local launcher cannot attest that boundary.',
    );
  } else {
    if (!token || !token.detected || token.isElevated === null) {
      addError('TOKEN_UNKNOWN', 'The launcher could not verify the current OS security token.');
    } else if (token.isElevated) {
      addError('ELEVATED_TOKEN', 'Refusing to run from an elevated/root security token.');
    }

    if (profile === 'standard-user') {
      addWarning(
        'SAME_USER_BOUNDARY',
        'This profile removes elevation risk but retains the current user\'s file permissions; use a dedicated user or VM for stronger isolation.',
      );
    }

    if (profile === 'dedicated-user') {
      if (!expectedUser) {
        addError('EXPECTED_USER_REQUIRED', 'The dedicated-user profile requires an expected OS identity.');
      } else if (!identityMatches(token && token.identity, expectedUser, env)) {
        addError(
          'IDENTITY_MISMATCH',
          `Current identity ${token && token.identity ? token.identity : '(unknown)'} does not match ${expectedUser}.`,
        );
      }
      if (token && token.isAdministratorsMember) {
        addError('ADMIN_GROUP_MEMBER', 'The dedicated AI Council account must not belong to the local Administrators group.');
      }
    }
  }

  for (const check of cliChecks) {
    if (!check || check.ok !== true) {
      addError(
        'CLI_UNAVAILABLE',
        `${check && check.name ? check.name : 'Required CLI'} is unavailable${check && check.message ? `: ${check.message}` : '.'}`,
      );
    }
  }

  return {
    ok: errors.length === 0,
    profile,
    host,
    platform,
    nodeVersion,
    project,
    token: token ? {
      identity: token.identity,
      detected: token.detected,
      integrityRid: token.integrityRid,
      integrityLevel: token.integrityLevel,
      isElevated: token.isElevated,
      isAdministratorsMember: token.isAdministratorsMember,
    } : null,
    cliChecks,
    errors,
    warnings,
  };
}

module.exports = {
  ISOLATION_PROFILES,
  WINDOWS_INTEGRITY,
  evaluateIsolationPreflight,
  identityMatches,
  inspectCurrentToken,
  integrityName,
  isLoopbackHost,
  isUncPath,
  parseWindowsGroups,
  pathAccess,
};
