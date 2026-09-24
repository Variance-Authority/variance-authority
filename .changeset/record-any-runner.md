---
'@variance-authority/sense': patch
'@variance-authority/sense-darwin-arm64': patch
'@variance-authority/sense-linux-arm64-gnu': patch
'@variance-authority/sense-linux-x64-gnu': patch
'@variance-authority/sense-win32-x64-msvc': patch
---

`@variance-authority/sense/runner` records a suite from a runner this package has no seam for. `startRecording` opens the run and folds it, `registerRecording` instruments ES modules, CommonJS and Node-stripped TypeScript through `module.registerHooks` (or `instrumentModule` from the runner's own transform), and `observeTestFile` brackets each test file and case. Processes a runner forks join the recording through `VARIANCE_AUTHORITY_RECORDING`, and the snapshot is the one `variance select` already reads.
