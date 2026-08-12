# Spec 0012 — Order dependence in a run

**Partly built.** A run re-collects a changed subject in a clean
world, and a change that is gone there is reported as order dependence rather
than as a regression — `accept` refuses it, and both the summary and the
per-subject tool say so. What remains is the sharpener and the history.

## The model

The tempting framing is [ADR-0009](../context/adr/0009-sessions-detect-instead-of-rinse.md)'s
— a read/write conflict with a named writer — under which an in-page probe would
turn "order-dependent" into "order-dependent, and `story:toolbar` wrote it".
**That promise is worth much less than it sounds, and the rest of this spec must
not be built on it.**

A probe can only see what a document can read about itself: stylesheets, custom
properties, attributes on the root and body, stray body nodes, the title. The
couplings that actually bite live in module scope — a singleton store, a cached
client, a memoized selector, a clock somebody mocked — and none of them touch
the DOM. There is no second route either: the write happened in an earlier
subject's render, in a frame that returned before this comparison started, and
no stack survives it. Nothing in the observation path reads one.

So the shipped mechanism answers the question it can answer with evidence:

> **observe an outcome → resolve it to a DOM node → to a fiber → to a component
> → to a file. The rest is an agentic flow.**

Which is the same chain every other verdict in this system travels, and the
reason the second pass needed almost no new machinery: it is the existing
comparison, run again against a document collected alone. What the run hands
over is a difference already carrying a region, a component and a source file,
plus proof that a clean world does not show it. Bisecting run order from there
is cheap and general, and it works for the module-scope causes a probe would
have missed entirely.

**Detection generalises; attribution does not.** That is the correction, and
[ADR-0009 carries it](../context/adr/0009-sessions-detect-instead-of-rinse.md)
so a reader of the decision meets it there too.

## The gap, in three checkable facts

1. **The saving is real and it is taken.** `createHarness` is "one browser, one
   page, one navigation, one bundle injection, N captures", and its own comment
   names the price: a bundle that leaks a stylesheet between subjects "makes the
   *next* subject's `unchanged` verdict vacuous". Teardown is delegated to the
   bundle, because the harness "does not know what the previous subject
   installed" — [`packages/playwright/src/harness.ts`](../../packages/playwright/src/harness.ts).

2. **The detector exists and runs nowhere.** `@variance-authority/session` is
   1,060 lines of implementation across four files — the shared-state probe, the
   write ledger, reads derived from each subject's own capture, latent coupling,
   `verify()`, and a `report()` that emits the agent-ready text with a `fix:`
   line. **No manifest in the repo depends on it.** The only references outside
   its own directory are two lines of the documentation gate.

3. **In a real run the shared world is not ours.** The CLI does not call
   `createHarness`; it calls the adopter's collector, once per subject, in a
   loop. `Collector` is three methods at
   [`packages/cli/src/commands/run.ts`](../../packages/cli/src/commands/run.ts),
   and none of them can tell the CLI what persisted between two calls.

**Fact 3 is why fact 2 is true.** `session` is a session *runner* — its own
container, its own mount, its own snapshot, its own hash. Adopting it means
rewriting your collector around it rather than instrumenting the one you have. A
package that can only be used by replacing the thing it would protect gets used
by nobody, and that is what the dependency graph says happened.

So the honest statement of today's behaviour is not "we detect instead of
rinsing". It is: **we neither rinse nor detect, and the verdict absorbs the
difference.**

## What the isolated re-render adds

ADR-0009's confirmation tier re-runs a subject **in the same session** and
compares hashes — `verify()` at
[`packages/session/src/session.ts`](../../packages/session/src/session.ts),
whose own evidence string is "re-running `story:card` in the same session
produced a different render hash".

That varies **time** and holds the **world** fixed. It proves a subject is
unstable and is structurally blind to the more common failure: a leak that is
*deterministic*. If `story:button` always writes `sheet:3` before `story:card`
runs, `story:card` renders the same wrong way in both passes. The hash does not
move. `verify()` reports nothing. Meanwhile the comparison against a baseline
recorded under a different order says `changed`, and the operator is handed a
regression that does not exist.

**A re-render in a clean world varies the world and holds time fixed.** The two
catch disjoint classes, and the one nobody has built is the one that produces
false regressions rather than flakes.

### The discriminator

For a subject the run called `changed`, let `S` be the shared-session render,
`I` the isolated one, `B` the baseline. The premise is `S ≠ B`.

| `I` vs `B` | `I` vs `S` | What it is |
|---|---|---|
| same | differs | **Order-dependence, not a regression.** The baseline is right; the session poisoned this subject. |
| differs | same | **A real change.** It reproduces in a clean world. Report it as today. |
| differs | differs | **Both.** The clean diff is the regression; the `I`/`S` delta is a separate finding against the same subject. |
| same | same | **Contradiction** — it implies `S = B`. Observing it means the hash is unstable within a single subject: a timer, a random value, an unsettled animation. |

