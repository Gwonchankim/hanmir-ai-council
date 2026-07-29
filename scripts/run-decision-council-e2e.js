'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { PlanningEngine } = require('../engine');
const { StateStore } = require('../state');
const { validateAnonymousBundle } = require('../lib/council-anonymity');

const ROOT = path.resolve(__dirname, '..');
const RUNS_DIR = path.join(ROOT, 'evaluation', 'runs');
const TIMEOUT_MS = Number(process.env.AI_COUNCIL_DECISION_E2E_TIMEOUT_MS || 30 * 60 * 1000);
const CLAUDE_MODEL = process.env.AI_COUNCIL_E2E_CLAUDE_MODEL || 'claude-haiku-4-5-20251001';
const CODEX_MODEL = process.env.AI_COUNCIL_E2E_CODEX_MODEL || 'gpt-5.6-terra';
const QUESTION = process.env.AI_COUNCIL_DECISION_E2E_QUESTION
  || '한정된 90일과 예산 안에서 신규 B2B 제품을 바로 전면 출시할지, 소규모 유료 파일럿부터 시작할지 판단해줘. 제공되지 않은 수치는 가정으로 명시하고, 되돌릴 수 있는 중단 기준을 포함해줘.';

function runDirectory() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.randomBytes(3).toString('hex');
  const directory = path.join(RUNS_DIR, `DECISION-COUNCIL-${stamp}-${suffix}`);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function latestRunDirectory() {
  if (!fs.existsSync(RUNS_DIR)) return null;
  return fs.readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('DECISION-COUNCIL-'))
    .map((entry) => path.join(RUNS_DIR, entry.name))
    .filter((directory) => fs.existsSync(path.join(directory, 'session.json')))
    .sort()
    .reverse()[0] || null;
}

function route(brain, model, effort, fallbackBrain, fallbackModel) {
  return {
    brain,
    model,
    effort,
    fallbacks: [{
      brain: fallbackBrain,
      model: fallbackModel,
      effort,
    }],
  };
}

function assertResult(store) {
  const state = store.get();
  const artifacts = store.currentCycle()?.artifacts || {};
  const advisorKeys = ['contrarian', 'firstPrinciples', 'expansionist', 'outsider', 'executor'];
  const checks = {
    awaitingApproval: state.phase === 'awaiting_approval',
    protocolPassed: state.currentEvaluation?.passed === true,
    fiveAnalyses: advisorKeys.every((key) => artifacts.advisorAnalyses?.[key]),
    fiveReviews: advisorKeys.every((key) => artifacts.peerReviews?.[key]),
    anonymityIntact: validateAnonymousBundle({
      mapping: artifacts.anonymizationMapping,
      responses: artifacts.anonymousResponses,
      advisorAnalyses: artifacts.advisorAnalyses,
      advisorKeys,
    }).length === 0,
    htmlReport: Boolean(artifacts.councilReports?.html?.name),
    transcriptReport: Boolean(artifacts.councilReports?.transcript?.name),
  };
  const failed = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  if (failed.length) throw new Error(`Decision Council E2E gate failed: ${failed.join(', ')}`);
  return checks;
}

async function main() {
  const resume = process.argv.includes('--resume');
  const directory = resume ? latestRunDirectory() : runDirectory();
  if (!directory) throw new Error('재개할 Decision Council E2E 실행이 없습니다.');
  const store = new StateStore({
    snapshotPath: path.join(directory, 'session.json'),
    autoLoad: resume,
  });
  const codex = (effort = 'low') => route('codex', CODEX_MODEL, effort, 'claude', CLAUDE_MODEL);
  const claude = (effort = 'low') => route('claude', CLAUDE_MODEL, effort, 'codex', CODEX_MODEL);
  if (!resume) {
    store.configure({
      mode: 'decision_council',
      council: {
        maxParallel: 2,
        advisors: {
          contrarian: claude(),
          firstPrinciples: codex(),
          expansionist: claude(),
          outsider: codex(),
          executor: codex(),
        },
        chair: codex('medium'),
      },
    }, { reset: false });
  }

  const engine = new PlanningEngine({ store });
  engine.setEmitter((event) => {
    if (event.type === 'stage' || event.fallback || event.circuit) {
      process.stdout.write(`[${event.type}] ${event.message}\n`);
    }
  });
  if (resume && store.get().phase !== 'failed') {
    throw new Error(`Decision Council E2E는 failed 체크포인트에서만 재개할 수 있습니다: ${store.get().phase}`);
  }
  const run = resume ? engine.retry() : engine.runDecisionCouncil(QUESTION);
  const timeout = new Promise((_, reject) => {
    const timer = setTimeout(() => reject(Object.assign(
      new Error(`Decision Council E2E timed out after ${TIMEOUT_MS}ms`),
      { code: 'ETIMEDOUT' },
    )), TIMEOUT_MS);
    timer.unref?.();
  });

  try {
    await Promise.race([run.promise, timeout]);
    const checks = assertResult(store);
    const state = store.get();
    const result = {
      ok: true,
      runDirectory: directory,
      sessionId: state.sessionKey,
      cycle: state.cycle,
      planVersion: state.planVersion,
      checks,
      modelRouting: store.publicState().modelRouting,
      reports: store.currentCycle().artifacts.councilReports,
      completedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(directory, 'e2e-result.json'), JSON.stringify(result, null, 2), 'utf8');
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    if (engine.active && store.isRunning()) engine.cancel();
    const failure = {
      ok: false,
      runDirectory: directory,
      message: error.message,
      code: error.code || null,
      phase: store.get().phase,
      lastError: store.get().lastError,
      failedAt: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(directory, 'e2e-result.json'), JSON.stringify(failure, null, 2), 'utf8');
    process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
    process.exitCode = 1;
  }
}

// 실패는 반드시 종료 코드로 드러나야 한다. process.exitCode만으로는 정리 단계에
// 남은 핸들·삼켜진 예외 때문에 exit 0으로 끝나는 경우가 있어 명시적으로 종료한다.
function runAsScript(entry) {
  const fail = (error) => {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  };
  process.on('unhandledRejection', fail);
  process.on('uncaughtException', fail);
  entry()
    .then(() => process.exit(process.exitCode || 0))
    .catch(fail);
}

if (require.main === module) runAsScript(main);

module.exports = { assertResult, route };
