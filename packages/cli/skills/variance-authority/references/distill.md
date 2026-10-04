# Distill a test, then verify the reduction

`variance distill` reads no report, and from the root `variance.config.json`
only the declared suites, to find the record `--suite` names; a checkout that
has never configured this tool gets the same answer. Its input is one record:
the one `covering` reads, the declared suite's `--suite` names, or the file
`--execution` names. `--test` takes a case id, an exact title or a part of one,
and `--file` a part of the test file's path; give either or both. More than one
fitting case is refused with their ids. `--file` alone reads the file instead:
the modules it loaded, from the record's coverage rows, that no case entered
and those only some of its cases entered. Each module no case entered is
listed under the import that made the file load it — the topmost import every
path to it runs through, in the test file or a module it used — or as shared by
two imports, or as reached by no static import. The fix is that import, never a
mock of the listed path. It needs a recorded run, not `--execution` JSON, and is
withheld when a case stopped or the file's coverage row is incomplete; run the
file again. Name neither `--test` nor `--file`, and distill reads every test
file of the record the same way, or with `--from <dir>` every one under a
directory from the repository root, and ranks each import by the lines it loads
for nothing, counted once in every test file it reaches: the heaviest import
across a package or a suite. With no `--suite`, that reading takes every
declared suite and names one that has not recorded. `--root` (default: the working
directory) is the root the record's paths are relative to. `--format json`
returns the same reading as data; for a file, the text names ten imports and
three modules a group, and the JSON every module with its `cause`; for many
files, the text names ten imports, and the JSON every import with its modules
and test files. The `variance_distill` MCP tool returns the
same deterministic reading of one case, and needs its test id; the file reading
is the CLI's.

```bash
variance distill --file checkout.test.tsx --test submits
```

## The record

A Vitest, Jest, rstest or Playwright run wrapped in `withTestSelection` writes
the case index `covering` reads into its record. A Playwright run whose `test`
also composes `eyesFixtures` writes each attempt's Eyes journal into the same
record, keyed by the case and its attempt, numbered from 1. See
[producers](producers.md).

A journal is `complete` and a sequence of `eyes-phase`, `react-commit`,
`react-tap-refused`, `document-event`, `rtl-query` and `playwright-locator`
entries. `complete` is the producer's own flag that the journal closed cleanly,
and nothing else. `complete: false` has a `because` field with the reason. It is
**not** a judgement about whether `attention` has anything in it.

`--execution` also takes an `ExecutionIndex` as JSON, from a tool that already
records per-test crossings. JSON carries no journals. It is a `tests` array the
crossings index into by position, and a `modules` array of files with lexical
blocks. Every block needs `kind`, `name` (empty for a module root), `path`,
`startLine`, `endLine`, `source`, and `crossings` of `{test, distance}`:

```json
{
  "tests": [{ "id": "src/checkout.test.tsx > checkout submits", "file": "src/checkout.test.tsx", "name": "checkout submits" }],
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

A record holding that case and one complete, empty journal answers:

```
checkout submits — src/checkout.test.tsx [src/checkout.test.tsx > checkout submits]
Eyes journal, attempt 1: complete.
0 target snapshot(s); 0 had no live React Fiber.

Addressed surface: measured empty.

React update initiators: unavailable; no commit evidence was recorded.

Runtime phase attribution: unavailable; ExecutionIndex retains test crossings, not AAA intervals.
Runtime journey: 1 source file(s) covered by exact case id.
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

Never batch opportunities into one experiment: a passing test would not show
which substitution was justified. A file the test ran with no addressed
attribution is a queue for counterfactual checks, not permission to mock it.

A plain test or a fake component is valid input. With a record that keeps no
Eyes journal, report the source the test ran, and call the opportunity
comparison and attention unavailable. An Eyes journal whose test has
`complete: true` and an empty `attention` array permits the comparison: the
producer closed cleanly and measured nothing, which is a reading.
`complete: false` does not, whatever `attention` contains. Do not invent a Fiber
denominator.

## Read the evidence literally

- `PerformedWork` component names list the render bodies that ran.
  `memoizedUpdaters` paths list the live component instances that started an
  update. Neither proves which source statement scheduled it.
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
