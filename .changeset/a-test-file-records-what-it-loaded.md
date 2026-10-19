---
'@variance-authority/sense': minor
---

A test file can record which files it loaded, with one line per module

Set `mode: 'loads'` on any seam — Vitest, Jest, Rstest, the Node runner or
`testSelectionProbes` — and no module is cut into regions or probed. Each one
runs with one call added after its own text, `globalThis.__VA__.m("<id>")`,
which imports nothing. The run keeps one entry per test file and no cases, and
a change to a file selects every test file that loaded it. On a suite of 925
test files that take 66.8 s, `loads` adds 1.9 s.

A run digests the files its test files ran under once, in the native addon,
rather than once per test file.
