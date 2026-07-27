#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { resolveClaudeBin } = require('../adapters/claude');
const { resolveCodexBin } = require('../adapters/codex');
const { evaluateIsolationPreflight, inspectCurrentToken } = require('../lib/os-isolation');

function parseArgs(argv) {
  const options = {
    profile: 'standard-user',
    projectRoot: path.resolve(__dirname, '..'),
    host: process.env.AI_COUNCIL_HOST || '127.0.0.1',
    expectedUser: process.env.AI_COUNCIL_EXPECTED_USER || '',
    checkClis: true,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (index >= argv.length) throw new Error(`${arg} requires a value.`);
      return argv[index];
    };
    if (arg === '--profile') options.profile = next();
    else if (arg === '--project') options.projectRoot = path.resolve(next());
    else if (arg === '--host') options.host = next();
    else if (arg === '--expected-user') options.expectedUser = next();
    else if (arg === '--no-cli') options.checkClis = false;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

function cliCheck(name, resolver) {
  try {
    const executable = resolver(process.env);
    const stat = fs.statSync(executable);
    if (!stat.isFile()) throw new Error('resolved path is not a file');
    return { name, ok: true, executable };
  } catch (error) {
    return { name, ok: false, message: error && error.message ? error.message : String(error) };
  }
}

function usage() {
  return [
    'Usage: node scripts/isolation-preflight.js [options]',
    '',
    '  --profile standard-user|dedicated-user|sandbox-vm',
    '  --project PATH',
    '  --host HOST',
    '  --expected-user DOMAIN\\user   Required for dedicated-user',
    '  --no-cli                       Skip Claude/Codex executable checks',
    '  --json                         Print machine-readable JSON',
  ].join('\n');
}

function printHuman(report) {
  const token = report.token || {};
  console.log(`Isolation profile: ${report.profile}`);
  console.log(`Identity: ${token.identity || 'unknown'} (${token.integrityLevel || 'unknown'} integrity)`);
  console.log(`Project: ${report.project.resolved}`);
  console.log(`Host: ${report.host}`);
  for (const check of report.cliChecks) {
    console.log(`${check.ok ? '[OK]' : '[FAIL]'} ${check.name}${check.executable ? `: ${check.executable}` : ''}`);
  }
  for (const warning of report.warnings) console.warn(`[WARN:${warning.code}] ${warning.message}`);
  for (const error of report.errors) console.error(`[FAIL:${error.code}] ${error.message}`);
  console.log(report.ok ? 'Preflight passed.' : 'Preflight failed; the server was not started.');
}

function main(argv = process.argv.slice(2)) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const cliChecks = options.checkClis
    ? [cliCheck('Claude CLI', resolveClaudeBin), cliCheck('Codex CLI', resolveCodexBin)]
    : [];
  const report = evaluateIsolationPreflight({
    ...options,
    token: inspectCurrentToken(),
    cliChecks,
  });

  if (options.json) console.log(JSON.stringify(report, null, 2));
  else printHuman(report);
  return report.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { cliCheck, main, parseArgs, printHuman, usage };
