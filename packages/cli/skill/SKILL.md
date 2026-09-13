---
name: variance-authority
description: Use when asked to inspect, explain, distil, or verify a Variance Authority run, watcher, evidence artifact, or MCP connection.
---

# Variance Authority

Read the product's retained evidence to answer what a visual run observed, what a
test addressed, what React updated, and what source executed. Do not control the
test runner or mutate the page from this skill.

Choosing which tests to run after an edit, and which of them to run first, is a
different question with its own skill: `variance-test-selection`, shipped at
`packages/sense/skill/SKILL.md`.

## Ask the run, from the shell

`variance ask` answers from the report the last run wrote. It needs the CLI and
nothing else — no server, no client configuration, no connection:

```
variance ask                          # the questions, and what each one answers
variance ask summary                  # start here; every other question takes an id it prints
variance ask changes                  # the distinct changes behind the changed subjects
variance ask describe --subject <id>  # one subject: regions, components, files, fingerprints
variance ask locate --query "<words>" # the subject you can only describe, by the names the run saw
```

Each answer is text, produced by the same function an MCP client would call, so
nothing is lost by asking this way. `variance ask` exits `0` for every answer,
including one that describes changes; the verdict belongs to `variance run` and
`variance report`, which exit `1` when something needs review. Do not read a `1`
from those as a crash — a crash is `2`.

## Ask in order

1. **`summary`** — verdict counts, the subjects needing attention, and the
   subjects that were not observed at all. Unobserved is not unchanged.
2. **`changes`** — a token edit touching forty stories is one change, not forty.
   Ask this before asking about any individual subject; it decides how many of
   the remaining questions are worth spending.
3. **`adjudicate --claims <path>`** — only if you made the edit. Declare what you
   meant to change *before* reading the diff. Its third answer — declared, and
   did not happen — is how you learn an edit never landed, which no comparison of
   images can tell you. Claims copied out of `changes` score the run against
   itself and are worthless.
4. **`composition`** before calling anything flaky: it names what explains a
   movement, and separates `flake` (read twice, differed) from `suspect` (never
   read twice).
5. **`locate --query <words>`** when you can describe the subject but do not
   hold its id: it matches over every name the run wrote down — ids, examples,
   accessible names, text, components, creators, files, roles, tokens, and the
   regions a journey entered — and each hit prints the field it matched. The
   order is orientation; a wrong first hit costs one more question, never a
   finding. `composition --subject <id>` then says what that subject is made of.
6. **`describe`, `explain-verdict`, `trace-component`, `findings`** — narrow, one
   subject or one component at a time, once you know which one matters.
7. **`changelog`** before proposing an accept, and never after: it previews what
   acceptance would write down.

`variance ask diff` compares the run against whatever the previous question was
answered from. Use it to see what a re-run moved.

## Ask a suite that is still running

A finished run left a file. A suite in flight has not, and what it says exists
only in whatever was listening at the time — so start the listener first, in its
own shell:

```
variance watch                         # prints VARIANCE_AUTHORITY_VANTAGE=…, stays up
```

Start the suite with that exact assignment in its environment. An address added
afterwards belongs to the next run. Then, from anywhere that can reach it:

```
variance ask self                      # where it listens, and what it is holding
variance ask run-signals               # tests in opening order; the one still going is marked
variance ask test-signals --test <id>  # one test's announcements, and work that never ended
variance ask diff                      # what moved since the last reading it handed out
```

`--at <address>` names the watcher and defaults to `VARIANCE_AUTHORITY_VANTAGE`.

Ask `self` first. A suite reporting to a different address and a suite that
never started are indistinguishable from every other question, and both look
like a quiet run. An empty announcement list for a listed test is a wiring or
application signal — it is not permission to reconstruct a trace from source.

None of this is written down. Stop the watcher and the run is gone; the suite
must extend `varianceFixtures` for any of it to arrive.

## When there is an MCP connection

The same questions arrive as `variance_*` tools — the report ones, and the live
ones from `variance-authority-mcp --watch`. The routing above is unchanged. A
connection additionally serves subjects the CLI does not read:

- Test distillation: `variance_distill`, then `variance_test_attention` for the
  chronology or `variance_source_tests` for an exact source point. Read React
  update initiators before execution-only opportunities.
- `variance_observability` first when several domains are connected at once, to
  see which are actually present.

Treat an unavailable domain as unknown, not as an empty reading. Do not
reconstruct runtime evidence from repository files.

