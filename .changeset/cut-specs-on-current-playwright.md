---
'@variance-authority/playwright-test': patch
---

Under `withTestSelection`, each case records the spec line that reached a region on Playwright 1.63 and newer again. Playwright stopped reading `babelPlugins` at 1.63, so the wrapper now hands its plugin to the `PW_TEST_SOURCE_TRANSFORM` environment variables there, and replaces any value of your own. Older versions keep `babelPlugins`.
