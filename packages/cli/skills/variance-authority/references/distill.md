# Distill a test, then verify the reduction

`variance distill` reads no config and no report. The two paths are its whole
input, so it answers in a checkout that has never configured this tool. At least
one of `--eyes` and `--execution` is required. `--format json` returns the same
reading as data, and the `variance_distill` MCP tool returns the same
deterministic reading.

```bash
variance distill --test checkout-submits --eyes eyes.json --execution execution.json
```

## The two input files

**`eyes.json`** is what `writeEyesArchive` wrote (see [producers](producers.md)).
Version `1`, one entry per test, `complete` a boolean the producer set, and
`attention` a sequence of `eyes-phase`, `react-commit`, `react-tap-refused` and
`document-event` entries:

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

Under Vitest, a run wrapped in `withTestSelection` writes the index `covering`
reads, and `--execution` takes that file as it is. Outside Vitest, supply it
from a runner, debugger, editor integration or collector that already records
per-test crossings, or run `distill` with `--eyes` alone.

Those two files, through the command above, answer:

```
checkout submits — src/checkout.test.tsx [checkout-submits]
Eyes journal: complete.
0 target snapshot(s); 0 had no live React Fiber.

act:
  components: none attributed by Eyes
  source: none attributed by Eyes

React update initiators: unavailable; no commit evidence was recorded.

Runtime phase attribution: unavailable; ExecutionIndex retains test crossings, not AAA intervals.
Runtime journey: 1 source file(s) entered by exact test id.
  depth 0 — src/checkout.ts
Covered with no addressed target attributed to the same file: 1.
  distillation opportunity at depth 0 — src/checkout.ts

Loaded but not entered: 0 module(s).
  measured empty
```

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
none of the three can be decided. Discard the edit rather than keep it on an
unavailable reading.

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
- A source file the test ran with no addressed target is a distillation
  opportunity. It is not proof that the code is unrelated, mockable or
  removable.
- Join evidence only on producer identities the tool accepts. Do not fall back
  from a stable test id to a title or a file path.

## Fiber helpers

`@variance-authority/react` exports read-only helpers for a bounded subtree and
a parent chain, for callers that already have a Fiber. Their truncation flag is
evidence: do not continue silently with a partial path. Structural ancestry
follows `return`, not `_debugOwner`.