Row 4 is the useful surprise. It cannot happen if the pipeline is sound, so
reaching it is a report about the tool, and it costs nothing to name.

Only the first column is needed to classify, and only the first column shipped:
`I = B` is order dependence, anything else leaves the change standing. The `I`
vs `S` column refines a confirmed regression that is *also* order-dependent, and
is not built.

`incomparable` and `new` from the clean comparison are folded into "leaves the
change standing" deliberately. Neither is evidence that the change was a leak,
and reporting "does not reproduce" on the strength of a baseline that could not
be read would clear a real regression.

## What it costs

Full isolation pays one world per subject, always: `N × setup`. This pays
`setup + N × capture` as today, plus one clean collection for each subject that
*differed*.

- **A green run pays nothing.** `K = 0`, and `collectAlone` is never called.
  This is the common case and it is free.
- **A normal red run pays `K` collections and `K` renders** — not `2K`. The
  shared render is already in the render cache under its document digest, so the
  second comparison re-renders only the clean document.
- **A token change makes `K = N`**, and then this approaches the isolation
  regime this project exists not to pay.

The last row is the design constraint rather than a footnote, and it is why
`alone.limit` exists with a default of 20. Exceeding it says so on the subject
rather than silently paying or silently skipping. A tool that gets slowest
exactly when the diff is largest will be turned off on the day it was most
needed.

## What would discharge it

0. ~~**A fourth method on `Collector`.**~~ Shipped as `collectAlone`, optional.
   `undefined` is the honest answer for a collector holding one page open, and
   it arrives as a sentence on the record rather than as silence — read as
   "it reproduces", a missing method promotes every leak with a confirmation
   attached to it.

1. ~~**The second pass, budgeted.**~~ Shipped. It reuses `observePair` and
   `observeAgainstBaseline` rather than comparing anything itself, so the
   clean-world answer inherits attribution, font reporting and the identity
   partition instead of growing its own subtly different versions of all three.

2. **The probe, in-page** — now a *sharpener*, not the mechanism. Where a leak
   does travel through a stylesheet or a custom property, `packages/session`'s
   fingerprints turn one bisection into zero. Everything it reads is available
   from inside the bundle that already runs `capture`. It does not generalise
   (see the corrected model above), so it is worth building for the common case
   and worth nothing as a foundation.

3. ~~**The report surface.**~~ Shipped. `accept` refuses a subject whose change
   did not reproduce — ahead of the image check, because this is the one refusal
   about the *content* of a candidate rather than its availability. The summary
   labels it `order-dependent` instead of `changed`, and the per-subject tool
   leads with "not a component change" before the region list, so an agent does
   not start editing a component nobody touched. Exit code stays `1` under
   [ADR-0017](../context/adr/0017-the-exit-code-is-the-interface.md) — three
   codes, and a suite defect is a verdict, not a crash.

4. **The history.** A subject that is order-dependent *this* run was probably
   order-dependent last run, and the run after a fix should be able to say the
   leak is gone. `@variance-authority/history` has the rows and the drift
   arithmetic and no caller ([spec 0002](0002-history-store.md)); this is a
   second reason to give it one.

5. **A dedicated agent tool.** `variance_findings` is already taken, by
   accessibility defects, in [`packages/mcp/src/tools.ts`](../../packages/mcp/src/tools.ts).
   A leak is a different noun and needs its own tool name rather than a widened
   one. Today it rides on `variance_summary` and `variance_describe`, which is
   enough to act on and not enough to query.

## What this does not reverse

ADR-0009 forecloses "treating a flaky hash as a retry candidate". This is not
that, and the distinction is load-bearing: **the second collection never decides
whether to report, only what to report.** Both outcomes produce output and
neither clears anything — a change that reproduces alone is still `changed`, and
one that does not is still a finding, against the suite instead of the
component. A re-run that can only clear a failure is a retry; a re-run whose
result is reported in every branch is a measurement.

It also does not reverse the no-rinse decision. Nothing here clears state
between subjects. It collects one subject twice, in two worlds, and subtracts.

## Known limits

- **`collectAlone` is the adopter's to implement**, and a wrong one — a "clean"
  world that is not clean — makes order dependence unreachable and every leak
  look like a regression. That is exactly the status quo, so a bad
  implementation costs the wasted renders and nothing else. It cannot be
  verified from this side, and the run does not pretend to.
- **A leak that also reaches the clean world is invisible.** State written to
  disk, to a shared server, or to a `localStorage` the fresh world inherits
  survives the second collection and the change reproduces. The classification
  is then "real change", which is wrong, and there is no signal to say so.
- **`K = N` under a token change** has no clever fix. The budget is the answer,
  and the budget is a number somebody picked.
