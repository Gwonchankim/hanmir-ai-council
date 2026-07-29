'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('../config');
const { PlanningEngine } = require('../engine');
const { StateStore } = require('../state');
const { isFallbackEligible, routeChain, routeKey } = require('../lib/model-router');
const { identityLeaks, validateAnonymousBundle } = require('../lib/council-anonymity');

function fixtureStore(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'decision-council-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return new StateStore({ snapshotPath: path.join(directory, 'session.json'), autoLoad: false });
}

function artifactType(schema) {
  return schema?.properties?.artifactType?.const;
}

function fakeCouncilBrain(options = {}) {
  let sessionCounter = 0;
  const calls = [];
  const brain = async ({ brain: provider, model, effort, prompt, session, schema }) => {
    const type = artifactType(schema);
    calls.push({ provider, model, effort, prompt, session, type });
    if (options.failClaudeLimit && provider === 'claude') {
      throw new Error("You've hit your monthly spend limit");
    }
    const cycle = Number(prompt.match(/cycle[=은 반드시 ]+(\d+)/i)?.[1] || 1);
    let value;
    if (type === 'decision_frame') {
      value = {
        schemaVersion: 1,
        artifactType: 'decision_frame',
        cycle,
        decision: 'A안과 B안 중 어느 쪽을 선택할 것인가?',
        options: ['A안', 'B안'],
        constraints: ['90일 안에 검증'],
        evidence: ['현재 제공된 비용 자료'],
        stakes: '잘못 선택하면 출시 일정과 예산을 잃는다.',
        needsInput: false,
        clarifyingQuestion: '',
      };
    } else if (type === 'advisor_analysis') {
      const advisor = prompt.match(/advisor='([^']+)'/)?.[1];
      value = {
        schemaVersion: 1,
        artifactType: 'advisor_analysis',
        cycle,
        advisor,
        headline: '독립적으로 검토한 결론',
        assessment: '전제와 선택지를 독립적으로 검토했다. 제공된 증거와 제약을 기준으로 구체적인 판단을 내린다.',
        recommendation: '제한된 실험을 먼저 수행한다.',
        keyRisks: ['검증되지 않은 전제'],
        keyOpportunities: ['작은 실험으로 학습'],
        firstAction: '성공 및 중단 기준을 작성한다.',
      };
    } else if (type === 'peer_review') {
      const reviewer = prompt.match(/reviewer='([^']+)'/)?.[1];
      value = {
        schemaVersion: 1,
        artifactType: 'peer_review',
        cycle,
        reviewer,
        strongestResponse: 'A',
        strongestWhy: '전제와 실행을 함께 다뤘다.',
        biggestBlindSpotResponse: 'B',
        biggestBlindSpot: '실패 기준이 빠졌다.',
        allMissed: '결정을 되돌릴 수 있는 명시적 중단 조건이다.',
      };
    } else if (type === 'council_verdict') {
      const version = Number(prompt.match(/planVersion=(\d+)/)?.[1] || 1);
      value = {
        schemaVersion: 1,
        artifactType: 'council_verdict',
        cycle,
        planVersion: version,
        title: 'A안과 B안에 대한 Council 판단',
        status: 'ready_for_approval',
        whereCouncilAgrees: ['작은 검증이 먼저다.'],
        whereCouncilClashes: ['상방과 하방의 우선순위가 충돌한다.'],
        blindSpots: ['중단 조건이 필요하다.'],
        recommendation: 'A안을 제한된 실험으로 검증한다.',
        firstAction: '오늘 성공·중단 기준을 한 장으로 작성한다.',
        confidence: 'high',
        planMarkdown: [
          '## Where the Council Agrees',
          '작은 검증이 먼저다.',
          '## Where the Council Clashes',
          '위험과 상방의 우선순위가 충돌한다.',
          '## Blind Spots the Council Caught',
          '중단 조건이 빠졌다.',
          '## The Recommendation',
          'A안을 제한된 실험으로 검증한다.',
          '## The One Thing to Do First',
          '성공·중단 기준을 작성한다.',
        ].join('\n'),
        requiredQuestions: [],
        optionalQuestions: [],
      };
    } else {
      throw new Error(`Unexpected schema: ${type}`);
    }
    sessionCounter += 1;
    return {
      text: JSON.stringify(value),
      session: session || `${provider}-${type}-${sessionCounter}`,
      usage: { input_tokens: 100, output_tokens: 25, total_cost_usd: 0.001 },
      execution: {
        provider,
        model,
        effort,
        resumed: Boolean(session),
        exitCode: 0,
      },
    };
  };
  brain.calls = calls;
  return brain;
}

