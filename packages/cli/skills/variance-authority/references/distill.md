# Distill a test, then verify the reduction

`variance distill` reads no config and no report, so it answers in a checkout
that has never configured this tool. `--test` takes a recorded id, an exact title or a part of one, and
`--file` a part of the test file's path; give either or both. More than one
fitting test is refused with their ids. The execution
half is the index the last recorded run left, unless `--execution <path>` names
another; `--suite <name>` picks one declared suite's. `--root` (default: the working directory) is the project root
both producers recorded against: Eyes names files by absolute path and the
execution index by project-relative path, and a wrong root leaves the two
unjoined. `--format json` returns the same reading as data, and the
`variance_distill` MCP tool returns the same deterministic reading.

```bash
variance distill --file checkout.test.tsx --test submits --eyes eyes.json
```

## The two input files

**`eyes.json`** is what `writeEyesArchive` wrote (see [producers](producers.md)).
Version `1`, one entry per test, `complete` a boolean the producer set, and
`attention` a sequence of `eyes-phase`, `react-commit`, `react-tap-refused`,
`document-event`, `rtl-query` and `playwright-locator` entries:

```json
{
  "eyesVersion": 1,
  "tests": [
    {
      "id": "checkout-submits",
      "title": "checkout submits",
      "file": "src/checkout.test.tsx",
      "complete": true,
      "attention": [{ "kind": "eyes-phase", "phase": "act", "sequence": 1 }]
    }
  ]
}
```

`complete` is the producer's own statement that the journal closed cleanly, and
nothing else. `complete: false` requires a `because` string saying why. It is
**not** a judgement about whether `attention` has anything in it.

**`execution.json`** is an `ExecutionIndex`: a `tests` array the crossings index
into by position, and a `modules` array of files with lexical blocks. Every
block needs `kind`, `name` (empty for a module root), `path`, `startLine`,
`endLine`, `source`, and `crossings` of `{test, distance}`:

```json
{
  "tests": [{ "id": "checkout-submits", "file": "src/checkout.test.tsx", "name": "checkout submits" }],
  "modules": [
    {
      "file": "src/checkout.ts",
      "blocks": [
        {
          "kind": "function", "name": "submitOrder", "path": "submitOrder",
          "startLine": 10, "endLine": 24, "source": true,
          "crossings": [{ "test": 0, "distance": 0 }]
        }
      ]
    }
  ]
}
```

A Vitest, Jest, rstest or Playwright run wrapped in `withTestSelection` writes
the index `covering` reads into its record, and `distill` reads that record
without being told where. Otherwise, pass `--execution` JSON from a tool that
already records per-test crossings, or run `distill` with `--eyes` alone.

Those two files, through the command above, answer:

```
checkout submits — src/checkout.test.tsx [checkout-submits]
Eyes journal: complete.
0 target snapshot(s); 0 had no live React Fiber.

Addressed surface: measured empty.

React update initiators: unavailable; no commit evidence was recorded.

Runtime phase attribution: unavailable; ExecutionIndex retains test crossings, not AAA intervals.
Runtime journey: 1 source file(s) covered by exact test id.
  depth 0 — src/checkout.ts
Covered with no addressed target attributed to the same file: 1.
  distillation opportunity at depth 0 — src/checkout.ts

Loaded but not covered: 0 module(s).
  measured empty
```

Two fixed paragraphs follow, the substitution rule and the opportunity rule.

## The loop, one opportunity at a time

A **distillation opportunity** is a source file the test ran with no target the
test addressed attributed to it. For each one:

1. Keep the original output as the witness.
2. Find the narrowest reversible substitution at one dependency boundary.
3. Change only that boundary and rerun the exact test, with the project's own
   runner, from your shell. This is the one place the loop edits the tree; the
   read-only rule in `SKILL.md` governs how questions are answered, not whether
   you may run a test.
4. Collect the same evidence and distill it again.
5. Keep the edit only when the assertion's causal path and addressed targets
   remain, and no outside update initiator newly reaches the retained surface.

Read all three conditions in step 5 off the second distillation, from three
named lines, and compare each with the witness line for line:

- **Addressed targets** — the per-phase `components:` and `source:` lines under
  `assert:`. They must still name what they named before. `Addressed surface:
  measured empty` on the second reading and not the first is a loss, not a
  pass.
- **The assertion's causal path** — the `assert:` phase's `source:` list: the
  files Eyes attributed to the assertion's targets.
- **No outside initiator** — `React update initiators:` prints `inside addressed
  component paths:` and `outside addressed component paths:` per phase. A path
  under `outside` on the second reading and not the first fails the condition.

`React update initiators: unavailable; no commit evidence was recorded` means
the third condition cannot be decided. Discard the edit rather than keep it on
an unavailable reading.

Never batch opportunities into one experiment: a passing test would not say
which substitution was justified. A file the test ran with no addressed
attribution is a queue for counterfactual checks, not permission to mock it.

A plain test or a fake component is valid input. With execution evidence and no
Eyes archive, report the source the test ran, and call the opportunity
comparison and attention unavailable. An Eyes journal whose test has
`complete: true` and an empty `attention` array permits the comparison: the
producer closed cleanly and measured nothing, which is a reading.
`complete: false` does not, whatever `attention` contains. Do not invent a Fiber
denominator.

## Read the evidence literally

- `PerformedWork` component names say which render bodies ran.
  `memoizedUpdaters` paths say which live component instances started an update.
  Neither proves which source statement scheduled it.
- A missing updater field means the renderer did not expose it. An empty updater
  list means the set was measured and empty.
- Updater paths keep name, key and props digest. Eyes owner paths keep name and
  props digest, so their overlap uses those shared frames. A name match alone
  does not place an updater inside an addressed target.
- Join evidence only on producer identities the tool accepts. Do not fall back
  from a stable test id to a title or a file path.

## Fiber helpers

`@variance-authority/react` exports read-only helpers for a bounded subtree and
a parent chain, for callers that already have a Fiber. Their truncation flag is
evidence: do not continue silently with a partial path. Structural ancestry
follows `return`, not `_debugOwner`.
