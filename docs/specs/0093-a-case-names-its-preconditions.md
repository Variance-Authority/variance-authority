# Spec 0093 — a case names its preconditions

**Missing:** a test case cannot say what state it arranged. A test that mocks the
network, turns a flag on or paints the dragon green leaves no trace of it in the
recording. The only preconditions recorded are files: a test file's own source,
its setup and configuration, each held by digest.
**Built on:** the per-file `preconditions` in the coverage record
(`CoveragePrecondition`, `name` and `digest`), the case scope every producer
already enters (`CASE_SCOPE` in `@variance-authority/sense`), the case
sections of the one record [spec 0094](0094-a-run-writes-one-record.md) gives a
run, and the `names` grammar of
[ADR-0046](../context/adr/0046-a-name-may-be-told-what-its-words-mean.md).

## Purpose

Arrange is a state, and the dragon rule already names states: `checkout--glass-ff-on`
is a coordinate on the `colour` and `flag` axes, and its parent is one step
toward the base on the last one. That reading exists for subjects. A test case
has no coordinate, so *which tests ran `pay.ts` with the network mocked* and
*which test is the `ff-off` twin of this `ff-on` one* cannot be asked of the
recording. The mock and the flag are in the test body, which nothing reads at
this grain.

The static reading of mocks (`vi.mock`, `jest.mock` read from the AST into
`Relations.shadows`) disowns load-time crossings into a mocked module. It is a
fact about a test file, not about a case, and it cannot see a state the test
arranged by calling code: `server.use(...)`, `setFlag(...)`, a fixture argument.
An announcement from `@variance-authority/event` is no substitute: it says *when*
the code decided something and carries no value by design. Neither is a runtime
scenario ([ADR-0047](../context/adr/0047-a-runtime-scenario-is-a-witnessed-path.md)).
Its Arrange is a subject whose semantic state a harness observed and handed to
`@variance-authority/scenario`. A case precondition is what a test *says* it
arranged, with no observation, on a case the coverage recording already holds.

## The call

The test says it, at runtime, from the test body, a hook or a helper:

```ts
import { variancePrecondition } from '@variance-authority/sense/precondition';

variancePrecondition({ network: 'mocked' });
variancePrecondition({ flag: 'ff-on', colour: 'green', 'seeded-cart': true });
```

- **One form: a record of names to values.** A value is a string, number or
  boolean, always said; a state that is present with nothing further to say
  holds `true`. A bare name and a name-value pair are refused, so every call
  reads the same.
- **The entry imports nothing.** It reads one function from
  `globalThis[Symbol.for('variance-authority.test-selection.precondition')]`,
  which a recording installs, and calls it. Without a recording the call does
  nothing and costs one property read. The same entry runs in Node and in a
  Vitest browser realm.
- **A recorder's failure is swallowed.** A bug in recording may not become a
  failing test, the position `@variance-authority/eyes` already takes for story
  notes.

## Which case it belongs to

A precondition belongs to a test. A call lands on the case that is running
when it is made, at one of two places:

| Said in | Level | Lands on |
|---|---|---|
| the case body, and anything it calls | the case | that case |
| a `beforeEach`, at the top of the file or inside a `describe` | the `describe` that declared the hook | the case the hook runs for |

A `beforeEach` runs once per case and its call lands on that case, at the
level of the `describe` that declared the hook: `0` for one at the top of the
file, and one deeper for each `describe` around it. The case body is narrower
than any of them.

- **A narrower level overrides a wider one** for the same name, silently: a
  `flag=ff-off` from a `beforeEach` at the top of the file and a `flag=ff-on`
  from the case body give the case `ff-on`. That is the ordinary shape of a
  default and its exception.
- **Two values for one name at one level** are a contradiction. The case carries
  both with their call sites and is reported, never resolved to the last one
  said. A retry that says a different value from its earlier attempt is the same
  contradiction; otherwise a retried case carries what its attempts said. Two
  shards that ran the same case merge by the same rule, so a body one of them
  reached overrides the `beforeEach` another heard before its case failed.
- **A call in `afterEach`** is not Arrange. It is reported with its call site
  and recorded on no case.
- **A call where no case is running throws**: a `describe` callback, a
  `beforeAll` or `afterAll`, the file's top level, and work that outlives its
  case — a cleanup, a timer that fires after the case settled. Nothing there
  belongs to one case, so nothing is guessed: the error names the call site and
  says to move it into the case body or a `beforeEach`.
- **A call in the callback of Playwright's `test.skip`, `test.fixme`,
  `test.fail` or `test.slow`** is unsupported. That callback decides whether
  a case runs and arranges nothing, so it is no place to say a precondition.
- **A `beforeEach` that throws** takes what it said with it. Its case never
  runs, and the next case begins with nothing held.

The case is resolved the way a probe crossing is. Under the `continuations` mode
a call made by one of two concurrent cases lands on that case. Under the flat
mode a `test.concurrent` group is the contaminated line `cases.ts` describes,
and its calls are read with the same limit its crossings are.

Every value keeps the repository-relative `file:line` of the call that said it.
That is the link from the recording into the test body, read from git at the
recording's commit. The body itself is never copied.

## What is recorded

A case-level precondition is `{ name, value, site }`, laid on the case rows of
the record (spec 0094) beside `stopped` and `duration`, through the string
table every other section uses. It is layered, seeded, sharded and shared with
the coverage the same run recorded, by the same code. It travels in the journal beside the case frame, which is a
change to the journal format, and is not part of the case key, so a case's
identity does not move when its preconditions do. A case that named a
precondition has a row even when it crossed nothing: a passing case that only
arranged state and asserted on a mock is still a case `--where` must find.