## When evidence is unavailable

Connect the producer that owns the missing fact; MCP reads evidence and creates
none of it:

- **Eyes attention:** with Playwright, compose `eyesFixtures` into the suite's
  existing extension and retain each test's journal under `testInfo.testId`.
  With RTL, start `watchTest` in per-test setup, publish its closed journal, and
  fold the run directory once in global teardown. In either host, declare
  `arrange`, `act`, and `assert` with the adapter log's `phase(...)`; do not
  infer them from query or click names. The Playwright fixture installs the React commit tap
  before navigation. RTL needs the tap installed before `react-dom` loads. Read
  `@variance-authority/eyes`'s README before wiring either adapter.
- **Runtime journey:** `variance_source_tests` and `variance_distill` require an
  `ExecutionIndex` with stable per-test ids. `@variance-authority/sense` ships
  this query contract but no per-test producer; its test-selection snapshot is
  per test file and cannot substitute. Supply the index from a runner, debugger,
  editor integration, or another collector that already owns per-test
  crossings.
- **Live journey/events:** compose `varianceFixtures`, start `variance watch` or
  `variance-authority-mcp --watch` first, then start the suite with the exact
  `VARIANCE_AUTHORITY_VANTAGE` assignment it prints. The address belongs to that
  watcher and that run.
- **Visual report:** set the CLI configuration's `report` path and run
  `variance run`; supply the resulting `RunReport`, not the configuration or a
  reconstructed comparison.
- **Presentation reading:** call `sensePresentation` from
  `@variance-authority/presentation/playwright` on a live subject and supply the
  returned `PresentationReport`. A durable presentation signal embedded in a
  run report is a different, smaller reading.
- **Scenario AAA:** use `@variance-authority/scenario` to record authored
  Arrange state and Act transitions from host-produced semantic snapshots; use
  its archive entrypoint when those executions must outlive the process.

The public integration guides are under
`https://variance-authority.dev/reference/packages/`; the cross-entrance routing
is at `https://variance-authority.dev/agents/questions`.

## Distill, then verify

When portable Eyes and execution files are available without MCP, start with:

```
variance distill --test checkout-submits --eyes eyes.json --execution execution.json
```

The CLI and `variance_distill` MCP tool return the same deterministic reading.
For each distillation opportunity:

1. Preserve the original output as the witness.
2. Identify the narrowest reversible substitution at one dependency boundary.
3. Change only that boundary and rerun the exact test.
4. Collect the same evidence and distill it again.
5. Keep the edit only when the assertion's causal path and addressed targets
   remain, and no outside update initiator newly reaches the retained surface.

Never batch opportunities into one experiment: a passing test would not say
which substitution was justified. An entered file without addressed attribution
is a queue for counterfactual checks, not permission to mock it.

A plain test or fake component is valid input. With execution evidence and no
Eyes archive, report entered source but call the opportunity comparison and
attention unavailable. A complete empty Eyes journal licenses the comparison.
Do not invent a Fiber denominator.

## Read the evidence literally

- `PerformedWork` component names say which render bodies ran. `memoizedUpdaters`
  paths say which live component instances initiated an update. Neither proves
  which source statement scheduled it.
- A missing updater field means the renderer did not expose it. An empty updater
  list means the set was measured and empty.
- Updater paths retain name, key, and props digest. Eyes owner paths retain name
  and props digest, so their overlap uses those shared structural frames. A name
  match alone does not place an updater inside an addressed target.
- Entered source without an addressed target is a distillation opportunity. It is not
  proof that the code is unrelated, mockable, or removable.
- Join evidence only on producer identities the tool accepts. Do not fall back
  from a stable test id to a title or file path.

## Fiber and live-run boundaries

`@variance-authority/react` exposes read-only bounded subtree and parent-chain
helpers for callers that already hold a Fiber. Their truncation flag is evidence;
do not silently continue with a partial path. Structural ancestry follows
`return`, not `_debugOwner`.

Observer failure must not fail the test subject: a watcher that was not there
changes nothing about what the suite did. Once the process is gone the question
belongs to a retained artifact, not to a reconstruction.

Do not add active page callbacks, event replay, or browser ownership to answer
an inspection question. Those are different capabilities and require an
explicit product decision. Vantage's environment value is both opt-in and the
collision-free address of the current watcher; a constant port does not remove
the need for the opt-in boundary.
