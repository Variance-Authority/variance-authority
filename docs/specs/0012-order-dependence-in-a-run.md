# Spec 0012 — Order dependence in a run

**Not built.** The run path takes the corner-cut [ADR-0009](../context/adr/0009-sessions-detect-instead-of-rinse.md)
argued for, and none of the detection ADR-0009 built.

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

## What it costs

Full isolation pays one world per subject, always: `N × setup`. This pays
`setup + N × capture` as today, plus one clean world for each subject that
*differed* — `K × (setup + capture)`.

- **A green run pays nothing.** `K = 0`. This is the common case and it is free.
- **A normal red run pays `K` worlds**, where `K` is the size of the regression,
  and it pays them exactly where they buy an attribution.
- **A token change makes `K = N`**, and then this is *worse* than isolation by
  one shared pass.

The last row is not a footnote, it is the design constraint: **the isolated pass
needs a budget**, and exceeding it must produce "too much changed to attribute"
rather than silently paying `2N`. A tool that gets slowest exactly when the
diff is largest will be turned off on the day it was most needed.

## What would discharge it

Ordered. Each is usable without the next.

0. **A fourth method on `Collector`,** optional, so a collector that cannot
   build a clean world says so instead of being assumed to have one:

   ```ts
   interface Collector {
     plan(): Promise<Plan>;
     collect(subject: PlannedSubject): Promise<Collected>;
     /** Collect again in a world nothing else has touched. */
     isolate?(subject: PlannedSubject): Promise<Collected>;
     close(): Promise<void>;
   }
   ```

   `undefined` is the honest answer for a collector holding one page open, and
   the run must report the absence rather than reading it as "nothing leaked" —
   the standing constraint in [the README](README.md).

1. **The second pass, budgeted,** over subjects whose verdict was `changed`,
   producing the four-row discrimination above. Nothing new is stored: the
   isolated document goes through the same compare path the first one did.

2. **The probe, in-page.** Everything `packages/session` fingerprints —
   stylesheets, root custom properties, root and body attributes, stray body
   children, title — is readable from inside the bundle that already runs
   `capture`. This is what turns "order-dependent" into "order-dependent, and
   `story:toolbar` wrote it". Without item 2, item 1 still names the *victim*
   and proves it is not a regression, which is most of the value.

3. **The report surface.** An order-dependence is not a visual regression and
   must not be acceptable as a baseline: `accept` has to refuse it. Exit code
   stays `1` under [ADR-0017](../context/adr/0017-the-exit-code-is-the-interface.md)
   — three codes, and a suite defect is a verdict, not a crash.

4. **The agent surface.** `variance_findings` is already taken, by accessibility
   defects, in [`packages/mcp/src/tools.ts`](../../packages/mcp/src/tools.ts).
   A leak is a different noun and needs a different tool name, not a widened
   one.

## What this does not reverse

ADR-0009 forecloses "treating a flaky hash as a retry candidate". This is not
that, and the distinction is load-bearing: **the second render never decides
whether to report, only what to report.** Every one of the four rows produces
output. A re-run that can only clear a failure is a retry; a re-run whose result
is reported in every branch is a measurement.

It also does not reverse the no-rinse decision. Nothing here clears state
between subjects. It renders one subject twice, in two worlds, and subtracts.

## Known limits before anything is built

- **Module-level state is still invisible to the probe** (ADR-0009's own limit).
  Item 1 catches the *symptom* regardless, because a clean world resets a
  singleton too. Item 2 reports no culprit, which stays the correct answer
  rather than a wrong one.
- **`isolate` is the adopter's to implement**, and a wrong one — a "clean" world
  that is not clean — makes row 1 unreachable and every leak look like a
  regression. That is the status quo, so a bad implementation costs nothing
  beyond the wasted renders, but it cannot be verified from this side.
- **`K = N` under a token change** is stated above and has no clever fix. The
  budget is the answer, and the budget is a number somebody has to pick.
