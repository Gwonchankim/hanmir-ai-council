'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { StateStore } = require('../state');
const { PlanningEngine, semanticErrors } = require('../engine');
const { createApp } = require('../server');
const config = require('../config');
const { validateArtifact } = require('../schemas');

function harnessSet(cycle) {
  const role = (name) => ({
    mission: `${name} mission for cycle ${cycle}`,
    responsibilities: [`Perform ${name} responsibilities.`],
    operatingRules: ['Follow the task-specific brief and immutable safety rules.'],
    qualityChecks: ['Return a schema-valid, evidence-aware artifact.'],
    boundaries: ['Do not use files, tools, browsers, or networks.'],
    outputContract: 'Return only the structured artifact requested by the active stage.',
  });
  return {
    schemaVersion: 1,
    artifactType: 'harness_set',
    cycle,
    rationale: `Task-specific role design for cycle ${cycle}.`,
    orchestrator: role('orchestrator'),
    claudeWorker: role('claudeWorker'),
    codexWorker: role('codexWorker'),
  };
}

function taskPackage(cycle, requiredQuestion = false) {
  return {
    schemaVersion: 1, artifactType: 'task_package', cycle,
    objective: '검증 가능한 시장진입 전략 보고서 기획',
    deliverable: { kind: '보고서 기획안', audience: '경영진', format: '한국어', scope: 'MVP 기획' },
    requirements: [{ id: 'R1', text: '실행 및 검증 계획을 포함한다.', priority: 'must' }],
    constraints: ['외부 검색 금지'], assumptions: [],
    missingInformation: requiredQuestion
      ? [{ id: `C${cycle}-Q1`, question: '예산은 얼마인가?', required: true, impact: '실행 범위를 결정한다.' }]
      : [],
    workerAssignments: {
      claude: { focus: '시장과 위험', deliverables: ['시장 구조'] },
      codex: { focus: '실행과 검증', deliverables: ['검증 로드맵'] },
    },
    acceptanceCriteria: ['요구사항 추적'],
    feedbackDelta: { change: [], retain: [], remove: [] },
  };
}

function draft(author) {
  return {
    schemaVersion: 1, artifactType: 'draft', author,
    perspective: author === 'claude' ? '시장·위험' : '실행·검증',
    summary: `${author} 독립 초안`, planMarkdown: `# ${author} 기획안\n실행 가능한 전체 계획`,
    decisions: [{ topic: '범위', decision: '기획만 수행', rationale: 'MVP 범위', status: 'decided' }],
    requirementCoverage: ['R1'], assumptions: [], questions: [],
    risks: [{ risk: '근거 부족', trigger: '데이터 미확보', impact: '판단 지연', mitigation: '조사 과제로 전환' }],
    evidenceNeeds: ['검증 결과'],
  };
}

function critique(reviewer, subjectAuthor, revise = false) {
  return {
    schemaVersion: 1, artifactType: 'critique', reviewer, subjectAuthor,
    verdict: revise ? 'revise' : 'accept', strengths: ['요구사항을 다룸'],
    issues: revise ? [{
      id: `I-${reviewer}`, severity: 'high', category: '검증',
      description: '합격 기준을 더 측정 가능하게 해야 한다.',
      recommendation: '수치 대신 측정 방법과 증거를 명시한다.', requirementIds: ['R1'],
    }] : [],
    missingRequirementIds: [],
  };
}

function revision(author, issueId) {
  return {
    schemaVersion: 1, artifactType: 'revision', author,
    summary: `${author} 개정안`, planMarkdown: `# ${author} 개정 기획안\n측정 방법과 증거를 포함한 전체 계획`,
    decisions: [{ topic: '검증', decision: '증거 기반 게이트', rationale: '비평 반영', status: 'decided' }],
    requirementCoverage: ['R1'], assumptions: [], questions: [],
    risks: [{ risk: '근거 부족', trigger: '데이터 미확보', impact: '판단 지연', mitigation: '조사 과제로 전환' }],
    evidenceNeeds: ['검증 결과'],
    changeLog: [{ issueId, disposition: 'accepted', reason: '검증 가능성을 높인다.' }],
  };
}

