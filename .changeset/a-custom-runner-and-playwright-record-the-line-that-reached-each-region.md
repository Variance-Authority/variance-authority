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
CommonJS. Over a probed Storybook build the lines add 2.4% to the record, and
the duration stays inside its run-to-run spread. Draining before each statement
also reads a document before a `goto` replaces it, so a case's crossings now
include what that document reached. A drain, the teardown's included, no longer
shows as an `Evaluate` step in the report, the trace or the inspector.
`ExecutionRecorder.note` takes the optional `line` a drain followed. Pass
`cadence: false` to compile specs as Playwright would and write no lines. `@variance-authority/sense/instrument`
exports `cadence` and `columnBehindCut`, the cut and its column map, for a
transform that cuts test files itself.
