'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { StateStore } = require('../../state');
const { createApp } = require('../../server');
const { launchBrowser, poll, setViewportAndNavigate } = require('./cdp-client');

const XSS_MARKER = 'AI_COUNCIL_XSS_CANARY';
const XSS_PAYLOAD = `<img src=x onerror="window.${XSS_MARKER}=true">${XSS_MARKER}`;
const LONG_STREAM_TOKEN = `LONG_SSE_${'Z'.repeat(1400)}`;

function fakeEngine() {
  return {
    setEmitter(fn) { this.emitter = fn; },
    cancel() {},
    retry() { throw new Error('Browser regression must not invoke an agent'); },
    runPlanning() { throw new Error('Browser regression must not invoke an agent'); },
  };
}

function fakeModelCapacity() {
  return {
    async refresh() {
      return {
        visibility: 'local',
        refreshIntervalMs: 300000,
        providers: {
          claude: { provider: 'claude', state: 'available', source: 'fixture', updatedAt: new Date().toISOString(), windows: [{ id: 'claude-session', label: '현재 세션', remainingPercent: 52, resetsAt: null, resetLabel: '1시간 후' }], resetCreditCount: 0 },
          codex: { provider: 'codex', state: 'available', source: 'fixture', updatedAt: new Date().toISOString(), windows: [{ id: 'codex-primary', label: '기본 한도', remainingPercent: 65, resetsAt: null, resetLabel: '5일 후' }], resetCreditCount: 0 },
        },
      };
    },
  };
}

function buildStore(root) {
  const store = new StateStore({ snapshotPath: path.join(root, 'session.json'), autoLoad: false });
  store.get().sessionTitle = 'Archived responsive fixture';
  store.appendEvent({ type: 'user', role: 'user', message: 'First fixture session' });
  store.snapshot();

  store.configure(store.get().config, { reset: true });
  store.get().sessionTitle = XSS_PAYLOAD;
  store.get().phase = 'idle';
  store.appendEvent({ type: 'user', role: 'user', message: XSS_PAYLOAD });
  store.appendEvent({
    type: 'artifact',
    role: 'orchestrator',
    artifactType: 'responsive_test_artifact',
    artifact: {
      title: XSS_PAYLOAD,
      summary: `<script>window.${XSS_MARKER}=true</script>${XSS_MARKER}`,
      recommendations: [XSS_PAYLOAD],
    },
  });
  store.appendEvent({
    type: 'user',
    role: 'orchestrator',
    message: `긴 실시간 출력 overflow 검증: \`${LONG_STREAM_TOKEN}\``,
  });
  store.getHarnessHistory();
  const revisedHarnesses = structuredClone(store.get().harnesses);
  revisedHarnesses.orchestrator.mission = 'Responsive fixture mission with a visible revision diff.';
  store.replaceHarnesses(revisedHarnesses, {
    source: 'orchestrator',
    expectedRevision: store.get().harnessRevision,
    requireAll: true,
    changedRoles: ['orchestrator'],
  });
  store.snapshot();
  return store;
}

