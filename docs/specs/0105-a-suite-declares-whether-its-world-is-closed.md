# Spec 0105 — a suite declares whether its world is closed

**Missing:** a check that selection narrows, held between the walk and the
record. Each precision step runs every test a finer one runs, but `file` and
`symbol` get there by union: they add what the record's file use read to what
the import walk reached. A test the record holds and the graph does not is kept
without a word. Inside the record, one runner is already held to it: a Jest
file fails when its CommonJS registry holds a module whose probes registered
and its journal never entered
([`jest-registry.cts`](../../packages/sense/src/test-selection/jest-registry.cts)).
Nothing holds an ES module, a symlinked root, a `dist/` file read as its source
or another runner to the same rule. And nothing tells a suite where the
disagreement is the defect apart from one where it is expected: a test that
drives a second service runs code its own process never records, and is read
the same way as a unit test.
**Built on:** the mocks a test declares, read off its tree
([`mocks.ts`](../../packages/sense/src/taint/mocks.ts)); the evaluation a runner
makes of a module it mocks, disowned at load time
([`shadowed.ts`](../../packages/sense/src/test-selection/shadowed.ts)); Jest's
registry held against the journal
([`jest-registry.cts`](../../packages/sense/src/test-selection/jest-registry.cts)); the precision ladder and its union
([`precision.ts`](../../packages/sense/src/test-selection/precision.ts)), whose
test keeps a test the graph does not reach
([`precision.test.ts`](../../packages/sense/src/test-selection/precision.test.ts));
the suite's declared `precision`, read by
[`select-command.ts`](../../packages/cli/src/commands/select-command.ts); the
selection machine of [spec 0091](0091-a-suite-is-selected-by-a-machine.md); and
the file use a test file records,
[ADR-0095](../context/adr/0095-a-test-file-records-what-it-loaded.md).

## Purpose

Selection is a funnel. Each step answers from a finer reading than the one
before it, and each selects the same tests or fewer:

```text
reach  ⊇  files(coverage)            the walk holds every file the run entered
file use  ⊇  files(function ∪ region)  every entered file was recorded as loaded
```

Whether the funnel holds is not a property of the code. It is an assumption
about what the record can see, and only the suite knows it. A unit suite runs
everything its tests reach in the process that records them, so a file the
record never saw was not run. A suite that drives a deployed service, a browser
beside the runner or a worker's binding runs code elsewhere, and there an
absent file proves nothing. The suite declares which world it is in, and
`closed` is the default:

```json
"suites": {
  "unit": { "kind": "unit", "world": "closed" },
  "e2e": { "kind": "e2e", "world": "open" }
}
```

The term is the closed-world assumption (Reiter, 1978): what is not recorded is
false. Regression test selection calls a selector that keeps every test whose
outcome a change could alter **safe**, and safe only under stated assumptions
(Rothermel and Harrold, 1996). The world is that statement, made per suite.

Absent means absent from a file the record measured. A file outside every
instrumented root is not in `whole`
([spec 0046](0046-the-safety-rule-lives-in-one-place.md)), and the machine of
spec 0091 routes it to nothing; it is never a breach.

Reach starts where the suite starts. The walk begins at the suite's `before`,
its runner config and the setup files that config loads, as well as at its test
files, so a module a setup file loads and no import names is reached. The union
of file use into `file` and `symbol` stays: it is the ladder's own definition,
and it is what keeps a change to a module's top-level side effect, which moves
no export. What goes is its silence. The check is on files, not on tests, so a
recorded file outside reach is named whatever the union keeps.

Reach resolves as the runner resolved. A specifier means what the runner made
it mean: Jest's `moduleNameMapper`, a `__mocks__` directory beside the module
or under the root, automock, a bundler alias. The walk does not parse any of
them. The record carries, for each importer, the specifier it asked for and the
file the runner served, and the walk takes that answer over its own resolver's
for that specifier. A mock a test declares in its own text — `jest.mock`,
`vi.mock`, a literal `requireActual` — is already read off the tree and cut or
added as an edge, and the real module a runner evaluates to shape an automock
is already disowned at load time, so neither is a breach today. So a mapped or
mocked file is reached through the specifier that asked for it, and a breach
is left to a load no specifier in the source asked for: a dynamic import by a
computed name, a module the runtime loads by itself.