function synthesis(version, requiredQuestion = false, feedback = false) {
  return {
    schemaVersion: 1, artifactType: 'synthesis', planVersion: version,
    title: '통합 시장진입 전략 보고서 기획안',
    status: requiredQuestion ? 'needs_input' : 'ready_for_approval',
    executiveSummary: '두 워커의 시장·위험 및 실행·검증 관점을 통합했다.',
    planMarkdown: '# 통합 기획안\n## 목표\n경영진 의사결정을 지원한다.\n## 실행\n단계별 검증을 수행한다.',
    decisions: [{ topic: '범위', decision: '기획안까지만 작성', rationale: 'MVP 범위 준수', status: 'decided' }],
    requirementTraceability: [{ requirementId: 'R1', status: requiredQuestion ? 'blocked' : 'covered', evidence: '실행·검증 절' }],
    integration: {
      acceptedFromClaude: ['시장 위험 구조'], acceptedFromCodex: ['검증 게이트'],
      conflicts: [], orchestratorChanges: ['두 관점을 단일 단계로 통합'],
    },
    assumptions: [],
    requiredQuestions: requiredQuestion ? [{ id: `C${version}-Q1`, question: '예산은 얼마인가?', impact: '실행 범위를 결정한다.' }] : [],
    optionalQuestions: [],
    risks: [{
      risk: '근거 부족', severity: 'high', trigger: '데이터 미확보', impact: '판단 지연',
      mitigation: '조사 과제로 전환', owner: 'PM', recovery: '조사 완료 후 게이트를 재검토한다.',
    }],
    validationPlan: [{
      requirementIds: ['R1'], criterion: '요구 충족', method: '추적표 검토', evidence: 'R1 대응',
      passCondition: '누락 0건', negativeTest: 'R1 증거가 없으면 실패한다.', owner: 'PM',
    }],
    measurableTargets: {
      targetPages: 20, validationDays: 90, analysisModules: ['가격·수율 민감도'],
      priceScenarios: ['기준가', '하락가', '상승가'], yieldScenarios: ['90% 이상', '85~90%', '85% 미만'],
    },
    feedbackTraceability: feedback ? [{ feedbackId: 'FB-1', status: 'addressed', evidence: '통합 계획에 반영' }] : [],
    changeSummary: feedback ? ['사용자 피드백을 반영함'] : [],
    nextActions: [
      { action: '승인', when: '필수 질문 해소 후', outcome: 'MVP 기획 루프 종료' },
      { action: '수정 요청', when: '보완 필요 시', outcome: '다음 피드백 cycle 시작' },
    ],
  };
}

function fakeBrain(options = {}) {
  const calls = [];
  let codexDraftFailures = 0;
  const fn = async ({ prompt, session, schema, signal }) => {
    const kind = schema.$id;
    const author = prompt.includes("author는 반드시 'claude'") ? 'claude'
      : prompt.includes("author는 반드시 'codex'") ? 'codex' : null;
    const reviewer = prompt.includes("reviewer='claude'") ? 'claude'
      : prompt.includes("reviewer='codex'") ? 'codex' : null;
    const key = ['HarnessSet', 'TaskPackage', 'Synthesis'].includes(kind) ? 'orchestrator' : (author || reviewer);
    calls.push({ kind, key, resumed: Boolean(session), prompt });

    if (options.hangAtTask && kind === 'TaskPackage') {
      await new Promise((resolve, reject) => {
        if (signal?.aborted) { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); return; }
        signal?.addEventListener('abort', () => { const error = new Error('aborted'); error.name = 'AbortError'; reject(error); }, { once: true });
      });
    }
    if (options.failCodexDraftOnce && kind === 'Draft' && author === 'codex' && codexDraftFailures++ === 0) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      throw new Error('mock Codex timeout');
    }
    if (kind === 'Draft' && author === 'claude' && options.failCodexDraftOnce) {
      await new Promise((resolve) => setTimeout(resolve, 1));
    }

    let value;
    const cycleMatch = prompt.match(/harness cycle must be (\d+)/i) || prompt.match(/cycle은 반드시 (\d+)/);
    const versionMatch = prompt.match(/planVersion은 반드시 (\d+)/);
    if (kind === 'HarnessSet') value = harnessSet(Number(cycleMatch?.[1] || options.cycle || 1));
    else if (kind === 'TaskPackage') value = taskPackage(Number(cycleMatch?.[1] || options.cycle || 1), options.requiredQuestion);
    else if (kind === 'Draft') value = draft(author);
    else if (kind === 'Critique') value = critique(reviewer, reviewer === 'claude' ? 'codex' : 'claude', options.requireRevision);
    else if (kind === 'Revision') value = revision(author, `I-${author === 'claude' ? 'codex' : 'claude'}`);
    else if (kind === 'Synthesis') value = synthesis(
      Number(versionMatch?.[1] || options.planVersion || 1),
      options.requiredQuestion,
      options.feedback || prompt.includes('PRIOR_SYNTHESIS'),
    );
    else throw new Error(`unexpected schema ${kind}`);
    return { text: JSON.stringify(value), session: session || `session-${key}` };
  };
  fn.calls = calls;
  return fn;
}

function fixtureStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-council-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return new StateStore({ snapshotPath: path.join(dir, 'session.json'), autoLoad: false });
}

test('R0→R1 수렴 시 R2를 생략하고 승인 대기 상태가 된다', async (t) => {
  const store = fixtureStore(t);
  const brain = fakeBrain();
  const engine = new PlanningEngine({ store, brainCaller: brain });
  const run = engine.runPlanning('시장진입 전략을 기획해줘');
  await run.promise;
  assert.equal(store.get().phase, 'awaiting_approval');
  assert.equal(store.get().round, 1);
  assert.equal(store.get().planVersion, 1);
  assert.equal(brain.calls[0].kind, 'HarnessSet');
  assert.equal(store.currentCycle().harnessRevision, store.get().harnessRevision);
  assert.ok(brain.calls.filter((call) => call.kind !== 'HarnessSet')
    .every((call) => call.prompt.includes('AI_COUNCIL_ROLE_HARNESS_')));
  const persistedBindings = store.get().sessionAudit
    .filter((entry) => entry.artifactType !== 'harnessSet')
    .map((entry) => entry.promptBinding);
  assert.ok(persistedBindings.length > 0);
  assert.ok(persistedBindings.every((binding) => binding?.included
    && binding.harnessDigest === binding.promptHarnessDigest
    && binding.harnessDigest.length === 64));
  assert.doesNotMatch(JSON.stringify(persistedBindings), /Active task harness|시장진입/);
  assert.equal(brain.calls.filter((call) => call.kind === 'Revision').length, 0);
  assert.equal(store.get().currentEvaluation.passed, true);
  assert.equal(new Set(Object.values(store.get().sessions)).size, 3);
});

test('high 이슈가 있으면 두 작성자가 R2를 한 번씩 수행한다', async (t) => {
  const store = fixtureStore(t);
  const brain = fakeBrain({ requireRevision: true });
  const engine = new PlanningEngine({ store, brainCaller: brain });
  await engine.runPlanning('검증 계획을 기획해줘').promise;
  assert.equal(store.get().phase, 'awaiting_approval');
  assert.equal(store.get().round, 2);
  assert.deepEqual(brain.calls.filter((call) => call.kind === 'Revision').map((call) => call.key).sort(), ['claude', 'codex']);
});

test('사용자 harness 편집은 다음 orchestrator 생성 뒤에도 worker active prompt에 유지된다', async (t) => {
  const store = fixtureStore(t);
  const canary = 'USER_LOCKED_HARNESS_CANARY';
  const current = store.getHarnessState().harnesses.claudeWorker;
  store.updateHarnessContent('claudeWorker', current.content.replace(
    store.get().harnesses.claudeWorker.mission,
    canary,
  ), { expectedRoleVersion: current.version });
  const brain = fakeBrain();
  const engine = new PlanningEngine({ store, brainCaller: brain });
  await engine.runPlanning('preserve my worker harness').promise;
  assert.equal(store.get().harnesses.claudeWorker.mission, canary);
  assert.equal(store.currentCycle().artifacts.harnessSet.claudeWorker.mission, canary);
  const claudeDraft = brain.calls.find((call) => call.kind === 'Draft' && call.key === 'claude');
  assert.match(claudeDraft.prompt, new RegExp(canary));
});

test('피드백 cycle은 역할별 세션을 유지하고 planVersion을 증가시킨다', async (t) => {
  const store = fixtureStore(t);
  const brain = fakeBrain();
  const engine = new PlanningEngine({ store, brainCaller: brain });
  await engine.runPlanning('첫 기획 지시').promise;
  const sessions = { ...store.get().sessions };
  const before = brain.calls.length;
  await engine.runPlanning('타깃은 좁히고 검증 프레임은 유지해줘', true).promise;
  assert.equal(store.get().cycle, 2);
  assert.equal(store.get().planVersion, 2);
  assert.equal(brain.calls[before].kind, 'HarnessSet');
  assert.equal(store.get().harnessRevision, 2);
  assert.equal(store.get().harnessHistory.length, 2);
  assert.deepEqual(store.get().sessions, sessions);
  assert.ok(brain.calls.slice(before).every((call) => call.resumed));
  for (const role of ['orchestrator', 'claudeWorker', 'codexWorker']) {
    const audit = store.get().sessionAudit.filter((entry) => entry.role === role);
    assert.ok(audit.some((entry) => entry.continuity === 'started'));
    assert.ok(audit.some((entry) => entry.continuity === 'resumed_same'));
    assert.equal(audit.some((entry) => entry.continuity === 'replaced'), false);
  }
  assert.deepEqual(store.get().currentPlan.changeSummary, ['사용자 피드백을 반영함']);
});

