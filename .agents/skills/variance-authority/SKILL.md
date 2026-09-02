---
name: variance-authority
description: Inspect Variance Authority evidence for test-surface reduction, deflaking, live-run diagnosis, visual reports, and React attribution. Use when Variance Authority MCP tools or artifacts are in scope; not as a generic React debugger or test runner.
---

# Variance Authority

Use the product's retained evidence to answer what a test addressed, what React
updated, what source executed, and what a visual run observed. Do not control the
test runner or mutate the page from this skill.

## Start with the inventory

Call `variance_observability` first. Treat an unavailable domain as unknown, not
as an empty reading. If the Variance Authority tools are absent, report the
connection gap; do not reconstruct runtime evidence from repository files.

## Route the question

- For test-surface reduction, call `variance_testing_surface`, then
  `variance_test_attention`. Use `variance_source_tests` for an exact source
  point or file. Read React update initiators before execution-only replay
  candidates.
- For a hang or flake, call `variance_run_signals`, then
  `variance_test_signals`. Use attention and the testing surface to relate the
  live symptom to an authored phase and component path.
- For visual or presentation questions, use the report and presentation tools.
  Keep a current-render finding separate from a regression consequence.
- For a source-to-test question, call `variance_source_tests` directly with the
  narrowest file, line, or function anchor available.

## Read the evidence literally

- `PerformedWork` component names say which render bodies ran.
  `memoizedUpdaters` paths say which live component instances initiated an
  update. Neither proves which source statement scheduled it.
- A missing updater field means the renderer did not expose it. An empty updater
  list means the set was measured and empty.
- Updater paths retain name, key, and props digest. Eyes owner paths retain name
  and props digest, so their overlap uses those shared structural frames. A name
  match alone does not place an updater inside an addressed target.
- Executed source without an addressed target is a replay candidate. It is not
  proof that the code is unrelated, mockable, or removable.
- Join evidence only on producer identities the tool accepts. Do not fall back
  from a stable test id to a title or file path.

## Fiber and live-run boundaries

`@variance-authority/react` exposes read-only bounded subtree and parent-chain
helpers for callers that already hold a Fiber. Their truncation flag is evidence;
do not silently continue with a partial path. Structural ancestry follows
`return`, not `_debugOwner`.

Vantage is an ephemeral loopback observer. The suite must receive its advertised
address before it starts. Observer failure must not fail the subject, and the
observer does not persist a run. Use retained artifacts when the process is gone.

Do not add active page callbacks, event replay, a fixed-port helper, or browser
ownership to answer an inspection question. Those are different capabilities
and require an explicit product decision.