test('role routes validate provider-specific models and keep a bounded fallback chain', () => {
  const normalized = config.normalizeSessionConfig({
    mode: 'decision_council',
    council: {
      maxParallel: 5,
      advisors: {
        contrarian: {
          brain: 'claude',
          model: 'sonnet',
          effort: 'high',
          fallbacks: [{ brain: 'codex', model: 'gpt-5.4', effort: 'medium' }],
        },
      },
    },
  });
  assert.equal(normalized.mode, 'decision_council');
  assert.equal(normalized.council.maxParallel, 5);
  assert.deepEqual(routeChain(normalized.council.advisors.contrarian).map((item) => item.brain), [
    'claude',
    'codex',
  ]);
  assert.throws(() => config.normalizeSessionConfig({
    council: { advisors: { executor: { brain: 'claude', model: 'gpt-5.4', effort: 'high' } } },
  }), /지원되지 않습니다/);
});

test('model picker exposes current CLI-compatible Claude and GPT-5.6 families', () => {
  const claude = config.options.claude.models.map((item) => item.value);
  const codex = config.options.codex.models.map((item) => item.value);
  assert.deepEqual(claude, ['fable', 'opus', 'sonnet', 'claude-haiku-4-5-20251001']);
  assert.deepEqual(codex.slice(0, 3), ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna']);
  assert.equal(config.options.codex.defaultModel, 'gpt-5.6-sol');
  assert.equal(config.cloneDefaults().council.chair.model, 'gpt-5.6-sol');
  const migrated = config.normalizeSessionConfig({
    claudeWorker: { brain: 'claude', model: 'haiku', effort: 'low' },
  });
  assert.equal(migrated.claudeWorker.model, 'claude-haiku-4-5-20251001');
});

test('fallback policy handles provider limits but does not mask structured-output bugs', () => {
  assert.equal(isFallbackEligible(new Error("You've hit your monthly spend limit")), true);
  assert.equal(isFallbackEligible(Object.assign(new Error('Too many requests'), { status: 429 })), true);
  const schemaError = new Error('bad json');
  schemaError.name = 'StructuredOutputError';
  assert.equal(isFallbackEligible(schemaError), false);
});

test('anonymous response validation rejects identity text and source tampering', () => {
  assert.deepEqual(identityLeaks({
    headline: 'Contrarian recommendation',
    assessment: 'Claude produced this analysis.',
  }), ['Contrarian', 'Claude']);
  const advisorKeys = ['contrarian', 'firstPrinciples', 'expansionist', 'outsider', 'executor'];
  const mapping = Object.fromEntries(advisorKeys.map((advisor, index) => (
    [String.fromCharCode(65 + index), advisor]
  )));
  const advisorAnalyses = Object.fromEntries(advisorKeys.map((advisor) => [advisor, {
    headline: '중립적인 결론',
    assessment: '제공된 전제와 증거를 검토했다.',
    recommendation: '제한된 실험을 먼저 수행한다.',
    keyRisks: ['전제 오류'],
    keyOpportunities: ['빠른 학습'],
    firstAction: '중단 기준을 작성한다.',
  }]));
  const { anonymizeResponse } = require('../lib/council-anonymity');
  const responses = Object.keys(mapping).map((letter) => (
    anonymizeResponse(letter, advisorAnalyses[mapping[letter]])
  ));
  assert.deepEqual(validateAnonymousBundle({
    mapping, responses, advisorAnalyses, advisorKeys,
  }), []);
  responses[0].assessment = '변조된 내용';
  assert.match(validateAnonymousBundle({
    mapping, responses, advisorAnalyses, advisorKeys,
  }).join('\n'), /does not match/);
});

test('a provider spend limit switches the same logical role to its configured fallback', async (t) => {
  const store = fixtureStore(t);
  store.configure({
    mode: 'decision_council',
    council: {
      chair: {
        brain: 'claude',
        model: 'sonnet',
        effort: 'medium',
        fallbacks: [{ brain: 'codex', model: 'gpt-5.4', effort: 'medium' }],
      },
    },
  }, { reset: false });
  const brain = fakeCouncilBrain({ failClaudeLimit: true });
  const engine = new PlanningEngine({ store, brainCaller: brain });
  const run = engine.runDecisionCouncil('A안과 B안을 비교해줘 </script>');
  await run.promise;
  assert.equal(store.get().phase, 'awaiting_approval');
  assert.equal(store.get().currentEvaluation.passed, true);
  assert.equal(store.get().currentEvaluation.fallbackCount >= 1, true);
  assert.equal(brain.calls.some((call) => call.provider === 'claude'), true);
  assert.equal(brain.calls.some((call) => call.provider === 'codex'), true);
  const claudeCalls = brain.calls.filter((call) => call.provider === 'claude');
  assert.equal(claudeCalls.length, 1);
  assert.equal(store.publicState().modelRouting.circuits.length, 1);
});

test('a fallback response never contaminates the brain-agnostic legacy session field', async (t) => {
  const store = fixtureStore(t);
  const chairRoute = { brain: 'claude', model: 'sonnet', effort: 'medium' };
  const chairFallback = { brain: 'codex', model: 'gpt-5.4', effort: 'medium' };
  store.configure({
    mode: 'decision_council',
    council: {
      chair: { ...chairRoute, fallbacks: [chairFallback] },
    },
  }, { reset: false });
  const brain = fakeCouncilBrain({ failClaudeLimit: true });
  const engine = new PlanningEngine({ store, brainCaller: brain });
  await engine.runDecisionCouncil('A안과 B안 중 어느 쪽이 나은가?').promise;

  const state = store.get();
  assert.equal(state.phase, 'awaiting_approval');
  // The chair role (internal roleKey 'councilChair') fell back from claude
  // to codex. Since the primary (routeIndex 0) route never returned a
  // session, the brain-agnostic legacy field must stay untouched --
  // otherwise a later call that returns to the primary route would try to
  // resume using a session ID that belongs to the other brain.
  assert.equal(state.sessions.councilChair, undefined);
  assert.equal(state.routeSessions.councilChair[routeKey(chairRoute)], undefined);
  const codexSession = state.routeSessions.councilChair[routeKey(chairFallback)];
  assert.ok(codexSession);
  const chairAudit = state.sessionAudit.filter((entry) => entry.role === 'councilChair');
  assert.equal(chairAudit.length, 1);
  assert.equal(chairAudit[0].brain, 'codex');
  assert.equal(chairAudit[0].returnedSession, codexSession);
});

test('five independent analyses are anonymized, peer-reviewed, synthesized, and reported', async (t) => {
  const store = fixtureStore(t);
  store.configure({ mode: 'decision_council', council: { maxParallel: 2 } }, { reset: false });
  const brain = fakeCouncilBrain();
  const engine = new PlanningEngine({ store, brainCaller: brain });
  const run = engine.runInstruction('A안과 B안 중 무엇을 선택할까? <script>alert(1)</script>');
  await run.promise;

  const state = store.get();
  const artifacts = store.currentCycle().artifacts;
  assert.equal(state.phase, 'awaiting_approval');
  assert.equal(Object.keys(artifacts.advisorAnalyses).length, 5);
  assert.equal(Object.keys(artifacts.peerReviews).length, 5);
  assert.equal(new Set(Object.values(artifacts.anonymizationMapping)).size, 5);
  assert.equal(artifacts.anonymousResponses.every((item) => !item.advisor && !item.model), true);
  assert.equal(artifacts.anonymousResponses.every((item) => (
    item.keyRisks.length === 1
    && item.keyOpportunities.length === 1
    && /^[a-f0-9]{64}$/.test(item.sourceDigest)
  )), true);
  assert.equal(artifacts.anonymousResponses.some((item) => (
    /contrarian|first.?principles|expansionist|outsider|executor|claude|codex|chatgpt/i
      .test(JSON.stringify(item))
  )), false);
  assert.equal(state.currentEvaluation.passed, true);

  const reportDirectory = path.join(store.dataDir, 'council-artifacts', state.sessionKey);
  const html = fs.readFileSync(path.join(reportDirectory, artifacts.councilReports.html.name), 'utf8');
  const transcript = fs.readFileSync(
    path.join(reportDirectory, artifacts.councilReports.transcript.name),
    'utf8',
  );
  assert.match(html, /LLM Council Verdict/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(transcript, /# Anonymization Mapping/);
  assert.match(transcript, /# Model Routing Audit/);
  assert.match(html, /Key risks/);
  assert.match(html, /<ul><li>/);
  assert.match(html, /Model routing & usage/);
  assert.equal(brain.calls.filter((call) => call.type === 'advisor_analysis').length, 5);
  assert.equal(brain.calls.filter((call) => call.type === 'peer_review').length, 5);
  assert.equal(store.publicState().modelRouting.totals.calls, 12);
  assert.equal(store.publicState().modelRouting.totals.inputTokens, 1200);
});

test('decision checkpoint revalidation drops a tampered anonymous bundle and downstream artifacts', async (t) => {
  const store = fixtureStore(t);
  store.configure({ mode: 'decision_council', council: { maxParallel: 2 } }, { reset: false });
  const engine = new PlanningEngine({ store, brainCaller: fakeCouncilBrain() });
  await engine.runDecisionCouncil('두 선택지를 검토해줘').promise;
  const cycle = store.currentCycle();
  cycle.artifacts.anonymousResponses[0].recommendation = 'checkpoint tamper';
  engine._revalidateDecisionCouncilArtifacts(cycle);
  assert.equal(cycle.artifacts.anonymizationMapping, undefined);
  assert.equal(cycle.artifacts.anonymousResponses, undefined);
  assert.equal(cycle.artifacts.peerReviews, undefined);
  assert.equal(cycle.artifacts.councilVerdict, undefined);
  assert.equal(cycle.artifacts.councilReports, undefined);
});