`world` and `relations` answer different questions and are declared apart.
`relations` says whether the graph steps may run at all. `world` says whether
absence from the record is evidence. A unit suite is `closed` with relations
on. A suite that drives a deployed app sets `relations: false`, names the app
in `before` as spec 0091 has it, and is `open`.

## A closed world enforces the funnel

In a closed world both inclusions hold, and a breach is a **safety violation**:
the selector would drop a test the run proves the change could reach. The
check compares the walk with the record once, wherever a run writes a record,
a pull request's run included, not on every selection, so coverage selection
still takes no graph. It costs one walk and one set comparison per record,
measured against the recording run it rides. A breach fails the run that wrote
the record, so the pull request that brought in the dynamic import is the one
that fails, and it names the file, the test and the step that lost it. It does
not widen in silence, as the union does today.

`closed` is the default, so a suite that declared nothing and breached the
funnel before this lands starts failing. The failure names the file and both
remedies: fix the walk, or declare the suite `open`.

The two breaches mean different things, and the report says which:

- **The record left the walk.** A file the run entered is not in reach. The
  cause is a dynamic import, a module loaded at run time, a boundary the walk
  does not cross, or a resolver defect. Static selection met the same thing in
  Java as reflection (Legunsen et al., FSE 2016).
- **File use missed a load.** A file whose functions or regions a test entered
  is not in the test's file use. The cause is a gap in the module system's
  recording: a loader the hook does not see, a cache hit served before it, a
  module evaluated in another realm. Jest's CommonJS registry already fails a
  file on this breach; the check is that one, carried to every runner and to
  what that registry cannot show.

## An open world reports growth

In an open world parts of the system run outside the record. The funnel is
still the expectation, and growth past it is predicted rather than wrong: it
is reported and named with the same fields, never failed, and never turned into
a silent widening. This is the soundiness position (Livshits et al., CACM 2015):
say where the analysis is unsound instead of claiming it is not.

## Shards

Work done once per shard, module evaluation above all, is a precondition of
every case that shard served. A Cloudflare Workers isolate is a shard: it
evaluates the worker's modules once and serves many requests. The worker under
test is still a closed world. Its record is the isolate's, and its file use is
the isolate's evaluation, charged to every case the isolate served. What is
open is beside it: bindings, other workers, services that emerge once the
worker runs.

## File use is recorded or inferred

Some runtimes give no module hook, and the Workers runtime is one. There file
use is inferred from region coverage: a file is used when the run entered any
region of it. The record marks which it holds. Where file use is inferred, the
second inclusion is true by construction, so its check is skipped and named,
never reported green. Inference is exact only when coverage includes each
module's top-level range, which evaluation always enters; from function
coverage alone it is a lower bound.

## What discharges it

- `world` is declared per suite, `closed` by default, and an unknown value fails
  the configuration.
- The walk starts at the suite's `before`, and a recorded file outside reach
  is named at every precision step, the union kept.
- The record carries each importer's specifier and the file the runner served
  for it, and the walk resolves through it. A fixture with a
  `moduleNameMapper` entry and one with a `__mocks__` file each pass in a
  closed world, and fail first without it. Automock and a declared mock are
  pinned already (`select-mocks.test.ts`, `audit.test.ts`,
  `vitest-hoisted-mocks.integration.test.ts`) and stay green.
- A fixture whose journal loses an ES module, under Jest and under Vitest,
  fails the file the way `jest-registry.integration.test.ts` fails a lost
  CommonJS module, and fails first.
- The test that keeps a test the record holds and the graph does not, at
  `file`, is amended to expect a safety violation in a closed world and a named
  growth in an open one, and fails first.
- A record carries whether its file use was recorded or inferred, and the file-
  use check reports itself skipped where it was inferred.

## Not here

Naming the open parts of a suite (`open: [parts]`), so growth inside a named
part is expected and growth outside it is still a violation. Then the files
known to cause a jump: a side effect the walk cannot see, declared once so
selection carries it instead of reporting it every run.