async function startFixtureServer(store) {
  const app = createApp({ store, engine: fakeEngine(), modelCapacity: fakeModelCapacity() });
  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    async close() {
      app.locals.closeStreams();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function intersects(a, b, tolerance = 1) {
  return a.left < b.right - tolerance
    && a.right > b.left + tolerance
    && a.top < b.bottom - tolerance
    && a.bottom > b.top + tolerance;
}

function assertInsideViewport(rect, width, label) {
  assert.ok(rect.width > 0, `${label} should have a positive width`);
  assert.ok(rect.left >= -1, `${label} extends left of the viewport: ${rect.left}`);
  assert.ok(rect.right <= width + 1, `${label} extends right of the viewport: ${rect.right} > ${width}`);
}

async function layoutSnapshot(client) {
  return client.evaluate(`(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector)?.getBoundingClientRect();
      return value && {
        left: value.left, right: value.right, top: value.top, bottom: value.bottom,
        width: value.width, height: value.height,
      };
    };
    return {
      innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      rail: rect('#sessionRail'),
      studio: rect('.studio-shell'),
      workspaceGrid: rect('.workspace-grid'),
      conversation: rect('.conversation-column'),
      inspector: rect('#inspectorPanel'),
      composer: rect('.composer'),
      mobileNav: rect('#mobileWorkspaceNav'),
      railExpanded: document.querySelector('#toggleSessionRail')?.getAttribute('aria-expanded'),
      railHidden: document.querySelector('#sessionRail')?.getAttribute('aria-hidden'),
      railInert: document.querySelector('#sessionRail')?.inert,
      mobileView: document.body.dataset.mobileView,
      inspectorHidden: document.querySelector('#inspectorPanel')?.getAttribute('aria-hidden'),
      remoteMode: document.querySelector('#remoteModeBadge')?.dataset.remoteMode,
      connectionState: document.querySelector('#connectionBadge')?.dataset.connectionState,
      mobile: matchMedia('(max-width: 880px)').matches,
    };
  })()`);
}

async function verifyLayout(client, profile) {
  await client.evaluate("document.querySelector('.composer')?.scrollIntoView({ block: 'end' })");
  await new Promise((resolve) => setTimeout(resolve, 80));
  const layout = await layoutSnapshot(client);
  assert.equal(layout.innerWidth, profile.width);
  assert.ok(layout.scrollWidth <= profile.width + 1,
    `${profile.width}px page has horizontal overflow: ${layout.scrollWidth}px`);

  for (const [name, rect] of Object.entries({
    studio: layout.studio,
    workspace: layout.workspaceGrid,
    conversation: layout.conversation,
    composer: layout.composer,
  })) {
    assert.ok(rect, `${name} was not rendered`);
    assertInsideViewport(rect, profile.width, name);
  }

  assert.ok(layout.composer.left >= layout.conversation.left - 1
    && layout.composer.right <= layout.conversation.right + 1,
  'composer must remain inside the conversation column');

  if (profile.width <= 880) {
    assert.equal(layout.mobile, true);
    assert.equal(layout.railExpanded, 'false');
    assert.equal(layout.mobileView, 'chat');
    assert.equal(layout.railHidden, 'true');
    assert.equal(layout.railInert, true, 'closed session drawer should be inert');
    assert.ok(layout.rail.right <= 1, 'closed session drawer should be off-canvas');
    assert.equal(layout.inspectorHidden, 'true');
    assertInsideViewport(layout.mobileNav, profile.width, 'mobile navigation');
    assert.ok(layout.mobileNav.height >= 44, 'mobile navigation should expose touch-sized targets');
    assert.equal(intersects(layout.mobileNav, layout.composer), false, 'mobile navigation overlaps composer');

    await client.evaluate("document.querySelector('#mobileInsightsTab').click()");
    const insight = await client.evaluate(`(() => {
      const inspector = document.querySelector('#inspectorPanel');
      const conversation = document.querySelector('#councilConversationPanel');
      const rect = inspector.getBoundingClientRect();
      return {
        view: document.body.dataset.mobileView,
        selected: document.querySelector('#mobileInsightsTab').getAttribute('aria-selected'),
        inspectorHidden: inspector.getAttribute('aria-hidden'),
        inspectorInert: inspector.inert,
        conversationHidden: conversation.getAttribute('aria-hidden'),
        conversationInert: conversation.inert,
        rect: { left: rect.left, right: rect.right, width: rect.width },
      };
    })()`);
    assert.equal(insight.view, 'insights');
    assert.equal(insight.selected, 'true');
    assert.equal(insight.inspectorHidden, 'false');
    assert.equal(insight.inspectorInert, false);
    assert.equal(insight.conversationHidden, 'true');
    assert.equal(insight.conversationInert, true);
    assertInsideViewport(insight.rect, profile.width, 'mobile inspector');
  } else {
    assert.equal(layout.mobile, false);
    assert.equal(layout.railExpanded, 'true');
    assert.ok(layout.rail.width >= 250 && layout.rail.width <= 275,
      `expanded desktop rail should be about 264px, got ${layout.rail.width}`);
    assertInsideViewport(layout.rail, profile.width, 'rail');
    assertInsideViewport(layout.inspector, profile.width, 'inspector');
    assert.equal(intersects(layout.rail, layout.studio), false, 'session rail overlaps the studio');
    assert.equal(intersects(layout.rail, layout.inspector), false, 'session rail overlaps the inspector');
    assert.equal(intersects(layout.rail, layout.composer), false, 'session rail overlaps the composer');
    assert.equal(intersects(layout.composer, layout.inspector), false, 'composer overlaps the inspector');
    assert.ok(layout.conversation.right <= layout.inspector.left + 1,
      'desktop inspector should sit beside the conversation');
  }

  const historyLayout = await client.evaluate(`(() => {
    const panel = document.querySelector('#harnessHistoryPanel');
    panel.open = true;
    const panelRect = panel.getBoundingClientRect();
    const controls = [...panel.querySelectorAll('select, button, pre')].map((item) => {
      const rect = item.getBoundingClientRect();
      return { left: rect.left, right: rect.right, width: rect.width };
    });
    return {
      panel: { left: panelRect.left, right: panelRect.right, width: panelRect.width },
      scrollWidth: panel.scrollWidth,
      clientWidth: panel.clientWidth,
      controls,
    };
  })()`);
  assert.ok(historyLayout.scrollWidth <= historyLayout.clientWidth + 1,
    `${profile.width}px open Harness history has horizontal overflow`);
  assert.ok(historyLayout.controls.every((rect) => (
    rect.width > 0 && rect.left >= historyLayout.panel.left - 1 && rect.right <= historyLayout.panel.right + 1
  )), `${profile.width}px Harness history control escapes its panel`);
  if (profile.width <= 880) await client.evaluate("document.querySelector('#mobileChatTab').click()");
  assert.ok(['local', 'remote'].includes(layout.remoteMode), 'remote mode status hook should be populated');
  assert.ok(layout.connectionState, 'connection state hook should be populated');
}

async function verifyMobileDrawer(client, width) {
  const initial = await client.evaluate(`(() => {
    const button = document.querySelector('#mobileSessionsTab');
    const controlled = document.getElementById(button.getAttribute('aria-controls'));
    const close = document.querySelector('#toggleSessionRail');
    return {
      selected: button.getAttribute('aria-selected'),
      controlsExists: Boolean(controlled),
      title: close.title,
      hiddenLabel: close.querySelector('.sr-only')?.textContent || '',
    };
  })()`);
  assert.equal(initial.selected, 'false');
  assert.equal(initial.controlsExists, true);
  assert.ok(initial.title.trim(), 'rail toggle needs an accessible title');
  assert.ok(initial.hiddenLabel.trim(), 'rail toggle needs a screen-reader label');

  await client.evaluate("document.querySelector('#mobileSessionsTab').click()");
  await new Promise((resolve) => setTimeout(resolve, 260));
  let drawer = await client.evaluate(`(() => {
    const rail = document.querySelector('#sessionRail');
    const rect = rail.getBoundingClientRect();
    return {
      expanded: document.querySelector('#toggleSessionRail').getAttribute('aria-expanded'),
      openClass: rail.classList.contains('is-expanded-mobile'),
      ariaHidden: rail.getAttribute('aria-hidden'),
      inert: rail.inert,
      backdrop: !document.querySelector('#mobileSessionBackdrop').hidden,
      focusedInside: rail.contains(document.activeElement),
      left: rect.left,
      right: rect.right,
    };
  })()`);
  assert.equal(drawer.expanded, 'true');
  assert.equal(drawer.openClass, true);
  assert.equal(drawer.ariaHidden, 'false');
  assert.equal(drawer.inert, false);
  assert.equal(drawer.backdrop, true);
  assert.equal(drawer.focusedInside, true);
  assert.ok(drawer.left >= -1 && drawer.right <= width + 1, 'mobile drawer must remain within the viewport');

  await client.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  drawer = await client.evaluate(`(() => ({
    expanded: document.querySelector('#toggleSessionRail').getAttribute('aria-expanded'),
    openClass: document.querySelector('#sessionRail').classList.contains('is-expanded-mobile'),
    focused: document.activeElement === document.querySelector('#mobileSessionsTab'),
  }))()`);
  assert.equal(drawer.expanded, 'false');
  assert.equal(drawer.openClass, false);
  assert.equal(drawer.focused, true, 'Escape should return focus to the Sessions tab');

  await client.evaluate("document.querySelector('#mobileSessionsTab').click()");
  await new Promise((resolve) => setTimeout(resolve, 20));
  await client.evaluate("document.querySelector('#mobileSessionBackdrop').click()");
  drawer = await client.evaluate(`(() => ({
    expanded: document.querySelector('#toggleSessionRail').getAttribute('aria-expanded'),
    openClass: document.querySelector('#sessionRail').classList.contains('is-expanded-mobile'),
    focused: document.activeElement === document.querySelector('#mobileSessionsTab'),
  }))()`);
  assert.equal(drawer.expanded, 'false');
  assert.equal(drawer.openClass, false);
  assert.equal(drawer.focused, true, 'backdrop click should return focus to the Sessions tab');
}

async function verifyMobileTouchAndComposer(client, profile) {
  await client.evaluate("document.querySelector('#mobileChatTab').click()");
  const touch = await client.evaluate(`(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector).getBoundingClientRect();
      return { width: value.width, height: value.height, left: value.left, right: value.right };
    };
    return {
      tabs: [...document.querySelectorAll('.mobile-workspace-tab')].map((item) => {
        const value = item.getBoundingClientRect();
        return { width: value.width, height: value.height };
      }),
      send: rect('#sendBtn'),
      inputFont: Number.parseFloat(getComputedStyle(document.querySelector('#input')).fontSize),
      safeBottom: getComputedStyle(document.querySelector('.composer')).paddingBottom,
    };
  })()`);
  assert.ok(touch.tabs.every((item) => item.width >= 44 && item.height >= 44),
    'every mobile workspace tab must expose at least a 44px touch target');
  assert.ok(touch.send.width >= 44 && touch.send.height >= 44, 'send control must expose a 44px touch target');
  if (profile.width <= 768) assert.ok(touch.inputFont >= 16, 'mobile text inputs must avoid iOS focus zoom');
  assert.ok(Number.parseFloat(touch.safeBottom) >= 12, 'composer should reserve bottom safe-area padding');

  const compactHeight = Math.min(profile.height, 520);
  await client.evaluate("document.querySelector('#input').focus()");
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: profile.width,
    height: compactHeight,
    screenWidth: profile.width,
    screenHeight: compactHeight,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await new Promise((resolve) => setTimeout(resolve, 120));
  const compact = await client.evaluate(`(() => {
    const composer = document.querySelector('.composer').getBoundingClientRect();
    const input = document.querySelector('#input').getBoundingClientRect();
    return {
      viewportHeight: visualViewport?.height || innerHeight,
      composer: { top: composer.top, bottom: composer.bottom, height: composer.height },
      input: { top: input.top, bottom: input.bottom, height: input.height },
      focused: document.activeElement === document.querySelector('#input'),
      cssViewportHeight: getComputedStyle(document.documentElement).getPropertyValue('--visual-viewport-height').trim(),
    };
  })()`);
  assert.equal(compact.focused, true);
  assert.ok(compact.composer.top < compact.viewportHeight && compact.input.bottom <= compact.viewportHeight + 2,
    'focused composer input must remain usable in a short visual viewport');
  assert.ok(compact.input.height >= 44);
  assert.ok(compact.cssViewportHeight.endsWith('px'), 'visualViewport hook should update a CSS pixel value');

  await client.send('Emulation.setDeviceMetricsOverride', {
    width: profile.width,
    height: profile.height,
    screenWidth: profile.width,
    screenHeight: profile.height,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await client.evaluate("document.querySelector('#input').blur()");
}

async function verifyComposerToggle(client) {
  const initial = await client.evaluate(`(() => ({
    expanded: document.querySelector('#toggleComposer')?.getAttribute('aria-expanded'),
    hidden: document.querySelector('#composerInputArea')?.hidden,
  }))()`);
  assert.equal(initial.expanded, 'true');
  assert.equal(initial.hidden, false);

  await client.evaluate("document.querySelector('#input').focus(); document.querySelector('#toggleComposer').click()");
  const collapsed = await client.evaluate(`(() => ({
    expanded: document.querySelector('#toggleComposer')?.getAttribute('aria-expanded'),
    hidden: document.querySelector('#composerInputArea')?.hidden,
    classApplied: document.querySelector('.composer')?.classList.contains('is-collapsed'),
    focused: document.activeElement === document.querySelector('#toggleComposer'),
  }))()`);
  assert.equal(collapsed.expanded, 'false');
  assert.equal(collapsed.hidden, true);
  assert.equal(collapsed.classApplied, true);
  assert.equal(collapsed.focused, true, 'collapsing must not leave focus in hidden input controls');

  await client.evaluate("document.querySelector('#toggleComposer').click()");
  await new Promise((resolve) => setTimeout(resolve, 20));
  const expanded = await client.evaluate(`(() => ({
    expanded: document.querySelector('#toggleComposer')?.getAttribute('aria-expanded'),
    hidden: document.querySelector('#composerInputArea')?.hidden,
    classApplied: document.querySelector('.composer')?.classList.contains('is-collapsed'),
    focused: document.activeElement === document.querySelector('#input'),
  }))()`);
  assert.equal(expanded.expanded, 'true');
  assert.equal(expanded.hidden, false);
  assert.equal(expanded.classApplied, false);
  assert.equal(expanded.focused, true, 'expanding should make the input immediately ready to use');
}

async function verifyResultPresentation(client) {
  await client.evaluate(`handleEvent({
    id: 'result-presentation-fixture',
    type: 'artifact',
    role: 'orchestrator',
    phase: 'synthesizing',
    cycle: 9,
    planVersion: 9,
    artifactType: 'synthesis',
    modelRoute: { brain: 'codex', model: 'gpt-5.4', effort: 'high' },
    artifact: {
      schemaVersion: 1,
      artifactType: 'synthesis',
      title: '결과 표현 검증용 통합안',
      executiveSummary: '경영진이 바로 판단할 수 있도록 결과 중심으로 정리합니다.',
      decisions: [{ topic: '진입 순서', decision: '파일럿 검증을 먼저 진행한다.', rationale: '증거 공백을 줄인다.', status: 'decided' }],
      nextActions: [{ action: '파일럿 범위를 확정한다.', when: '이번 주', outcome: '검증 계획 승인' }],
      risks: [{ risk: '고객 검증 지연', severity: 'high', trigger: '인터뷰 일정 미확정', mitigation: '대체 고객 후보 확보' }],
      planMarkdown: '## 상세 실행계획\\n\\n- Gate 1을 진행합니다.',
    },
  })`);
  await poll(
    () => client.evaluate("[...document.querySelectorAll('.artifact-card')].some((card) => card.textContent.includes('결과 표현 검증용 통합안'))"),
    { timeout: 5_000, message: 'result presentation fixture was not rendered' },
  );
  const presentation = await client.evaluate(`(() => {
    const card = [...document.querySelectorAll('.artifact-card')]
      .find((item) => item.textContent.includes('결과 표현 검증용 통합안'));
    return {
      sectionTitle: document.querySelector('#artifactTitle')?.textContent,
      text: card?.textContent || '',
      modelSource: card?.querySelector('.artifact-provenance')?.textContent || '',
      readerButton: card?.querySelector('.artifact-actions button')?.textContent || '',
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
  })()`);
  assert.equal(presentation.sectionTitle, '결과 검토');
  assert.match(presentation.text, /핵심 요약/);
  assert.match(presentation.text, /핵심 결정/);
  assert.match(presentation.text, /다음 행동/);
  assert.doesNotMatch(presentation.text, /schemaVersion/);
  assert.doesNotMatch(presentation.text, /artifactType/);
  assert.match(presentation.modelSource, /ChatGPT \(Codex\).*gpt-5\.4.*effort high/);
  assert.equal(presentation.readerButton, '전체 폭으로 읽기');
  assert.equal(presentation.horizontalOverflow, false);

  await client.evaluate(`(() => {
    const card = [...document.querySelectorAll('.artifact-card')]
      .find((item) => item.textContent.includes('결과 표현 검증용 통합안'));
    card?.querySelector('.artifact-actions button')?.click();
  })()`);
  const reader = await client.evaluate(`(() => {
    const dialog = document.querySelector('#artifactReader');
    const rect = dialog.getBoundingClientRect();
    return {
      open: dialog.open,
      width: rect.width,
      viewport: innerWidth,
      body: document.querySelector('#artifactReaderBody')?.textContent || '',
      rawOpen: document.querySelector('.artifact-raw')?.open,
    };
  })()`);
  assert.equal(reader.open, true);
  assert.ok(reader.width >= reader.viewport * .7, 'reader should use a substantially wider reading surface');
  assert.match(reader.body, /상세 실행계획/);
  assert.equal(reader.rawOpen, false, 'raw schema data must remain opt-in');
  await client.evaluate("document.querySelector('#closeArtifactReader').click()");
  const closed = await client.evaluate("document.querySelector('#artifactReader').open");
  assert.equal(closed, false);
}

async function verifyLongStreamOverflow(client) {
  await poll(
    () => client.evaluate(`document.querySelector('#orchestratorMessages')?.textContent.includes(${JSON.stringify('LONG_SSE_')})`),
    { timeout: 5_000, message: 'long SSE fixture was not rendered' },
  );
  const result = await client.evaluate(`(() => {
    const card = [...document.querySelectorAll('#orchestratorMessages .message-card')]
      .find((item) => item.textContent.includes('LONG_SSE_'));
    const code = card?.querySelector('code');
    const cardRect = card?.getBoundingClientRect();
    const codeRect = code?.getBoundingClientRect();
    return {
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      cardOverflow: card ? card.scrollWidth > card.clientWidth + 1 : null,
      codeInside: Boolean(codeRect && cardRect && codeRect.left >= cardRect.left - 1 && codeRect.right <= cardRect.right + 1),
    };
  })()`);
  assert.equal(result.pageOverflow, false, 'long SSE output must not widen the page');
  assert.equal(result.cardOverflow, false, 'long SSE output must wrap inside its message card');
  assert.equal(result.codeInside, true, 'long inline code must remain inside its message card');
}

async function verifyWorkflowVisualization(client) {
  await client.send('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  });
  await client.evaluate(`(() => {
    app.workflowEvents = [];
    app.state = { ...(app.state || {}), config: { ...(app.state?.config || {}), mode: 'planning' } };
    app.cycle = 1;
    app.phase = 'drafting';
    renderWorkflowCycles();
    [
      {
        id: 'cycle-1-package', cycle: 1, type: 'artifact', role: 'orchestrator',
        phase: 'dispatching', artifactType: 'task_package',
        artifact: { artifactType: 'task_package', summary: '두 Agent에 전달할 과업을 정리했습니다.' }
      },
      {
        id: 'cycle-1-claude', cycle: 1, type: 'status', role: 'claude',
        logicalRole: 'claudeWorker', phase: 'drafting', artifactType: 'draft',
        modelRoute: { brain: 'claude', model: 'haiku', effort: 'low' },
        message: 'Claude 초안 작성 중'
      },
      {
        id: 'cycle-1-codex', cycle: 1, type: 'status', role: 'codex',
        logicalRole: 'codexWorker', phase: 'drafting', artifactType: 'draft',
        modelRoute: { brain: 'codex', model: 'gpt-5.4', effort: 'low' },
        message: 'ChatGPT 초안 작성 중'
      }
    ].forEach((event) => handleEvent(event));
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  let state = await client.evaluate(`(() => {
    const cycle = document.querySelector('.workflow-cycle[data-cycle="1"]');
    const rect = (key) => {
      const value = cycle.querySelector('[data-workflow-node="' + key + '"]').getBoundingClientRect();
      return { top: value.top, bottom: value.bottom, left: value.left, right: value.right };
    };
    const claude = cycle.querySelector('[data-workflow-node="claude"]');
    return {
      open: cycle.open,
      orchestrator: rect('orchestrator'),
      claude: rect('claude'),
      codex: rect('codex'),
      synthesis: rect('synthesis'),
      claudeState: claude.dataset.workflowState,
      codexState: cycle.querySelector('[data-workflow-node="codex"]').dataset.workflowState,
      borderAnimation: getComputedStyle(claude, '::before').animationName,
      flowing: cycle.querySelectorAll('.workflow-cycle-connector.is-flowing').length,
      splitConnectors: cycle.querySelectorAll('.workflow-cycle-connector.is-split').length,
      mergeConnectors: cycle.querySelectorAll('.workflow-cycle-connector.is-merge').length,
      splitPaths: cycle.querySelectorAll('.workflow-cycle-connector.is-split .workflow-connector-flow').length,
      mergePaths: cycle.querySelectorAll('.workflow-cycle-connector.is-merge .workflow-connector-flow').length,
      // 화살촉은 쓰지 않는다. SVG 마커는 preserveAspectRatio="none"의 비등방 스케일에
      // 눌려 찌그러지고, CSS 삼각형은 선과 이음새가 떠 보였다. 선만으로 잇는다.
      svgMarkerArrows: cycle.querySelectorAll('.workflow-connector-flow[marker-end]').length,
      cssArrowTips: cycle.querySelectorAll('.workflow-connector-tip').length,
      // 선이 노드 경계까지 닿아야 연결이 끊겨 보이지 않는다.
      pathEndsAtNode: [...cycle.querySelectorAll('.workflow-connector-flow')]
        .every((path) => /V 100$/.test(path.getAttribute('d'))),
      modelText: cycle.textContent,
      followLabel: document.querySelector('#workflowFollowLabel').textContent,
      followPressed: document.querySelector('#workflowFollow').getAttribute('aria-pressed'),
    };
  })()`);
  assert.equal(state.open, true);
  assert.ok(state.orchestrator.bottom < state.claude.top, 'cycle Orchestrator must sit above workers');
  assert.ok(state.claude.right <= state.codex.left + 1, 'planning workers must sit side by side');
  assert.ok(state.synthesis.top > state.claude.bottom, 'cycle synthesis must sit below workers');
  assert.equal(state.claudeState, 'active');
  assert.equal(state.codexState, 'active');
  assert.ok(state.flowing >= 1);
  assert.equal(state.splitConnectors, 1, 'Orchestrator dispatch should render as an explicit split');
  assert.equal(state.mergeConnectors, 1, 'agent return should render as an explicit merge');
  assert.equal(state.splitPaths, 3, 'split connector needs smooth routes to both workers plus a mobile fallback');
  assert.equal(state.mergePaths, 3, 'merge connector needs smooth routes from both workers plus a mobile fallback');
  assert.equal(state.svgMarkerArrows, 0, 'connectors must not regress to distortion-prone SVG marker arrowheads');
  assert.equal(state.cssArrowTips, 0, 'connectors are drawn as lines only, with no arrowhead');
  assert.equal(state.pathEndsAtNode, true, 'connector lines must reach the node edge so the link never looks detached');
  assert.match(state.borderAnimation, /workflow-border-counterclockwise/);
  assert.match(state.modelText, /Claude · haiku/);
  assert.match(state.modelText, /ChatGPT · gpt-5.4/);
  assert.equal(state.followPressed, 'true');
  assert.match(state.followLabel, /자동 추적/);

  await client.evaluate(`handleEvent({
    id: 'cycle-1-synthesis', cycle: 1, type: 'artifact', role: 'orchestrator',
    phase: 'synthesizing', artifactType: 'synthesis',
    artifact: {
      artifactType: 'synthesis',
      executiveSummary: 'Cycle 1 Workflow 종합 결과입니다.'
    }
  })`);
  await client.evaluate(`handleEvent({
    id: 'cycle-2-user', cycle: 2, type: 'user', role: 'user',
    phase: 'dispatching', message: '두 번째 Cycle 피드백'
  })`);
  state = await client.evaluate(`(() => ({
    firstOpen: document.querySelector('.workflow-cycle[data-cycle="1"]').open,
    secondOpen: document.querySelector('.workflow-cycle[data-cycle="2"]').open,
    cycleCount: document.querySelectorAll('.workflow-cycle').length,
    firstText: document.querySelector('.workflow-cycle[data-cycle="1"]').textContent,
  }))()`);
  assert.equal(state.firstOpen, false, 'previous cycles should collapse');
  assert.equal(state.secondOpen, true, 'latest cycle should remain expanded');
  assert.equal(state.cycleCount, 2);
  assert.match(state.firstText, /Cycle 1 Workflow 종합 결과/);

  await client.evaluate(`(() => {
    app.workflowEvents = [];
    app.state.config.mode = 'decision_council';
    app.cycle = 3;
    app.phase = 'anonymous_peer_review';
    const advisors = ['contrarian', 'firstPrinciples', 'expansionist', 'outsider', 'executor'];
    handleEvent({
      id: 'dc-frame', cycle: 3, type: 'artifact', role: 'orchestrator',
      logicalRole: 'councilFramer', phase: 'framing', artifactType: 'decision_frame',
      artifact: { artifactType: 'decision_frame', decision: 'A 또는 B를 선택한다.' }
    });
    advisors.slice(0, 3).forEach((advisor, index) => handleEvent({
      id: 'dc-analysis-' + advisor, cycle: 3, type: 'artifact',
      role: index % 2 ? 'codex' : 'claude', logicalRole: 'councilAdvisor:' + advisor,
      phase: 'independent_analysis', artifactType: 'advisor_analysis',
      modelRoute: { brain: index % 2 ? 'codex' : 'claude', model: index % 2 ? 'gpt-5.4' : 'haiku', effort: 'low' },
      usage: { input_tokens: 100, output_tokens: 20 },
      artifact: {
        artifactType: 'advisor_analysis', advisor,
        headline: '독립 결론 ' + (index + 1),
        assessment: '전제와 선택지를 검토했습니다.',
        recommendation: '작은 검증을 먼저 합니다.'
      }
    }));
    advisors.slice(0, 2).forEach((reviewer) => handleEvent({
      id: 'dc-review-' + reviewer, cycle: 3, type: 'artifact',
      role: 'codex', logicalRole: 'councilReviewer:' + reviewer,
      phase: 'anonymous_peer_review', artifactType: 'peer_review',
      modelRoute: { brain: 'codex', model: 'gpt-5.4', effort: 'low' },
      usage: { input_tokens: 90, output_tokens: 15 },
      artifact: {
        artifactType: 'peer_review', reviewer,
        strongestWhy: '전제와 실행 가능성을 함께 다뤘습니다.'
      }
    }));
  })()`);
  await new Promise((resolve) => setTimeout(resolve, 120));
  state = await client.evaluate(`(() => {
    const cycle = document.querySelector('.workflow-cycle[data-cycle="3"]');
    const active = cycle.querySelector('.workflow-cycle-node.is-active');
    return {
      nodes: cycle.querySelectorAll('.workflow-cycle-node').length,
      advisorNodes: cycle.querySelectorAll('.workflow-advisor-grid .workflow-cycle-node').length,
      progress: cycle.querySelector('.workflow-progress-strip').textContent,
      labels: cycle.textContent,
      activeAnimation: active ? getComputedStyle(active, '::before').animationName : '',
      internalScrollableNodes: [...cycle.querySelectorAll('.workflow-cycle-node')]
        .filter((node) => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY)).length,
      metrics: document.querySelector('#workflowMetrics').textContent,
    };
  })()`);
  assert.equal(state.nodes, 7, 'decision workflow needs Framer, five advisors, and Chair');
  assert.equal(state.advisorNodes, 5);
  assert.match(state.progress, /독립 분석 3\/5/);
  assert.match(state.progress, /익명 평가 2\/5/);
  assert.match(state.labels, /Contrarian/);
  assert.match(state.labels, /First Principles/);
  assert.match(state.labels, /Council Chair/);
  assert.match(state.activeAnimation, /workflow-border-counterclockwise/);
  assert.equal(state.internalScrollableNodes, 0, 'workflow nodes must not create nested scroll containers');
  assert.match(state.metrics, /호출 5/);
  assert.match(state.metrics, /토큰 570/);

  await client.evaluate(`(() => {
    const viewport = document.querySelector('#workflowViewport');
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, bubbles: true }));
  })()`);
  let follow = await client.evaluate(`(() => ({
    pressed: document.querySelector('#workflowFollow').getAttribute('aria-pressed'),
    label: document.querySelector('#workflowFollowLabel').textContent,
  }))()`);
  assert.equal(follow.pressed, 'false', 'manual workflow scrolling must pause auto-follow');
  assert.match(follow.label, /현재 단계로 이동/);

  await client.evaluate("document.querySelector('#workflowFollow').click()");
  follow = await client.evaluate(`(() => ({
    pressed: document.querySelector('#workflowFollow').getAttribute('aria-pressed'),
    label: document.querySelector('#workflowFollowLabel').textContent,
  }))()`);
  assert.equal(follow.pressed, 'true');
  assert.match(follow.label, /자동 추적/);
}

async function verifyDisclosureAccessibility(client) {
  const initial = await client.evaluate(`(() => ({
    buttonLabel: document.querySelector('#expandAllInspector').textContent.trim(),
    summaries: [...document.querySelectorAll('#inspectorPanel details > summary')].map((item) => ({
      text: item.textContent.trim(), tabIndex: item.tabIndex,
    })),
  }))()`);
  assert.ok(initial.buttonLabel, 'expand/collapse-all control needs a label');
  assert.equal(initial.summaries.length, 7);
  assert.ok(initial.summaries.every((item) => item.text && item.tabIndex >= 0),
    'every inspector disclosure summary must be keyboard focusable and named');

  await client.evaluate("document.querySelector('#expandAllInspector').click()");
  let state = await client.evaluate(`(() => ({
    pressed: document.querySelector('#expandAllInspector').getAttribute('aria-pressed'),
    allOpen: [...document.querySelectorAll('#inspectorPanel details')].every((item) => item.open),
  }))()`);
  assert.equal(state.pressed, 'true');
  assert.equal(state.allOpen, true);

  await client.evaluate("document.querySelector('#expandAllInspector').click()");
  state = await client.evaluate(`(() => ({
    pressed: document.querySelector('#expandAllInspector').getAttribute('aria-pressed'),
    allClosed: [...document.querySelectorAll('#inspectorPanel details')].every((item) => !item.open),
  }))()`);
  assert.equal(state.pressed, 'false');
  assert.equal(state.allClosed, true);

  const toggledBySummary = await client.evaluate(`(() => {
    const detail = document.querySelector('[data-harness-role="orchestrator"]');
    const summary = detail.querySelector('summary');
    summary.focus();
    summary.click();
    return detail.open && document.activeElement === summary;
  })()`);
  assert.equal(toggledBySummary, true, 'individual summary should toggle while retaining keyboard focus');
}

async function verifyCouncilRoutingSettings(client) {
  const state = await client.evaluate(`(() => {
    const setup = document.querySelector('#setupBody');
    setup.classList.remove('hidden');
    const mode = document.querySelector('#councilMode');
    mode.value = 'decision_council';
    mode.dispatchEvent(new Event('change', { bubbles: true }));
    const preset = document.querySelector('#councilPreset');
    preset.value = 'codex_primary';
    preset.dispatchEvent(new Event('change', { bubbles: true }));
    const cards = [...document.querySelectorAll('.council-route-card')];
    cards[0].querySelector('.add-fallback').click();
    cards[0].querySelector('.add-fallback').click();
    const config = gatherConfig();
    const panel = document.querySelector('#decisionCouncilConfig');
    const setupCards = [...document.querySelectorAll('#setupBody > .config-card, #setupBody .planning-config-card, #councilRoleGrid .config-card')];
    return {
      visible: !panel.classList.contains('hidden'),
      cards: cards.length,
      presetOptions: preset.options.length,
      primaryBrains: cards.map((card) => card.querySelector('[class$="-primary-brain"]').value),
      fallbackCounts: cards.map((card) => card.querySelectorAll('.fallback-route').length),
      gatheredFallbacks: config.council.advisors.contrarian.fallbacks.length,
      maxParallel: config.council.maxParallel,
      panelOverflow: panel.scrollWidth > panel.clientWidth + 1,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      setupCardOverflow: setupCards.some((card) => card.scrollWidth > card.clientWidth + 1),
      headingsContained: setupCards.every((card) => {
        const heading = card.querySelector('.config-card-title');
        if (!heading) return false;
        const cardRect = card.getBoundingClientRect();
        const headingRect = heading.getBoundingClientRect();
        return headingRect.left >= cardRect.left && headingRect.right <= cardRect.right
          && headingRect.top >= cardRect.top && headingRect.bottom <= cardRect.bottom;
      }),
    };
  })()`);
  assert.equal(state.visible, true);
  assert.equal(state.cards, 6);
  assert.equal(state.presetOptions, 5);
  assert.ok(state.primaryBrains.every((brain) => brain === 'codex'));
  assert.equal(state.fallbackCounts[0], 3);
  assert.ok(state.fallbackCounts.slice(1).every((count) => count === 1));
  assert.equal(state.gatheredFallbacks, 3);
  assert.equal(state.maxParallel, 3);
  assert.equal(state.panelOverflow, false);
  assert.equal(state.pageOverflow, false);
  assert.equal(state.setupCardOverflow, false);
  assert.equal(state.headingsContained, true);
}

async function verifyHarnessHistoryAccessibility(client) {
  await poll(
    () => client.evaluate("document.querySelectorAll('#harnessRevisionList .revision-entry').length >= 2"),
    { timeout: 5_000, message: 'Harness revision history was not rendered' },
  );
  const state = await client.evaluate(`(() => {
    const panel = document.querySelector('#harnessHistoryPanel');
    const summary = panel?.querySelector(':scope > summary');
    summary?.click();
    const controls = ['harnessDiffFrom', 'harnessDiffTo', 'harnessDiffRole', 'loadHarnessDiff', 'rollbackHarness'];
    return {
      open: panel?.open,
      summaryNamed: Boolean(summary?.textContent.trim()),
      controls: controls.map((id) => {
        const control = document.getElementById(id);
        const label = control?.labels?.[0]?.textContent || control?.textContent || control?.getAttribute('aria-label') || '';
        return { id, exists: Boolean(control), label: label.trim() };
      }),
      rollbackDisabled: document.querySelector('#rollbackHarness')?.disabled,
      historyEntries: document.querySelectorAll('#harnessRevisionList .revision-entry').length,
      fromValue: document.querySelector('#harnessDiffFrom')?.value,
      statusLive: document.querySelector('#harnessDiffStatus')?.getAttribute('aria-live'),
    };
  })()`);
  assert.equal(state.open, true, 'Harness history should be independently collapsible');
  assert.equal(state.summaryNamed, true);
  assert.ok(state.controls.every((control) => control.exists && control.label),
    'Harness history controls must exist and have accessible names');
  assert.ok(state.historyEntries >= 2, 'the UI should render prior and current revisions');
  assert.equal(state.fromValue, '0', 'the most recent prior revision should be selected as the baseline');
  assert.equal(state.rollbackDisabled, false, 'a clean idle session may rollback to its prior revision');
  assert.equal(state.statusLive, 'polite');

  await poll(
    () => client.evaluate("document.querySelectorAll('#harnessDiffOutput .diff-change').length > 0"),
    { timeout: 5_000, message: 'structured Harness diff was not rendered' },
  );
  const diff = await client.evaluate(`(() => ({
    path: document.querySelector('#harnessDiffOutput .diff-path')?.textContent || '',
    before: document.querySelector('#harnessDiffOutput .diff-value pre')?.textContent || '',
    after: document.querySelectorAll('#harnessDiffOutput .diff-value pre')[1]?.textContent || '',
    horizontalOverflow: document.querySelector('#harnessHistoryPanel').scrollWidth
      > document.querySelector('#harnessHistoryPanel').clientWidth + 1,
  }))()`);
  assert.ok(diff.path.startsWith('/'), 'diff should expose a structured field path');
  assert.notEqual(diff.before, diff.after, 'diff should expose distinct before and after values');
  assert.equal(diff.horizontalOverflow, false, 'Harness history must not create horizontal overflow');
}

async function verifyHarnessDirtyPreservation(client) {
  const dirty = await client.evaluate(`(() => {
    const input = document.querySelector('#orchestratorHarness');
    const original = input.value;
    input.value = original + '\\n\\n${XSS_MARKER}_DIRTY_EDIT';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return {
      original,
      edited: input.value,
      sendDisabled: document.querySelector('#sendBtn').disabled,
      saveDisabled: document.querySelector('.save-harness[data-role="orchestrator"]').disabled,
      rollbackDisabled: document.querySelector('#rollbackHarness').disabled,
      activeSession: document.querySelector('.session-item[aria-current="true"]')?.dataset.sessionId,
      otherSessionExists: Boolean(document.querySelector('.session-item[aria-current="false"]')),
    };
  })()`);
  assert.equal(dirty.otherSessionExists, true, 'fixture should expose another session');
  assert.equal(dirty.sendDisabled, true, 'dirty Harness should block sending a new instruction');
  assert.equal(dirty.saveDisabled, false, 'dirty Harness should enable its save control');
  assert.equal(dirty.rollbackDisabled, true, 'dirty Harness should block revision rollback');

  const dialogOpening = client.waitForEvent('Page.javascriptDialogOpening');
  const click = client.send('Runtime.evaluate', {
    expression: "document.querySelector('.session-item[aria-current=\"false\"] .session-open').click()",
    awaitPromise: false,
    returnByValue: true,
    userGesture: true,
  });
  const dialog = await dialogOpening;
  assert.equal(dialog.type, 'confirm');
  await client.send('Page.handleJavaScriptDialog', { accept: false });
  await click;

  const afterCancel = await client.evaluate(`(() => ({
    value: document.querySelector('#orchestratorHarness').value,
    activeSession: document.querySelector('.session-item[aria-current="true"]')?.dataset.sessionId,
    sendDisabled: document.querySelector('#sendBtn').disabled,
  }))()`);
  assert.equal(afterCancel.value, dirty.edited, 'cancelled session switch must preserve the dirty Harness text');
  assert.equal(afterCancel.activeSession, dirty.activeSession, 'cancelled session switch must keep the active session');
  assert.equal(afterCancel.sendDisabled, true);

  await client.evaluate(`(() => {
    const input = document.querySelector('#orchestratorHarness');
    input.value = ${JSON.stringify(dirty.original)};
    input.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const cleaned = await client.evaluate("!document.querySelector('#sendBtn').disabled");
  assert.equal(cleaned, true, 'restoring saved Harness text should clear dirty state');
}

async function verifyRollbackConfirmation(client) {
  await poll(
    () => client.evaluate("!document.querySelector('#rollbackHarness').disabled"),
    { timeout: 5_000, message: 'rollback did not become available for a prior revision' },
  );
  const before = await client.evaluate("document.querySelector('#harnessHistoryMeta').textContent");
  const dialogOpening = client.waitForEvent('Page.javascriptDialogOpening');
  const click = client.send('Runtime.evaluate', {
    expression: "document.querySelector('#rollbackHarness').click()",
    awaitPromise: false,
    returnByValue: true,
    userGesture: true,
  });
  const dialog = await dialogOpening;
  assert.equal(dialog.type, 'confirm');
  assert.match(dialog.message, /현재 revision은 이력에 보존/);
  assert.match(dialog.message, /새 revision/);
  await client.send('Page.handleJavaScriptDialog', { accept: false });
  await click;
  const after = await client.evaluate("document.querySelector('#harnessHistoryMeta').textContent");
  assert.equal(after, before, 'cancelled rollback must not change the current revision');

  const acceptedDialog = client.waitForEvent('Page.javascriptDialogOpening');
  const acceptedClick = client.send('Runtime.evaluate', {
    expression: "document.querySelector('#rollbackHarness').click()",
    awaitPromise: false,
    returnByValue: true,
    userGesture: true,
  });
  const confirmation = await acceptedDialog;
  assert.match(confirmation.message, /사용자 고정 필드를 유지/);
  await client.send('Page.handleJavaScriptDialog', { accept: true });
  await acceptedClick;
  await poll(
    () => client.evaluate("document.querySelector('#harnessHistoryMeta').textContent.includes('현재 v2')"),
    { timeout: 5_000, message: 'accepted rollback did not create a new Harness revision' },
  );
  const restored = await client.evaluate(`(() => ({
    missionWasRestored: !document.querySelector('#orchestratorHarness').value
      .includes('Responsive fixture mission with a visible revision diff.'),
    revisions: document.querySelectorAll('#harnessRevisionList .revision-entry').length,
  }))()`);
  assert.equal(restored.missionWasRestored, true, 'accepted rollback should render the restored Harness content');
  assert.ok(restored.revisions >= 3, 'rollback should append history instead of overwriting it');
}

async function verifyXssRendering(client) {
  await poll(
    () => client.evaluate(`document.body.innerText.includes(${JSON.stringify(XSS_MARKER)})`),
    { timeout: 5_000, message: 'XSS canary text was not rendered' },
  );
  const result = await client.evaluate(`(() => ({
    executed: window.${XSS_MARKER} === true,
    injectedNodes: document.querySelectorAll(
      '#sessionList img, #sessionList script, #userMessages img, #userMessages script, '
      + '#artifactList img, #artifactList script, #artifactList iframe, #artifactList [onerror]'
    ).length,
    sessionTitleAsText: [...document.querySelectorAll('.session-item strong')]
      .some((item) => item.textContent.includes(${JSON.stringify(XSS_MARKER)})),
    transcriptAsText: document.querySelector('#userMessages')?.textContent.includes(${JSON.stringify(XSS_MARKER)}),
    artifactAsText: document.querySelector('#artifactList')?.textContent.includes(${JSON.stringify(XSS_MARKER)}),
  }))()`);
  assert.equal(result.executed, false, 'XSS handler executed');
  assert.equal(result.injectedNodes, 0, 'untrusted content created executable DOM nodes');
  assert.equal(result.sessionTitleAsText, true, 'session title canary should remain visible as text');
  assert.equal(result.transcriptAsText, true, 'transcript canary should remain visible as text');
  assert.equal(result.artifactAsText, true, 'artifact canary should remain visible as text');
}

async function verifyRemoteCsrfBootstrap(client, baseUrl) {
  const token = 'remote-csrf-memory-only-fixture';
  await client.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `(() => {
      const NativeEventSource = window.EventSource;
      window.__AI_COUNCIL_EVENT_SOURCE_URLS__ = [];
      function TrackedEventSource(url, options) {
        window.__AI_COUNCIL_EVENT_SOURCE_URLS__.push(String(url));
        return new NativeEventSource(url, options);
      }
      TrackedEventSource.prototype = NativeEventSource.prototype;
      Object.setPrototypeOf(TrackedEventSource, NativeEventSource);
      window.EventSource = TrackedEventSource;
    })();`,
  });
  await client.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/security-context', requestStage: 'Request' }],
  });
  const securityPaused = client.waitForEvent('Fetch.requestPaused');
  const navigating = setViewportAndNavigate(client, baseUrl, { width: 375, height: 844 });
  const securityRequest = await securityPaused;
  assert.match(securityRequest.request.url, /\/api\/security-context$/);
  await client.send('Fetch.fulfillRequest', {
    requestId: securityRequest.requestId,
    responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
    body: Buffer.from(JSON.stringify({
      accessMode: 'tailscale',
      csrfToken: token,
      remoteIdentity: { login: 'hanmir@example.test' },
    })).toString('base64'),
  });
  await navigating;
  await client.send('Fetch.disable');

  const access = await client.evaluate(`(() => ({
    mode: document.querySelector('#remoteModeBadge').dataset.remoteMode,
    accessMode: document.querySelector('#remoteModeBadge').dataset.accessMode,
    text: document.querySelector('#remoteModeBadge').textContent,
    tokenInLocalStorage: Object.values(localStorage).some((value) => value.includes(${JSON.stringify(token)})),
    tokenInSessionStorage: Object.values(sessionStorage).some((value) => value.includes(${JSON.stringify(token)})),
    tokenInUrl: location.href.includes(${JSON.stringify(token)}),
    eventSourceUrls: window.__AI_COUNCIL_EVENT_SOURCE_URLS__ || [],
  }))()`);
  assert.equal(access.mode, 'remote');
  assert.equal(access.accessMode, 'tailscale');
  assert.match(access.text, /Tailscale 비공개/);
  assert.match(access.text, /hanmir@example\.test/);
  assert.equal(access.tokenInLocalStorage, false);
  assert.equal(access.tokenInSessionStorage, false);
  assert.equal(access.tokenInUrl, false);
  assert.ok(access.eventSourceUrls.length >= 1, 'remote UI should still establish its SSE stream');
  assert.ok(access.eventSourceUrls.every((url) => !url.includes(token)), 'CSRF token must never enter an EventSource URL');

  await client.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/session', requestStage: 'Request' }],
  });
  const mutationPaused = client.waitForEvent('Fetch.requestPaused');
  await client.evaluate("document.querySelector('#applySession').click()");
  const mutation = await mutationPaused;
  const headers = Object.fromEntries(Object.entries(mutation.request.headers || {})
    .map(([name, value]) => [name.toLowerCase(), value]));
  assert.equal(headers['x-ai-council-csrf'], token, 'remote mutation should carry the in-memory CSRF token');
  await client.send('Fetch.fulfillRequest', {
    requestId: mutation.requestId,
    responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
    body: Buffer.from(JSON.stringify({ phase: 'ready' })).toString('base64'),
  });
  await client.send('Fetch.disable');
}

