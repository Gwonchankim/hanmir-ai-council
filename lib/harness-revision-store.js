'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');
const { ROLE_KEYS, normalizeHarnessSet } = require('../harnesses');

const RECORD_SCHEMA_VERSION = 1;
const RECORD_KIND = 'ai-council-harness-revision';
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const REVISION_FILE_PATTERN = /^(\d{16})\.json$/;
const RECORD_KEYS = new Set([
  'schemaVersion', 'kind', 'sessionId', 'revision', 'source', 'cycle',
  'updatedAt', 'changedRoles', 'harnesses', 'digest',
]);

class HarnessRevisionStoreError extends Error {
  constructor(message, { code = 'HARNESS_REVISION_STORE_ERROR', status = 500, cause } = {}) {
    super(message, { cause });
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
  }
}

class HarnessRevisionValidationError extends HarnessRevisionStoreError {
  constructor(message, options = {}) {
    super(message, { code: 'HARNESS_REVISION_INVALID', status: 400, ...options });
  }
}

class HarnessRevisionIntegrityError extends HarnessRevisionStoreError {
  constructor(message, options = {}) {
    super(message, { code: 'HARNESS_REVISION_TAMPERED', status: 422, ...options });
  }
}

class HarnessRevisionNotFoundError extends HarnessRevisionStoreError {
  constructor(sessionId, revision) {
    super(`Harness revision ${revision} was not found for session ${sessionId}.`, {
      code: 'HARNESS_REVISION_NOT_FOUND',
      status: 404,
    });
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => (
    `${JSON.stringify(key)}:${stableStringify(value[key])}`
  )).join(',')}}`;
}

function digestRecord(recordWithoutDigest) {
  return crypto.createHash('sha256').update(stableStringify(recordWithoutDigest), 'utf8').digest('hex');
}

function validateSessionId(sessionId) {
  const value = String(sessionId ?? '');
  if (!SESSION_ID_PATTERN.test(value)) {
    throw new HarnessRevisionValidationError(
      'sessionId must contain only 1-128 ASCII letters, digits, underscores, or hyphens, and must start with a letter or digit.',
      { code: 'HARNESS_REVISION_UNSAFE_SESSION' },
    );
  }
  return value;
}

function validateRevision(revision) {
  const value = Number(revision);
  if (!Number.isSafeInteger(value) || value < 0 || value > 9_999_999_999_999_999) {
    throw new HarnessRevisionValidationError('revision must be a non-negative safe integer.');
  }
  return value;
}

function revisionFilename(revision) {
  return `${String(validateRevision(revision)).padStart(16, '0')}.json`;
}

function normalizeChangedRoles(changedRoles) {
  if (!Array.isArray(changedRoles)) {
    throw new HarnessRevisionValidationError('changedRoles must be an array.');
  }
  const unique = [];
  for (const role of changedRoles) {
    if (!ROLE_KEYS.includes(role)) {
      throw new HarnessRevisionValidationError(`Unknown Harness role in changedRoles: ${role}`);
    }
    if (!unique.includes(role)) unique.push(role);
  }
  return unique;
}

function normalizeTimestamp(value) {
  const timestamp = value || new Date().toISOString();
  if (typeof timestamp !== 'string' || !Number.isFinite(Date.parse(timestamp))) {
    throw new HarnessRevisionValidationError('updatedAt must be a valid date-time string.');
  }
  return new Date(timestamp).toISOString();
}

function recordPayload(input) {
  const sessionId = validateSessionId(input.sessionId);
  const revision = validateRevision(input.revision);
  const cycle = Number(input.cycle ?? input.harnesses?.cycle ?? 0);
  if (!Number.isSafeInteger(cycle) || cycle < 0) {
    throw new HarnessRevisionValidationError('cycle must be a non-negative safe integer.');
  }
  const source = String(input.source ?? 'unknown').trim();
  if (!source || Buffer.byteLength(source, 'utf8') > 128) {
    throw new HarnessRevisionValidationError('source must contain 1-128 UTF-8 bytes.');
  }
  let harnesses;
  try {
    harnesses = normalizeHarnessSet(input.harnesses, { cycle, requireAll: true });
  } catch (error) {
    throw new HarnessRevisionValidationError(`Invalid Harness set: ${error.message}`, { cause: error });
  }
  return {
    schemaVersion: RECORD_SCHEMA_VERSION,
    kind: RECORD_KIND,
    sessionId,
    revision,
    source,
    cycle,
    updatedAt: normalizeTimestamp(input.updatedAt),
    changedRoles: normalizeChangedRoles(input.changedRoles ?? ROLE_KEYS),
    harnesses,
  };
}

function buildRecord(input) {
  const payload = recordPayload(input);
  return { ...payload, digest: digestRecord(payload) };
}

function assertRecord(record, { expectedSessionId, expectedRevision } = {}) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw new HarnessRevisionIntegrityError('Harness revision file does not contain an object.');
  }
  const extras = Object.keys(record).filter((key) => !RECORD_KEYS.has(key));
  const missing = [...RECORD_KEYS].filter((key) => !Object.hasOwn(record, key));
  if (extras.length || missing.length) {
    throw new HarnessRevisionIntegrityError('Harness revision record schema does not match the supported format.');
  }
  if (record.schemaVersion !== RECORD_SCHEMA_VERSION || record.kind !== RECORD_KIND) {
    throw new HarnessRevisionIntegrityError('Harness revision record version or kind is invalid.');
  }

  let payload;
  try {
    payload = recordPayload(record);
  } catch (error) {
    throw new HarnessRevisionIntegrityError(`Harness revision record failed schema validation: ${error.message}`, {
      cause: error,
    });
  }
  if (expectedSessionId !== undefined && payload.sessionId !== validateSessionId(expectedSessionId)) {
    throw new HarnessRevisionIntegrityError('Harness revision session identity does not match its storage path.');
  }
  if (expectedRevision !== undefined && payload.revision !== validateRevision(expectedRevision)) {
    throw new HarnessRevisionIntegrityError('Harness revision number does not match its storage filename.');
  }
  if (stableStringify(payload.harnesses) !== stableStringify(record.harnesses)) {
    throw new HarnessRevisionIntegrityError('Harness revision body is not in canonical schema form.');
  }
  if (typeof record.digest !== 'string' || !/^[a-f0-9]{64}$/.test(record.digest)
      || !crypto.timingSafeEqual(Buffer.from(record.digest, 'hex'), Buffer.from(digestRecord(payload), 'hex'))) {
    throw new HarnessRevisionIntegrityError('Harness revision digest verification failed.');
  }
  return { ...payload, digest: record.digest };
}

function metadata(record, extras = {}) {
  return {
    sessionId: record.sessionId,
    revision: record.revision,
    source: record.source,
    cycle: record.cycle,
    updatedAt: record.updatedAt,
    changedRoles: [...record.changedRoles],
    digest: record.digest,
    available: true,
    integrity: 'verified',
    ...extras,
  };
}

function jsonChanges(before, after, pointer = '') {
  if (stableStringify(before) === stableStringify(after)) return [];
  const beforeObject = before !== null && typeof before === 'object' && !Array.isArray(before);
  const afterObject = after !== null && typeof after === 'object' && !Array.isArray(after);
  if (!beforeObject || !afterObject) {
    return [{ path: pointer || '/', type: 'modified', before: clone(before), after: clone(after) }];
  }
  const changes = [];
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  for (const key of keys) {
    const escaped = key.replace(/~/g, '~0').replace(/\//g, '~1');
    const childPath = `${pointer}/${escaped}`;
    if (!Object.hasOwn(before, key)) {
      changes.push({ path: childPath, type: 'added', after: clone(after[key]) });
    } else if (!Object.hasOwn(after, key)) {
      changes.push({ path: childPath, type: 'removed', before: clone(before[key]) });
    } else {
      changes.push(...jsonChanges(before[key], after[key], childPath));
    }
  }
  return changes;
}

class HarnessRevisionStore {
  constructor({
    rootDir = path.join(__dirname, '..', 'data', 'harness-revisions'),
    maxEntries = config.limits.harnessHistoryEntries,
    clock = () => new Date().toISOString(),
  } = {}) {
    const limit = Number(maxEntries);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      throw new HarnessRevisionValidationError('maxEntries must be an integer between 1 and 10000.');
    }
    this.rootDir = path.resolve(rootDir);
    this.maxEntries = limit;
    this.clock = clock;
    fs.mkdirSync(this.rootDir, { recursive: true });
    this.realRootDir = fs.realpathSync.native(this.rootDir);
  }

  _sessionDir(sessionId, { create = false } = {}) {
    const id = validateSessionId(sessionId);
    const target = path.resolve(this.rootDir, id);
    const relative = path.relative(this.rootDir, target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
      throw new HarnessRevisionValidationError('Unsafe Harness revision storage path.', {
        code: 'HARNESS_REVISION_UNSAFE_PATH',
      });
    }
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new HarnessRevisionValidationError('Harness revision session path is not a safe directory.', {
          code: 'HARNESS_REVISION_UNSAFE_PATH',
        });
      }
    } else if (create) {
      fs.mkdirSync(target, { recursive: false });
    } else {
      return target;
    }
    const realTarget = fs.realpathSync.native(target);
    const realRelative = path.relative(this.realRootDir, realTarget);
    if (!realRelative || realRelative.startsWith('..') || path.isAbsolute(realRelative)) {
      throw new HarnessRevisionValidationError('Harness revision session directory escapes its storage root.', {
        code: 'HARNESS_REVISION_UNSAFE_PATH',
      });
    }
    return target;
  }

  _revisionPath(sessionId, revision, { createSession = false } = {}) {
    return path.join(this._sessionDir(sessionId, { create: createSession }), revisionFilename(revision));
  }

  _readPath(filePath, expectedSessionId, expectedRevision) {
    let parsed;
    try {
      const stat = fs.lstatSync(filePath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new HarnessRevisionIntegrityError('Harness revision path is not a regular file.');
      }
      parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') throw new HarnessRevisionNotFoundError(expectedSessionId, expectedRevision);
      if (error instanceof HarnessRevisionIntegrityError) throw error;
      throw new HarnessRevisionIntegrityError('Harness revision file could not be parsed.', { cause: error });
    }
    return assertRecord(parsed, { expectedSessionId, expectedRevision });
  }

  _writeAtomic(filePath, record) {
    const data = `${JSON.stringify(record, null, 2)}\n`;
    const tempPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`,
    );
    let fd;
    try {
      fd = fs.openSync(tempPath, 'wx', 0o600);
      fs.writeFileSync(fd, data, 'utf8');
      fs.fsyncSync(fd);
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    try {
      try {
        fs.linkSync(tempPath, filePath);
      } catch (error) {
        if (error.code === 'EEXIST') throw error;
        if (!['EPERM', 'ENOTSUP', 'EXDEV'].includes(error.code)) throw error;
        if (fs.existsSync(filePath)) {
          const exists = new Error('Harness revision already exists.');
          exists.code = 'EEXIST';
          throw exists;
        }
        fs.renameSync(tempPath, filePath);
      }
    } finally {
      try { fs.rmSync(tempPath, { force: true }); } catch (_) {}
    }
  }

  _revisionFiles(sessionId) {
    const dir = this._sessionDir(sessionId);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && REVISION_FILE_PATTERN.test(entry.name))
      .map((entry) => ({
        revision: Number(entry.name.match(REVISION_FILE_PATTERN)[1]),
        path: path.join(dir, entry.name),
      }))
      .sort((a, b) => a.revision - b.revision);
  }

  _prune(sessionId) {
    const files = this._revisionFiles(sessionId);
    const doomed = files.slice(0, Math.max(0, files.length - this.maxEntries));
    for (const item of doomed) fs.rmSync(item.path, { force: true });
    return doomed.map((item) => item.revision);
  }

  saveRevision(input) {
    const sessionId = validateSessionId(input.sessionId);
    const revision = validateRevision(input.revision);
    const filePath = this._revisionPath(sessionId, revision, { createSession: true });
    if (fs.existsSync(filePath)) {
      const existing = this._readPath(filePath, sessionId, revision);
      const record = buildRecord({
        ...input,
        sessionId,
        revision,
        updatedAt: input.updatedAt || existing.updatedAt,
      });
      if (existing.digest !== record.digest) {
        throw new HarnessRevisionStoreError(
          `Harness revision ${record.revision} is immutable and already contains different data.`,
          { code: 'HARNESS_REVISION_CONFLICT', status: 409 },
        );
      }
      return { record: metadata(existing), created: false, pruned: [] };
    }
    const record = buildRecord({
      ...input,
      sessionId,
      revision,
      updatedAt: input.updatedAt || this.clock(),
    });
    try {
      this._writeAtomic(filePath, record);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = this._readPath(filePath, record.sessionId, record.revision);
      if (existing.digest !== record.digest) {
        throw new HarnessRevisionStoreError(
          `Harness revision ${record.revision} was concurrently written with different data.`,
          { code: 'HARNESS_REVISION_CONFLICT', status: 409, cause: error },
        );
      }
      return { record: metadata(existing), created: false, pruned: [] };
    }
    return { record: metadata(record), created: true, pruned: this._prune(record.sessionId) };
  }

  seedLegacyCurrent(input) {
    const sessionId = validateSessionId(input.sessionId);
    const revision = validateRevision(input.revision);
    const filePath = this._revisionPath(sessionId, revision);
    if (fs.existsSync(filePath)) {
      const existing = this._readPath(filePath, sessionId, revision);
      const candidate = buildRecord({
        ...input,
        sessionId,
        revision,
        source: input.source || 'legacy-seed',
        updatedAt: input.updatedAt || existing.updatedAt,
      });
      if (stableStringify(existing.harnesses) !== stableStringify(candidate.harnesses)) {
        throw new HarnessRevisionStoreError(
          'The stored Harness revision does not match the legacy current Harness set.',
          { code: 'HARNESS_REVISION_CONFLICT', status: 409 },
        );
      }
      return { record: metadata(existing), seeded: false, pruned: [] };
    }
    const saved = this.saveRevision({ ...input, sessionId, revision, source: input.source || 'legacy-seed' });
    return { ...saved, seeded: saved.created };
  }

  getRevision(sessionId, revision) {
    const id = validateSessionId(sessionId);
    const number = validateRevision(revision);
    const filePath = this._revisionPath(id, number);
    if (!fs.existsSync(filePath)) throw new HarnessRevisionNotFoundError(id, number);
    return clone(this._readPath(filePath, id, number));
  }

  listRevisions(sessionId, { history = [] } = {}) {
    const id = validateSessionId(sessionId);
    if (!Array.isArray(history)) throw new HarnessRevisionValidationError('history must be an array.');
    const result = new Map();
    for (const entry of history) {
      if (!entry || !Number.isSafeInteger(Number(entry.revision)) || Number(entry.revision) < 0) continue;
      const revision = Number(entry.revision);
      result.set(revision, {
        sessionId: id,
        revision,
        source: typeof entry.source === 'string' ? entry.source : 'unknown',
        cycle: Number.isSafeInteger(Number(entry.cycle)) ? Number(entry.cycle) : null,
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : null,
        changedRoles: Array.isArray(entry.changedRoles)
          ? entry.changedRoles.filter((role) => ROLE_KEYS.includes(role)) : [],
        digest: typeof entry.digest === 'string' ? entry.digest : null,
        available: false,
        integrity: 'missing',
      });
    }
    for (const item of this._revisionFiles(id)) {
      try {
        const record = this._readPath(item.path, id, item.revision);
        result.set(item.revision, metadata(record));
      } catch (error) {
        if (!(error instanceof HarnessRevisionIntegrityError)) throw error;
        const prior = result.get(item.revision) || { sessionId: id, revision: item.revision };
        result.set(item.revision, {
          ...prior,
          available: false,
          integrity: 'invalid',
          digest: null,
        });
      }
    }
    return [...result.values()].sort((a, b) => b.revision - a.revision);
  }

  diffRevisions(sessionId, fromRevision, toRevision, { role = 'all' } = {}) {
    const id = validateSessionId(sessionId);
    if (role !== 'all' && !ROLE_KEYS.includes(role)) {
      throw new HarnessRevisionValidationError(`role must be "all" or one of: ${ROLE_KEYS.join(', ')}.`);
    }
    const before = this.getRevision(id, fromRevision);
    const after = this.getRevision(id, toRevision);
    const roles = role === 'all' ? ROLE_KEYS : [role];
    const changesByRole = Object.fromEntries(roles.map((key) => [
      key,
      jsonChanges(before.harnesses[key], after.harnesses[key]),
    ]));
    const changedRoles = roles.filter((key) => changesByRole[key].length > 0);
    const base = {
      sessionId: id,
      fromRevision: before.revision,
      toRevision: after.revision,
      role,
      changedRoles,
    };
    return role === 'all'
      ? { ...base, changesByRole }
      : { ...base, changes: changesByRole[role] };
  }
}

module.exports = {
  HarnessRevisionStore,
  HarnessRevisionStoreError,
  HarnessRevisionValidationError,
  HarnessRevisionIntegrityError,
  HarnessRevisionNotFoundError,
  RECORD_SCHEMA_VERSION,
  RECORD_KIND,
  revisionFilename,
  digestRecord,
};
