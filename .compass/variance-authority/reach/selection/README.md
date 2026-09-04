# Selection

«policy»

## Responsibility

Decides which **subjects** a run observes, from the structural ground and the
execution ground together, refusing to narrow at all whenever either ground
cannot answer.

## Bounded context

[Reach](../../DOMAIN.md#reach)

## Inputs and outputs

In: every **subject** the run planned; the paths a diff named and the hunks
behind them; the graph and what it reaches; the components each **baseline**
recorded; the execution record and what it says about the changed lines; and the
affected projects another workspace tool answered with. Out: the narrowed
**subject** list, the reason each excluded **subject** was excluded, the
reachability trail for each reached component, and one note per ground that
declined to rule anything out.

## Depends on

- [`relations`](../relations/README.md) — what a diff reaches, and the chain
  that explains each arrival
- [`closure`](../closure/README.md) — the digest that decides sameness where a ref cannot be trusted
- [`crossings`](../crossings/README.md) — which recorded observations entered a
  changed region, which were whole, and which changed files the record has
  nothing to say about
- [`retention`](../../retention/README.md) — the component names each
  **baseline** recorded, read from its sidecar
- [`acquisition`](../../acquisition/README.md) — the plan of **subjects** the
  narrowing subtracts from
- [`report`](../../report/README.md) — where a **not observed** entry and its
  reason are written down

## Used by

- [`acquisition`](../../acquisition/README.md) — the narrowed **subject** list to reach and read
- [`report`](../../report/README.md) — which **subjects** were not observed,
  why, and by which chain the rest were reached

## Boundary

Everything here is arranged to over-include, because the two mistakes are not
symmetric: a **subject** observed unnecessarily costs a collection, and a
**subject** skipped in error is a green run over an unwatched surface, produced
silently, since the **subject** is not in the report to be missing from. So a
**subject** with no **baseline** is observed, a **baseline** recording no
component list is observed, a changed source file declaring no component makes
the run whole, and a run that cannot list its changed files does not narrow.
When the diff cannot be computed at all the run is refused rather than widened,
because answering a broken query with an empty list would narrow a run to
nothing while reporting success.

Uncertainty widens toward observing more, and the two grounds only ever remove.
The structural ground answers what a change could have moved through the shape
of source; the execution ground removes further, from what the first ground
kept, on the evidence of which regions a **subject** was witnessed to enter — an
edit inside a handler no story fires is one two stories can be ruled out of, and
no reading of the file could have ruled them out. Running the second ground over
the whole plan instead would let a record made before a **subject** existed rule
out a **subject** the diff plainly reaches.

Other build tools contribute **seeds** — more changed input, never a second
opinion and never a selection. Their answer is which projects a diff affects,
which is far coarser than a **subject**; every file under an affected project is
treated as though the diff named it and the graph narrows from there. A failure
of such a tool is fatal rather than empty, because *this diff crosses no package
boundary* is a legitimate answer and must not be confusable with *the tool did
not run*.

Three states look identical from inside a walk and mean different things: a
changed file under the scanned roots that the graph does not hold; a diff no
part of which is in the graph; and a diff whose files reach no component at all,
which is also exactly what a changed file declaring a component the scan failed
to recognise looks like. Each returns its reason instead of an answer. There is
one walk, not two — the caller that narrows and the caller that explains read
the same call, because a run that skipped a **subject** for one reason and
printed another would be worse than one that printed nothing.

It states what it skipped; it does not decide what that costs. It never selects
individual test cases, except where the product owns the execution surface and a
single story is the unit of execution.

## Implementation coordinates

- `packages/cli/src/commands/affected.ts` — `affectedSubjects`, the structural
  ground and every refusal in it
- `packages/cli/src/commands/journey.ts` — `unenteredSubjects`, the execution
  ground and the difference between *the diff reached nobody* and *the record
  recorded nobody*
- `packages/cli/src/commands/reach.ts` — the single walk both the selector and the report read
- `packages/cli/src/commands/run-select.ts` — the half with a disk and a
  subprocess: everything the narrowing needs, gathered once
- `packages/cli/src/commands/since.ts` — the diff against the merge base, and
  the join between the coordinates the version control names files in and the
  ones the run does
- `packages/cli/src/commands/changes.ts` — affected projects from a workspace tool, as **seeds**
- `packages/sense/src/test-selection/select.ts` — `selectTestFilesFromView` and
  `narrowByExecutionFromView`, the same rules over test files

## Diagram

```mermaid
flowchart TB
  REL[relations] --> SEL[selection]
  CLO[closure] --> SEL
  CROSS[crossings] --> SEL
  RET[retention] -->|components a baseline recorded| SEL
  ACQ[acquisition] -->|the planned subjects| SEL
  TOOLS[[workspace project graph]] -->|seeds| SEL
  VCS[[version control]] -->|changed paths and hunks| SEL
  SEL -->|the narrowed subject list| ACQ
  SEL -->|not observed, and why| REP[report]
```