async function verifySecurityBootstrapFailure(client, baseUrl) {
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 375,
    height: 844,
    screenWidth: 375,
    screenHeight: 844,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await client.send('Fetch.enable', {
    patterns: [{ urlPattern: '*/api/security-context', requestStage: 'Request' }],
  });
  const paused = client.waitForEvent('Fetch.requestPaused');
  const loaded = client.waitForEvent('Page.loadEventFired', { timeout: 15_000 });
  await client.send('Page.navigate', { url: baseUrl });
  const request = await paused;
  await client.send('Fetch.fulfillRequest', {
    requestId: request.requestId,
    responseCode: 503,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json; charset=utf-8' }],
    body: Buffer.from(JSON.stringify({ error: { message: 'identity unavailable' } })).toString('base64'),
  });
  await loaded;
  await client.send('Fetch.disable');
  await poll(
    () => client.evaluate("document.querySelector('#globalError')?.textContent.includes('접속 보안 확인 실패')"),
    { timeout: 5_000, message: 'security bootstrap failure was not surfaced' },
  );
  const state = await client.evaluate(`(() => ({
    inputDisabled: document.querySelector('#input').disabled,
    sendDisabled: document.querySelector('#sendBtn').disabled,
    setupDisabled: document.querySelector('#applySession').disabled,
    harnessDisabled: document.querySelector('#orchestratorHarness').disabled,
    connection: document.querySelector('#connectionBadge').dataset.connectionState,
    connectionText: document.querySelector('#connectionBadge').textContent,
    eventSourceUrls: window.__AI_COUNCIL_EVENT_SOURCE_URLS__ || [],
  }))()`);
  assert.equal(state.inputDisabled, true);
  assert.equal(state.sendDisabled, true);
  assert.equal(state.setupDisabled, true);
  assert.equal(state.harnessDisabled, true);
  assert.equal(state.connection, 'offline');
  assert.match(state.connectionText, /보안 확인 실패/);
  assert.equal(state.eventSourceUrls.length, 0, 'failed security bootstrap must not open SSE');
}

