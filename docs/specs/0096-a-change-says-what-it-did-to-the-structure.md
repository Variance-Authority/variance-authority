# Spec 0096 — a change says what it did to the structure

**Missing:** a pull request is told what it did to the shape of the
application only when a package changes layer or tier. An edge between two
blocks that the change adds or removes, code that crosses from one block into
another, and an import the architecture chart does not declare all pass
without a line. A planner reading the codebase, a reviewer reading the diff
and the chart in `.compass/` each have to rebuild the structure from the
imports themselves.
**Built on:** `scanRelations` in `@variance-authority/sense` and the code map
`variance index` folds; `packageLayers`, `layerMoves` and `tierMoves`, which
`variance layers --against` prints
([ADR-0080](../context/adr/0080-built-output-is-read-as-its-source.md) for how a build
output is read as its source); `variance restrictions` and its
`.relations.json` rules; and the Compass chart, whose `// compass:` coordinate
heads every source file.

## Purpose

Variance Authority reads two things about a codebase: what the project
declares, and what the code measurably does. The variance is their
difference. Application structure is the coarsest place to read it, and the
place where what to read is least settled.

The readers are named:

- **The pull request.** The `layers` comment, which already clears itself
  when there is nothing to say.
- **A planner that reads the codebase before it changes it.** It reads the
  structure as evidence of how things are, and never as a plan. Drift is a
  state, not a planned change.
- **The chart.** A declaration the measurements contradict is a declaration to
  update, and the reading names the line.

## The open question: what the structure is

The first definition here made an edge an import between two blocks and the
structure the import graph rolled up. That reads the minority signal: in the
field's measurements, 91% of the links between files that change together
have no import behind them, and no recovered architecture can be scored
against a true one. The [prior art](../context/prior-art.md#architecture-that-keeps-what-matters)
holds the figures.

The position this spec now works from, unmeasured:

- **Architecture is what is worth remembering about the code**, the good and
  the bad, without the details. It is coupled to neither the import graph nor
  the execution graph, and it is read from both.
- **A fact is kept because evidence ranks it, and it carries its reason.**
  Candidate signals: the audience of a region (cases that enter it, packages
  that import it), the cost attributed to it, its failures and rejected
  reviews, how often it changes, and where those signals disagree with each
  other and with the declaration.
- **What is kept is small, and forgetting is a policy.** A budget, decay from
  the last time a change, a run or a review touched it, and consolidation from
  file facts into block statements. A superseded fact is marked with when it
  stopped holding, not deleted.
- **It is judged by prediction.** A kept set is worth building only if it
  predicts the next merges' failures and changes better than size, import
  in-degree and a plain change count.

### Blocks and absence

A **block** is a unit of the application's structure at two grains: a
workspace package, derived from the manifest; and a block of the Compass
chart, which owns the files whose `// compass:` coordinate names it.

- A base index with no code map is refused, as `layers` refuses it today. It
  is never read as "no edges".
- A file with no `// compass:` coordinate belongs to no declared block. It is
  counted and named once, and never assigned to the nearest block.
- A declared edge that no import carries may be carried by something the
  scan cannot see: an HTTP call, a queue, a shared store. It is reported as
  **not seen in imports**, never as wrong.

## What exists

- `variance layers --against <base.index>` names each package whose own
  imports changed its layer, with what it started and stopped importing, and
  counts the packages carried with it. With `tiers` declared, it does the
  same for tiers.
- It also names each package whose own imports changed while its layer held,
  so every package edge a change adds or removes is reported once.
- `variance restrictions` fails a change that breaks a declared import rule.

## Measured

A replay over the twenty-five merges to `main` before `0790c915` compared
each merge with its first parent:

| Grain | Edge events | Leaf noise |
|---|---|---|
| Compass block | 1: #162 added an undeclared `reach`–`adjudication` edge | 0 |
| Package | 0: no package edge was added or removed | 0 |

#162 moved the CLI's `names` command module into
`packages/sense/src/test-selection/name-grammar.ts`, coordinate
`adjudication.variations`, and added `case-axes.ts` beside it, coordinate
`reach`, which imports it. The move itself is visible at package grain:

- Git pairs the two files as a rename, at 50% similarity in the commit and
  49% across the merge, so the default threshold of 50% misses it at merge
  grain and `-M40%` finds it.
- Nine of the eleven exported names survived.
- It ran along the `cli`→`sense` edge that already existed, so no package edge
  changed.

What only the declared grain saw is the new import: `case-axes.ts` in `reach`
reads the grammar in `adjudication.variations`, two blocks inside one package
that the chart does not connect.

## What does not

1. **History of the structure.** A share keeps only the latest record of a
   mainline or branch, a source index has no history, and only visual subjects
   have a past. A memory cannot be read from one snapshot; this comes before
   any ranking.
2. **The prediction replay.** Over the last merges of this repository and the
   seven-MUI corpus, a kept set ranked by the signals above is compared with
   size, import in-degree and change count on the next merges' failures and
   changes. If it does not beat them, items 3 to 7 are not built.
3. **Change and co-change from git** for files and packages. Only visual
   component churn is collected.
4. **Audience and cost as ranked outputs.** Crossings per region are recorded
   and never ranked
   ([spec 0049](0049-nothing-can-ask-the-record-where-it-stands.md) names it), and case
   duration is never attributed to the regions a case entered.
5. **Pain joined to source.** Failures, flakes and review outcomes are keyed by
   visual subject or by the latest run, never by file, region or package.
6. **Code crossing a block boundary.** The package-grain reading misses a
   move like #162. On #162, matching by exported name pairs nine of eleven;
   matching by the body's normalized shape is unmeasured.
7. **The declared reading.** Nothing parses the chart's blocks or its
   "Communicates with" and "Uses" sections, so measured and declared edges are
   never compared. A shared vocabulary block, which every block imports, is
   reported once as shared.
8. **A structure for a consumer that cannot import.** One machine format that
   a diagram tool or an orientation phase reads without linking this package.
   It is a format for a consumer, and never a second reading surface.
