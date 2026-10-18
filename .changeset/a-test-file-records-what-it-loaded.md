---
'@variance-authority/sense': minor
---

A test file can record which files it loaded, with one line per module

Set `mode: 'loads'` on any seam — Vitest, Jest, Rstest, the Node runner or
`testSelectionProbes` — and no module is cut into regions or probed. Each one
runs with one line added after its own text, the run keeps one entry per test
file and no cases, and a change to a file selects every test file that loaded
it. Nothing is parsed or probed: on a suite of 925 test files that takes 66 s,
`presence` adds 11 s and `loads` adds 7 s.
