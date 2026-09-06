---
name: variance-authority
description: Question Variance Authority evidence about a visual run — what changed, what explains it, what a component reached, and whether an intended edit landed. Also covers test-surface reduction, deflaking, live-run diagnosis, and React attribution where those readings are connected. Use when a Variance Authority report, watcher, or MCP connection is in scope; not as a generic React debugger or test runner.
---

# Variance Authority

Read the product's retained evidence to answer what a visual run observed, what a
test addressed, what React updated, and what source executed. Do not control the
test runner or mutate the page from this skill.

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

- Test-surface reduction: `variance_testing_surface`, then
  `variance_test_attention`; `variance_source_tests` for an exact source point.
  Read React update initiators before execution-only replay candidates.
- `variance_observability` first when several domains are connected at once, to
  see which are actually present.

Treat an unavailable domain as unknown, not as an empty reading. Do not
reconstruct runtime evidence from repository files.

## Read the evidence literally

- `PerformedWork` component names say which render bodies ran. `memoizedUpdaters`
  paths say which live component instances initiated an update. Neither proves
  which source statement scheduled it.
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

Observer failure must not fail the test subject: a watcher that was not there
changes nothing about what the suite did. Once the process is gone the question
belongs to a retained artifact, not to a reconstruction.

Do not add active page callbacks, event replay, a fixed-port helper, or browser
ownership to answer an inspection question. Those are different capabilities and
require an explicit product decision.