test('실패한 병렬 단계는 완료 결과를 보존하고 실패 역할만 재시도한다', async (t) => {
  const store = fixtureStore(t);
  const brain = fakeBrain({ failCodexDraftOnce: true });
  const engine = new PlanningEngine({ store, brainCaller: brain });
  await engine.runPlanning('복구 테스트').promise;
  assert.equal(store.get().phase, 'failed');
  assert.ok(store.currentCycle().artifacts.claudeDraft);
  assert.equal(store.currentCycle().artifacts.codexDraft, undefined);
  await engine.retry().promise;
  assert.equal(store.get().phase, 'awaiting_approval');
  assert.equal(brain.calls.filter((call) => call.kind === 'Draft' && call.key === 'claude').length, 1);
  assert.equal(brain.calls.filter((call) => call.kind === 'Draft' && call.key === 'codex').length, 2);
});

test('retry는 저장된 checkpoint를 재검증하고 변조된 worker artifact부터 재생성한다', async (t) => {
  const store = fixtureStore(t);
  const brain = fakeBrain({ failCodexDraftOnce: true });
  const engine = new PlanningEngine({ store, brainCaller: brain });
  await engine.runPlanning('checkpoint tamper test').promise;
  assert.equal(store.get().phase, 'failed');
  store.currentCycle().artifacts.claudeDraft.author = 'codex';
  store.snapshot();
  await engine.retry().promise;
  assert.equal(store.get().phase, 'awaiting_approval');
  assert.equal(brain.calls.filter((call) => call.kind === 'Draft' && call.key === 'claude').length, 2);
  assert.equal(store.currentCycle().artifacts.claudeDraft.author, 'claude');
});

test('취소 후 늦은 실행 결과가 현재 상태를 덮어쓰지 않는다', async (t) => {
  const store = fixtureStore(t);
  const engine = new PlanningEngine({ store, brainCaller: fakeBrain({ hangAtTask: true }) });
  const run = engine.runPlanning('취소 테스트');
  engine.cancel();
  await run.promise;
  assert.equal(store.get().phase, 'cancelled');
  assert.equal(store.get().currentPlan, null);
});

test('스냅샷은 세션과 공개 이벤트를 복원하고 실행 중 종료는 failed로 복구한다', (t) => {
  const first = fixtureStore(t);
  first.get().phase = 'drafting';
  first.get().sessions.orchestrator = 'session-o';
  first.appendEvent({ type: 'status', role: 'system', message: '진행 중' });
  first.snapshot();
  const second = new StateStore({ snapshotPath: first.snapshotPath, autoLoad: true });
  assert.equal(second.get().phase, 'failed');
  assert.equal(second.get().sessions.orchestrator, 'session-o');
  assert.equal(second.get().transcript.length, 1);
  assert.match(second.get().lastError.message, /비정상 종료/);
});

async function withServer(t, options = {}) {
  const store = fixtureStore(t);
  const engine = new PlanningEngine({ store, brainCaller: fakeBrain(options) });
  const app = createApp({ store, engine });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  t.after(() => new Promise((resolve) => { app.locals.closeStreams(); server.close(resolve); }));
  return { store, engine, base: `http://127.0.0.1:${server.address().port}` };
}

