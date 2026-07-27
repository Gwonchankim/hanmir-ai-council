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
  const app = createApp({ store, engine: fakeEngine() });
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

    await t.test('collapsible controls expose keyboard and ARIA state', async () => {
      await setViewportAndNavigate(client, server.baseUrl, { width: 1440, height: 900 });
      await verifyDisclosureAccessibility(client);
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
