---
'@variance-authority/sense': minor
'@variance-authority/playwright-test': minor
---

A custom runner and a Playwright spec record the test line that reached each region

`startRecording` takes `cadence`, `registerRecording` cuts the test file it
observes, and `cutTestFile` cuts one for a runner with its own transform, so a
runner of your own records each case's lines as the Vitest, Jest and Rstest
seams do. `withTestSelection` compiles every Playwright spec with a Babel plugin
that waits before each statement while every frame of every page is drained,
and charges what each drain finds to the statement before it. It also adds
Sense's `dist/` to `build.external`, which Playwright would otherwise load as
CommonJS. On a synthetic suite of 800 statements the lines add 18.9% to a
record made of nothing but them, and the duration stays inside its run-to-run
spread. Pass `cadence: false` to compile specs as Playwright would and write no
lines.
