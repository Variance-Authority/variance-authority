---
'@variance-authority/sense': patch
---

`withTestSelection` and `withJourneyCoverage` now run a Jest project in whose
process something `import`ed a JSON file, most often Babel 8 under `babel-jest`.
Node leaves such a file in `require.cache` as `{ exports, loaded }`, with no
`children` and no `filename`, and every test file used to fail before its first
test with `Cannot read properties of undefined (reading 'includes')`. A custom
environment that requires a file cached this way still counts it as an input.