It is kept apart from the per-file precondition table on purpose. A file
precondition is a path and a digest, and a change to that file selects every
test resting on it. A named precondition is a state. Nothing in a checkout
changes it, so it **never selects and never excludes**. `network` read as a
changed path would be `unread`, and a caller would decline to narrow on a name
that was never a file.

## Where it is read

A case is named the way `covering` already prints it: its test file and its
declaration path. No new identity is introduced.

- **`variance covering … --where <name>[=<value>]`**, in every form of
  `covering` that answers with cases, keeps the cases that declared it.
  Repeated, every `--where` must hold. `--where network` matches any value of
  `network`.
- **Every case `covering` lists carries its preconditions** with their call
  sites, in each format.

When `names.axes` declares the name, the value is read against that axis:

- A value outside the axis's vocabulary is reported by name and kept. It is not
  dropped.
- `values[0]` is the base, and a case that never names the axis is at the base,
  as ADR-0046 reads a subject that omits it. `--where flag=ff-off` matches it.
- **The twin.** A case's twin is found as ADR-0046 finds a parent: move its last
  declared axis one step toward the base, keep every other precondition, and
  take the nearest coordinate a recorded case actually holds. The twin is looked
  up among the cases of the same test file that the same question reached
  before `--where` narrowed it, so `--where flag=ff-on` still prints each
  case's `ff-off` twin. Another file's case is never a twin: a case that names
  nothing stands at the base of every axis, and across files every such case
  would be the twin of every case that names a value. `covering` prints the
  twin beside the case, in every form that lists cases, with or without
  `--where`: the `ff-off` twin of an `ff-on` case, with what each ran. Several
  cases at that coordinate are printed as their count and the first three
  names. When no recorded case holds it, the case is printed with *no twin
  recorded*.
- **The count.** `--where` says how many of the cases that covered the line,
  function, file or change it kept, out of how many covered it.
- **The state.** A line's, function's, range's or changed region's state, and
  the cases that stopped before it, are read over the cases before `--where`
  narrowed them. `--where` changes which cases are listed, never what the
  answer says about the code.

Absent is not empty. A recording that kept no cases, or was made before this
column existed, answers `--where` with **unmeasured**, never with "no case
declared it".

## A snapshot taken inside a case

A visual snapshot is taken part-way through a case, and the reviewer judging
it needs the conditions it was taken under. The case's row cannot answer that:
it holds what the case had said when it *ended*, and a call after the snapshot
is on the row and was not in force when the page was photographed. So a
snapshot carries two things:

- **The case's key, carried, not copied.** Its test file, declaration path and
  runner id, the identity the row already has. A snapshot joins its case on
  that key; it is never given a second one.
- **Its own view of the preconditions:** what the case had said by the moment
  the snapshot was taken, resolved by the rules above, with each call site.
  The recorder answers it without taking what it holds, so the row still
  receives every call.

Absent is not empty here either. A snapshot from a run that did not listen
reads **unmeasured**; one from a listening case that said nothing reads
*nothing arranged*.

**Where the subject and the case disagree.** A subject id may encode an axis
`names.axes` declares — `receipt--ff-on` is at `flag=ff-on` — and the case may
say the same axis. Where both speak, the subject's value is compared with what
the case said, a case that never named the axis standing at the base. A
difference is reported by the axis's name with the call site that said the
case's value, and neither side is taken as the truth: a snapshot named `ff-on`
from a case that arranged `ff-off` is a mislabelled subject or a mis-arranged
case, and only the author knows which. The `names` grammar is parsed only by
the CLI, so a test worker cannot read it; the comparison waits on the grammar
moving into `@variance-authority/sense`, as the suite declaration did.

Under Playwright the `variance` fixture carries both on the observation as
`case`, closes a failing assertion's message with them, and, when the run
listened, adds them as a `variance` annotation that Playwright's report shows
under the test whether it passed or not. A run that did not listen adds no
annotation: under a passing test nobody asked.

## What would discharge it

1. The entry `@variance-authority/sense/precondition` with `variancePrecondition`,
   no imports, and the no-recording call as a measured no-op.
2. The recording side under Vitest, Jest, Rstest and Playwright: the channel
   installed where a case scope exists, the case resolved from it, and hook
   calls resolved to the cases they ran for. Fixtures for a case-level call, a
   `beforeEach` inside a `describe` that does not reach a sibling `describe`, a
   `beforeEach` at the top of the file overridden by a case, a same-level
   contradiction, a call in `afterEach`, a call where no case is running that
   throws, a `beforeEach` that throws after it spoke, a `test.concurrent` pair
   under `continuations`, and a retry that changes a value.
3. The record's precondition sections and their journal frame, with the size it adds to this
   repository's recording stated, and the unmeasured answer for an older record.
   A fixture for a passing case that names a precondition and crosses nothing,
   found by `--where`.
4. `--where` and the per-case preconditions in every form of `covering` that
   answers with cases, each with a test that fails on an answer that reads an
   unmeasured record as an empty one.
5. The axis reading: vocabulary check, base for an unnamed axis, and the twin,
   on fixtures where two cases differ only in `flag`, where three hold the same
   coordinate, and where no case holds it; and `--where flag=ff-on` printing an
   `ff-off` twin the filter left out of the answer.
6. A snapshot inside a case: the case's key and the preconditions in force when
   it was taken, unmeasured from a run that did not listen, on Playwright and in
   the Vitest browser realm; the disagreement between a subject's coordinate and
   the case's value, reported by axis name; and the snapshot named on the case's
   row and in the run's one record, so a reviewer reaches one from the other.