async function post(base, route, body, headers = {}) {
  const suppliedSession = headers['x-ai-council-session'] || headers['X-AI-Council-Session'];
  const sessionId = suppliedSession || (await (await fetch(`${base}/api/state`)).json()).sessionId;
  return fetch(`${base}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-ai-council-session': sessionId, ...headers },
    body: JSON.stringify(body),
  });
}

test('API는 외부 Origin과 잘못된 설정을 차단한다', async (t) => {
  const { base } = await withServer(t);
  const external = await post(base, '/api/session', { config: {} }, { origin: 'https://example.com' });
  assert.equal(external.status, 403);
  const invalid = await post(base, '/api/session', { config: { claudeWorker: { model: '없는-모델' } } });
  assert.equal(invalid.status, 400);
});

test('필수 질문이 남은 기획안은 UI와 무관하게 승인 API가 409를 반환한다', async (t) => {
  const { base, store } = await withServer(t, { requiredQuestion: true });
  const instruction = await post(base, '/api/instruct', { instruction: '신사업 전략을 기획해줘' });
  assert.equal(instruction.status, 202);
  while (store.isRunning()) await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(store.get().phase, 'awaiting_input');
  const approval = await post(base, '/api/approve', { planVersion: 1 });
  assert.equal(approval.status, 409);
});

test('승인 가능한 최신 버전만 승인되며 로컬 API 전체 흐름이 완료된다', async (t) => {
  const { base, store } = await withServer(t);
  const instruction = await post(base, '/api/instruct', { instruction: '시장진입 전략을 기획해줘' });
  assert.equal(instruction.status, 202);
  while (store.isRunning()) await new Promise((resolve) => setTimeout(resolve, 5));
  const stale = await post(base, '/api/approve', { planVersion: 0 });
  assert.equal(stale.status, 409);
  const approval = await post(base, '/api/approve', { planVersion: 1 });
  assert.equal(approval.status, 200);
  assert.equal(store.get().phase, 'approved');
});

test('LLM 호출 직전 프롬프트 한도를 넘으면 brain process를 시작하지 않는다', async (t) => {
  const store = fixtureStore(t);
  const brain = fakeBrain();
  const engine = new PlanningEngine({ store, brainCaller: brain });
  const runId = 'prompt-limit-test';
  store.get().runId = runId;

  await assert.rejects(
    engine._invoke(
      'orchestrator',
      '가'.repeat(Math.floor(config.limits.promptChars / 3) + 1),
      'harnessSet',
      { cycle: 1 },
      runId,
      new AbortController().signal,
    ),
    (error) => error.code === 'PROMPT_TOO_LARGE' && error.status === 413,
  );
  assert.equal(brain.calls.length, 0);
});

test('피드백 통합안은 명시된 FB ID와 이전 분량·검증 기간을 잃을 수 없다', () => {
  const prior = synthesis(2, false, true);
  prior.feedbackTraceability = [{ feedbackId: 'FB-BASE', status: 'addressed', evidence: '기존 반영 근거' }];
  const candidate = synthesis(3, false, true);
  candidate.title = 'Cycle 3 Harness Set';
  candidate.feedbackTraceability = [
    ...prior.feedbackTraceability,
    { feedbackId: 'FB-SENSITIVITY', status: 'addressed', evidence: '민감도 모듈 반영' },
  ];
  candidate.measurableTargets.targetPages = 0;
  candidate.measurableTargets.validationDays = 0;

  const context = {
    planVersion: 3,
    taskPackage: taskPackage(3),
    isFeedback: true,
    priorPlan: prior,
    instruction: '[FB-GATE] 90일 게이트\n[FB-OUTLINE] 20쪽 목차\n[FB-SENSITIVITY] 가격·수율 민감도',
    requiredFeedbackIds: ['FB-GATE', 'FB-OUTLINE', 'FB-SENSITIVITY'],
  };
  const invalid = semanticErrors('synthesis', candidate, context);
  assert.ok(invalid.some((item) => item.message.includes('FB-GATE 추적이 누락')));
  assert.ok(invalid.some((item) => item.message.includes('FB-OUTLINE 추적이 누락')));
  assert.ok(invalid.some((item) => item.path === '/measurableTargets/targetPages'));
  assert.ok(invalid.some((item) => item.path === '/measurableTargets/validationDays'));
  assert.ok(invalid.some((item) => item.path === '/title'));

  candidate.title = '시장진입 전략 보고서 최종 기획안';
  candidate.feedbackTraceability.push(
    { feedbackId: 'FB-GATE', status: 'addressed', evidence: '90일 게이트 반영' },
    { feedbackId: 'FB-OUTLINE', status: 'addressed', evidence: '20쪽 목차 반영' },
  );
  candidate.measurableTargets.targetPages = 20;
  candidate.measurableTargets.validationDays = 90;
  assert.deepEqual(semanticErrors('synthesis', candidate, context), []);
});

test('synthesis 피드백 추적은 여러 cycle의 addressed ID 28개를 보존할 수 있다', () => {
  const candidate = synthesis(4, false, true);
  candidate.feedbackTraceability = Array.from({ length: 28 }, (_, index) => ({
    feedbackId: `TRACE-${index + 1}`,
    status: 'addressed',
    evidence: `cycle 누적 근거 ${index + 1}`,
  }));
  assert.equal(validateArtifact('synthesis', candidate).valid, true);
});
