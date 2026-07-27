# Responsive browser regression

This suite starts an ephemeral AI Council server with a temporary `StateStore` and an engine that throws if any agent run is attempted. It launches installed Microsoft Edge or Google Chrome in headless mode through the Chrome DevTools Protocol, so no Claude or Codex quota is consumed.

Run it separately from the normal unit suite:

```powershell
npm run test:browser
```

위 script는 `node --test --test-concurrency=1 tests/browser/responsive-ui.browser.js`를 실행합니다.

The runner checks:

- layout and horizontal overflow at widths 375, 768, and 1440 pixels;
- rail, inspector, and composer collision boundaries;
- mobile drawer Escape and outside-click behavior with focus return;
- inspector disclosure labels, ARIA state, and keyboard focus;
- Harness revision-history disclosure, accessible control names, and safe disabled rollback defaults;
- unsaved Harness preservation when a session switch is cancelled;
- inert rendering of hostile session-title, transcript, and artifact strings.

Microsoft Edge or Google Chrome is discovered from standard Windows locations. Set `AI_COUNCIL_BROWSER` to an explicit Chromium executable when needed.

Playwright is intentionally not required. If the project later standardizes on Playwright, add `@playwright/test` as a dev dependency and translate this contract into a Playwright spec; do not run `npx playwright install` merely to execute this dependency-free suite.
