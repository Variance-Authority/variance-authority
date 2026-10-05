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
difference. Application structure is the coarsest place to read it. The
declaration is the architecture chart and the import rules. The measurement
is the import graph, rolled up from files to the blocks a person reasons
about.

A structure reading answers three questions about a change:

1. **What edges between blocks did it add or remove?** Derived from the code
   alone, with no declaration.
2. **What did it carry across a block boundary?** Code that left one block
   and arrived in another, which can leave every edge between blocks as it
   was.
3. **Where does the code now disagree with the declaration?** A measured
   edge between two blocks that the chart does not declare, and a declared
   edge that no import carries.

The reader of each answer is named:

- **The pull request.** The `layers` comment, which already clears itself
  when there is nothing to say.
- **A planner that reads the codebase before it changes it.** For example, an
  agent's orientation phase reads the derived structure as evidence of how
  things are, and never as a plan. Drift is a state, not a planned change.
- **The chart.** A declaration that the measured graph contradicts is a
  declaration to update, and the reading names the line.

## Definition

A **block** is a unit of the application's structure. There are two grains:

- **Derived:** a workspace package. Variance Authority computes it from the
  manifest with no input from the project.
- **Declared:** a block of the Compass chart, which owns the files whose
  `// compass:` coordinate names it.

An **edge** between two blocks exists when a file in one imports a file in
the other at runtime. Edges are compared without direction, because a
declared "communicates with" names a flow of data, while an import names who
consumes whom.

**Scale is read from the diff.** The number of blocks a change touches sets
how much is reported. A change across blocks reports edges between blocks and
never the file edges under them. A change inside one block reports the file
edges it added or removed, because at that scale they are the structure. A
reading that lists leaves for a trunk-scale change is noise. Across the
twenty-five merges measured below, the trunk-scale reading produced one event
and no noise.

### Absent is not empty

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

1. **Code crossing a block boundary.** The package-grain reading misses a
   move like #162. A move is read from declarations that left one block and
   arrived in another between the two indexes. On #162, matching by exported
   name pairs nine of eleven; matching by the body's normalized shape is
   unmeasured. Fixtures: a whole
   file renamed across packages, a function extracted and renamed, and a
   function copied with the original kept.
2. **The declared reading.** The edges between Compass blocks, measured from
   the code map and compared with the chart's declared edges. Fixtures: an
   undeclared edge added by the change; a declared edge with no import, read
   as not seen in imports; and a shared vocabulary block, which every block
   imports. That block is reported once as shared, not as an edge to each
   block.
3. **The scale rule.** A change inside one block reports its file edges; a
   change across blocks reports only block edges. Fixture: the same file edge
   reported in a single-block change and silent in a cross-block change.
4. **A structure for a consumer that cannot import.** The derived and declared
   blocks, their edges, and the variance between them, written in one machine
   format that a diagram tool or an orientation phase reads without linking
   this package. It is a format for a consumer, and never a second reading
   surface.
5. **The public page.** [`boundaries.md`](../boundaries.md) states the
   declared reading and lands "block" before any output prints it.
6. **A measurement on a corpus that is not this repository.** The replay above
   on the seven-MUI corpus at package grain, with the time stated against
   `variance layers --against`.
