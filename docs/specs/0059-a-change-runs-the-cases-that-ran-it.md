# Spec 0059 — a change runs the cases that ran it

**Missing:** the case as the unit everywhere a selection runs. Under Jest and
Vitest, `VARIANCE_AUTHORITY_GRAIN=case` skips the cases of a selected file that
entered none of the changed regions. Playwright and Rstest still run every
selected file whole. A file run in part is recorded incomplete, so the next
selection runs it whole. A selection that reads a stand runs its files whole.
A runner with no seam reads files alone from `variance select`.
**Built on:** `cases.ts` (the per-case record, scoped by async context),
`select-cases.ts` `casesToSkip` (the region-to-case join for a selection),
`case-cut.ts` (the cut, carried from the process that read the selection to its
workers), [ADR-0072](../context/adr/0072-a-change-is-read-before-it-is-charged.md)
(the regions a change is charged to).

## Purpose

Running only the affected tests is the reason to record coverage at all. A test
file is the unit CI shards on. It is not the unit a person or an agent waits
on in a local loop. The record already has the finer answer, and a file-grain
selection throws it away at the last step.

## What exists

**The join answers cases.** `selectSuite` with `grain: 'case'` reads the case
index the record carries and names, for each selected file, the cases that may
be skipped: the ones whose crossings entered none of the regions the selection
charged that file to. A file runs whole when any of these holds:

- a reason other than a region selected it: the file changed, a precondition,
  a reader, an import path;
- the case index does not hold the region the selection named;
- the region, or a case's crossing into it, ran while the module evaluated;
- no case of the file entered the region.

A case whose journey was cut short or not seen to end runs. So does a case
that shares its full name with a case that entered.

**Code outside every case is credited to every case.** A region that ran while
no case was open is marked `loaded`, and charging it runs the whole file, never
the first case that happened to load it.

**The runner skips through its own task modes.** The process that read the
selection writes the cut to one file, keyed by absolute test path. Each worker
marks the named cases skipped after collecting the file and before running it:
Vitest in the case runner's `onCollected`, Jest in a circus `run_start` handler.
A case the file already skips, or leaves out under `only`, keeps its mode.
Nothing reaches argv, so the selection holds at any number of cases. The
stderr line counts the cut: `selected 2 of 3, skipping 3 cases in 2 of them`.

**The grain is chosen, and the gate keeps the file.** File grain is the
default. `VARIANCE_AUTHORITY_GRAIN=case` asks for cases, and any value other
than `file` or `case` fails the run. `yarn verify` sets the file grain.

## What would discharge it

**1. A cut file reads whole again.** A file run in part records the cases it
ran and is marked incomplete, because the cases it skipped recorded nothing.
The next selection runs that file whole, so a loop of edits alternates a cut
run and a whole one. The record would keep the skipped cases' reach from the
run before, and a file whose every case is accounted for would read as complete.

**2. A stand is cut against its own diff.** A stand's tests are read against
the diff since that stand. The cut reads the journal's diff alone, so a
selection with stands runs its files whole.

**3. Playwright and Rstest cut.** Playwright through its test list, Rstest
through its runner's task modes, as Vitest does.

**4. A collision is reported.** When two cases share a full name and only one
of them was reached, both run. The selection's notes would name the
collision, so a person reading stderr sees why a case they expected skipped
ran.

**Acceptance, as scenarios:**

- A change inside a branch that one case of a 200-case file enters runs that
  one case under each of the four runners.
- An edit, a run, and a second edit to the same function cut the file both
  times.
- Two cases named `renders` in one file, one of them selected: both run, and
  stderr names the collision.

## Out of scope

**Parameterized cases.** `it.each` cases have their names formatted before
they run. Each formatted name is recorded as its own case and is selected by
that name. Nothing reconstructs the table.

**Cases that overlap in time.** Concurrent cases are attributed through async
context. A continuation that outlives its case is the case the record refuses to
guess about, and interleaving tests stay unsupported.
