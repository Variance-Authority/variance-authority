---
'@variance-authority/sense': minor
---

A test file can record which files it loaded, with one line per module

Set `mode: 'loads'` on any seam — Vitest, Jest, Rstest, the Node runner or
`testSelectionProbes` — and no module is cut into regions or probed. Each one
runs with one line added after its own text, the run keeps one entry per test
file and no cases, and a change to a file selects every test file that loaded
it. Nothing is parsed or probed: on TanStack Query's `query-core`, `presence`
adds 0.29 s to a 1.19 s run, and `loads` adds 0.17 s.
