# Spec 0063 — a case read two ways is compared with itself

**Missing:** a second reading of a case, and anything that compares it with the
first. The case index (`<coverage file>.cases.bin`) is rewritten whole by every
run and does not say what source it was recorded over. So a case whose journey
depends on state something else left behind is recorded once and trusted. The
memoized fixture proves what that costs: a case answered from a cache is not a
reader of the function behind it, and a case answered from a cache filled under
a mock is not a reader of the function that was mocked
([`memoized.integration.test.ts`](../../packages/sense/src/test-selection/memoized.integration.test.ts)).
Case selection (0059) would skip both.
**Built on:** `writeCaseIndex` and the case fold (`case-fold.ts`), `ExecutionTest`
ids derived from file and name, `journeyDivergences` (the same comparison across
observers of one module, within one recording).

## Purpose

Two readings of one case over the same source should run the same regions. When
they do not, the case reads state it did not set, and its record cannot be
trusted to skip it. That is the whole test. No order has to be recorded and
nothing has to be shuffled, because the second reading already happens:

- **A focused run.** Case selection runs only the affected cases, so each of
  them runs without the cases that ran before it in the full run.
- **A run with the runner's per-case isolation on, and one with it off.** The
  isolated reading is the clean one; the shared reading is the one a cache or a
  leftover mock can change.

The second source is also where the performance is. Per-case isolation is paid
on every case, and most suites switch it on for a few cases that need it. A file
whose cases read the same with isolation off does not need it, and the record
can say so with evidence. A file whose cases differ is the finding, with the
regions that differ, and the fix is guided rather than rinsed.

Files are not in scope. The runners here isolate test files by default, so the
state that leaks is within a file.

## What would discharge it

**1. The index says what source it stands on, and git answers it.** Each module
row records the git object name of the text it was instrumented from. Git
already knows it; nothing is hashed by us. Two readings of a case are comparable
only when every module the case ran has the same object name in both.

**2. A run replaces only the cases it ran.** A focused run of five cases must not
leave an index of five cases. The fold keeps every case the run did not run, and
for each case it did run, compares the new reading with the old one before
replacing it.

**3. Unequal readings make a case unstable.** The verdict names each region only
one reading ran, and says how each reading was made: a full run or a focused
one, with per-case isolation on or off, and the seed when the runner shuffled.
The index keeps the union of both readings, so a later change to either region
selects the case. Case selection answers a file holding an unstable case at file
grain, because a third reading may show a region neither of these ran. The mark
stays until the object name of the test file, or of a module holding a named
region, changes.

**4. Per-case isolation is derived, not read from configuration.** A module whose
top level runs again while a case is open was evaluated for that case. The
recording already knows which regions ran at load time; it records, per case,
whether the module graph was fresh. That covers Jest's `resetModules`, a
`vi.resetModules()` in a `beforeEach`, and `jest.isolateModules`, without asking
which one the suite used. For a browser case, the collector reports whether the
page it read was one the case opened.

| Runner | Per-case isolation the user already controls |
|---|---|
| Jest | `resetModules`, `jest.isolateModules`; `restoreMocks`, `resetMocks`, `clearMocks` |
| Vitest | `vi.resetModules()` in a hook; `restoreMocks`, `mockReset`, `clearMocks`, `unstubGlobals`, `unstubEnvs` |
| Rstest | `restoreMocks`, `resetMocks`, `clearMocks`, `unstubGlobals`; `isolate` is per file |
| Playwright | a fresh context and page per test by default; a worker-scoped fixture shares one |

The mock options cost little and are out of this spec's interest. Module reset
and a fresh page are the expensive ones, and a mock restore does not empty a
cache: the memoized fixture fails with `vi.restoreAllMocks` after every case.

**5. `variance journeys` says where isolation can go.** For each file read both
ways, it lists one of two things:

- **Removable:** every case read the same regions with per-case isolation on and
  off. It shows the wall time of the file under each reading, as measured, and
  gates on neither.
- **Needed:** the unstable cases, with the regions only the isolated reading ran.
  That is the state the isolation is hiding, and removing the dependency is the
  fix.

Nothing changes the user's configuration. The user turns isolation off in their
own command, and the record says what that did.

**Acceptance, as scenarios**, over the memoized fixture and a Jest twin of it:

- `cart.case.ts` recorded whole, then only `reads the price again`, as case
  selection would run it: the case is unstable on the price body, and
  `computes the price` and `prints the price` keep their readings.
- `checkout.mocked.ts` recorded whole, then only `prices in dollars`: the case is
  unstable on the price body and on the locale line, and a change to the locale
  afterwards selects it.
- The Jest twin, whose cases require the price module inside themselves, with
  `resetModules` on and then off: `reads the price again` is
  unstable, and the file is listed as needing its isolation.
- A Jest file with no module-level state, with `resetModules` on and then off:
  the file is listed as removable, with both wall times.
- A reading after an edit to `price.ts` compares nothing for the cases that ran
  it, and says so.

## Out of scope

**Naming what wrote the state.** The verdict proves a dependency and shows where
it appears. Finding the case or the hook that wrote it is an agentic flow over
that evidence, as it is for visual order dependence (0012).

**Seeing through the cache.** Nothing here patches a memoizer or clears one.

**Cases that overlap in time.** Interleaving tests stay unsupported.
