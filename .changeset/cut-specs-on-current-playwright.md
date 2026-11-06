---
'@variance-authority/playwright-test': patch
---

Under `withTestSelection`, each case records the spec line that reached a region on Playwright 1.63 and newer again. Playwright stopped reading `babelPlugins` at 1.63, so the wrapper now hands its plugin to the `PW_TEST_SOURCE_TRANSFORM` environment variables there. Playwright takes one transform there, so a value of your own is refused: unset it, or pass `cadence: false` to keep it and record no spec lines. Older versions keep `babelPlugins`.