test('responsive browser regression at 375/768/1440px', { timeout: 120_000 }, async (t) => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-council-responsive-'));
  let server;
  let browser;
  try {
    const store = buildStore(tempRoot);
    server = await startFixtureServer(store);
    browser = await launchBrowser();
    const { client } = browser;
    await client.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `try { localStorage.removeItem('ai-council:session-rail'); sessionStorage.removeItem('ai-council:mobile-view'); } catch (_) {}
        window.${XSS_MARKER} = false;`,
    });

    const profiles = [
      { width: 375, height: 844 },
      { width: 768, height: 1024 },
      { width: 1440, height: 900 },
    ];
    for (const profile of profiles) {
      await t.test(`${profile.width}px layout and collision contract`, async () => {
        await setViewportAndNavigate(client, server.baseUrl, profile);
        await verifyLayout(client, profile);
        await verifyLongStreamOverflow(client);
      });
      await t.test(`${profile.width}px composer collapse control`, async () => {
        await setViewportAndNavigate(client, server.baseUrl, profile);
        await verifyComposerToggle(client);
      });
      if (profile.width <= 880) {
        await t.test(`${profile.width}px mobile drawer contract`, async () => {
          await setViewportAndNavigate(client, server.baseUrl, profile);
          await verifyMobileDrawer(client, profile.width);
        });
        await t.test(`${profile.width}px touch targets and short-viewport composer`, async () => {
          await setViewportAndNavigate(client, server.baseUrl, profile);
          await verifyMobileTouchAndComposer(client, profile);
        });
      }
    }

    await t.test('result cards prioritize business outcomes, provenance, and wide reading', async () => {
      await setViewportAndNavigate(client, server.baseUrl, { width: 1440, height: 900 });
      await verifyResultPresentation(client);
    });

    await t.test('collapsible controls expose keyboard and ARIA state', async () => {
      await setViewportAndNavigate(client, server.baseUrl, { width: 1440, height: 900 });
      await verifyDisclosureAccessibility(client);
    });

    await t.test('workflow shows active nodes, animated transfers, synthesis return, and scroll following', async () => {
      await setViewportAndNavigate(client, server.baseUrl, { width: 1440, height: 900 });
      await verifyWorkflowVisualization(client);
    });

    await t.test('decision routing presets and ordered fallback chains remain editable', async () => {
      await setViewportAndNavigate(client, server.baseUrl, { width: 1440, height: 900 });
      await verifyCouncilRoutingSettings(client);
    });

    await t.test('Harness history controls are collapsible, named, and safe by default', async () => {
      await setViewportAndNavigate(client, server.baseUrl, { width: 1440, height: 900 });
      await verifyHarnessHistoryAccessibility(client);
    });

    await t.test('Harness rollback requires explicit confirmation and cancellation is inert', async () => {
      await setViewportAndNavigate(client, server.baseUrl, { width: 1440, height: 900 });
      await verifyRollbackConfirmation(client);
    });

    await t.test('dirty Harness survives a cancelled session switch', async () => {
      await setViewportAndNavigate(client, server.baseUrl, { width: 1440, height: 900 });
      await verifyHarnessDirtyPreservation(client);
    });

    await t.test('session, transcript, and artifact values remain inert under XSS payloads', async () => {
      await setViewportAndNavigate(client, server.baseUrl, { width: 1440, height: 900 });
      await verifyXssRendering(client);
    });

    await t.test('remote security context stays memory-only and signs mutations without leaking into SSE', async () => {
      await verifyRemoteCsrfBootstrap(client, server.baseUrl);
    });

    await t.test('security bootstrap failure locks mutations and does not open SSE', async () => {
      await verifySecurityBootstrapFailure(client, server.baseUrl);
    });
  } finally {
    if (browser) await browser.close();
    if (server) await server.close();
    fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
