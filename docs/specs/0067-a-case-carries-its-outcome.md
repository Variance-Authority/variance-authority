# Spec 0067 — a case carries its outcome

**Missing:** whether each recorded case passed. The seams hold that answer and
drop it. `taskComplete`, `statusesComplete` and `reportedComplete` in
`packages/sense/src/test-selection/finished-files.ts` read every case's state,
fold it into one `complete` bit per test file, and discard the rest. The
runner's failure message, the failure's location, and the case's duration are
in the same result object, and none of them is kept. Holding an answer and not
using it is the defect ADR-0069 names.
**Built on:** the cases sidecar (`ExecutionTest` in
`packages/sense/src/test-selection/reverse.ts`), the seams that write it, and
[0063](0063-an-editor-asks-about-the-text-it-holds.md) (the reader that
carries it to an editor).

## Purpose

A case that did not finish has not finished its journey. It recorded the places
it reached before it stopped, and nothing about the places it would have gone
next. So the fact the record needs first is not *pass or fail* but *did this
journey end*, and it changes what may be said about absence:

- A region a stopped case entered was entered. That is evidence, like any
  crossing.
- A region no case entered is **unwalked** only when every case that could have
  reached it finished. A case could have reached it when its file imports the
  module, which is the file graph's answer, the same one `loaded` uses.
- Otherwise the region is a **hole**: the record cannot see it, because a
  journey that could have gone there stopped first. The hole names those cases.
- A region with one witness is walked by that case *alone* only when no case
  that could have reached it stopped.
- An observer that stopped did not *miss* a region, so it is not a divergence.

Suppression does not close a hole. CI systems manage flakes by retrying them,
quarantining them or allowing them to fail, and the pipeline stays green. Every
one of those is a journey that stopped, and the regions past the stop stay
holes in the record until a run of that case finishes. A retry that passes
closes it: the finished attempt's journey is whole. The pipeline's colour is
the CI system's decision. The hole is what the record saw.

The outcome itself (which case failed, and on which line) is shown beside this.
It is not a verdict on regions the case never reached.

## What would discharge it

**0. Each case says whether its journey ended.** This is the first fact, and it
is the one the record now writes:

- **One flag per case, three states.** `ExecutionTest.stopped` is `true` for a
  case that stopped, `false` for a case seen to finish, and absent where the
  producer could not see how its cases settled. Absent is neither
  (ADR-0002). On disk it is the byte column `tests.stopped` (0 unsaid,
  1 finished, 2 stopped). The section is optional, so a record written before
  it reads as unsaid rather than as finished.
- **Stopped means the body did not return.** The case scope that already opens
  a journey wraps the case's own function: Vitest's `runTask`, Jest's
  `scopeCase`, Rstest's `wrapCase`. A sync throw or a rejection is `stopped`.
  A return or resolve is `finished`. A bucket still open when the file finishes
  (a timeout the runner abandoned) is `stopped`. The Storybook case is stopped
  when the story did not render or was still suspended. Playwright Test is
  stopped when its completion mark says the test did not complete.
- **A frame carries it by name.** A journal frame's name gains a fourth `\0`
  field, `stopped` or `finished` (`settledCase` in `journal-format.cts`). Join
  keys stay file, name and id, so a frame written before the field joins the
  one written after it. A stopped case writes a frame even with no rows.
- **A retry closes the hole.** When frames or attempts of one case meet (the
  per-case join, the fold, the shard merge and the stitch in Rust), any
  finished one makes the case `finished`. Otherwise any stopped one makes it
  `stopped`. Otherwise it stays unsaid (`settledAcross` in `cases.ts`,
  `settled_across` in `journey_journal.rs`).
- **The reader names stopped cases by the file graph.** A case could have
  reached a module when its file imports it (`affectedBy`), and a stopped case
  that crossed the module anyway is counted too. `stoppedBefore` in
  `reverse.ts` returns the stopped cases that did not enter the target.
  `coveringTestsInFile` and `coveringChange` carry the same list per range and
  per region, as `stopped`. A record in which every case finished needs no
  graph: the list is empty. Otherwise the list is absent without a graph, when
  the graph does not hold the module, and when any case that could have
  reached it is unsaid. The CLI reads the graph only when a case stopped.
- **Words.** With no witness, a non-empty list is a *hole* and an empty one is
  *unwalked*. `variance covering` prints both, and names the stopped cases
  under a hole. A single witness beside a stopped case is not called the only
  witness.

Still to do for item 0:

- The Rust fold used by sharded Jest (`foldJourneyTo`, `stitchJourneysTo`)
  reads each frame as its own test and never joins frames the way
  `executionIndexFrom` does. So one case's frames stay separate tests there,
  each with its own settling. This predates the flag.
- The MCP `variance_changed_tests` and `variance_source_tests` tools read no
  file graph, so they can say *unwalked* only when every case finished. Past
  that they say nothing about holes.
- Divergence (`journeyDivergences`) reads observers per test file, through
  the file's `complete` bit. One stopped case drops the whole file from the
  pool, along with the finished cases whose absences were evidence. A per-case
  pool would keep them.

**1. Each case's outcome, as the runner reported it.** `pass`, `fail`, `skip`
or `todo`, recorded per case in the sidecar. A runner state this list does not
name is recorded as the runner spelled it, not mapped to the nearest one. A
case whose outcome the seam could not read has no outcome. It is not recorded
as a pass.

**2. The failure, where the runner put it.** For a failing case: the first
error's message, and the stack frames that land in a file of this checkout,
each as a repo-relative path and a line. Those are carried from the runner's
own error, after its source maps. Frames in `node_modules` and in the runner
are left out. The top in-checkout frame is where an editor paints the failure.
The frame in the test file is the assertion.

**3. Duration, as the runner measured it.** The runner's duration for the case,
in milliseconds. It is a fact about one run on one machine, so it is shown next
to a test and never gated on.

**4. Output, when the runner hands it over.** The runner's per-case console
output (Vitest's `onUserConsoleLog` carries the task), bounded per case. This
is the one Wallaby facet that needs no product-code instrumentation, and it is
taken only from the runner's reporter.

**5. Every seam, or said per seam.** Vitest, Jest, Rstest, Playwright Test and
the Storybook case each hand over a result object. A seam that cannot provide a
field leaves it absent, and the seam's README states which fields it provides.

**6. The size is gated.** Outcome and duration are a column per case. Message,
frames and output are variable-length, so they are stored only for failing
cases, plus output within the bound. The gate is the sidecar's growth on the
seven-Material-UI corpus with every case passing, which should be the outcome
column alone, and with a tenth of the cases failing.

## What it deliberately does not do

It keeps one run: the run that wrote the record. Outcome history per case
(which case flips, and how often) is the same question `history` answers for
visual subjects, and it gets its own spec once a caller asks for it.
