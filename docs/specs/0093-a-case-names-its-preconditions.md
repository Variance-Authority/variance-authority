# Spec 0093 — a case names its preconditions

**Missing:** a test case cannot say what state it arranged. A test that mocks the
network, turns a flag on or paints the dragon green leaves no trace of it in the
recording. The only preconditions recorded are files: a test file's own source,
its setup and configuration, each held by digest.
**Built on:** the per-file `preconditions` in the coverage record
(`CoveragePrecondition`, `name` and `digest`), the case scope every producer
already enters (`CASE_SCOPE` in `@variance-authority/sense`), the case sidecar
`cases.bin`, and the `names` grammar of
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
the code decided something and carries no value by design.

## The call

The test says it, at runtime, from the test body, a hook or a helper:

```ts
import { variancePrecondition } from '@variance-authority/sense/precondition';

variancePrecondition('network', 'mocked');
variancePrecondition({ flag: 'ff-on', colour: 'green' });
variancePrecondition('seeded-cart');
```

- **A value is a string, number or boolean.** Without one the precondition holds
  `true`: the state is present, with nothing further to say about it.
- **The entry imports nothing.** It reads one function from
  `globalThis[Symbol.for('variance-authority.test-selection.precondition')]`,
  which a recording installs, and calls it. Without a recording the call does
  nothing and costs one property read. The same entry runs in Node and in a
  Vitest browser realm.
- **A recorder's failure is swallowed.** A bug in recording may not become a
  failing test, the position `@variance-authority/eyes` already takes for story
  notes.

## Which case it belongs to

A call is said at one of three levels, and each level reaches the cases below it:

| Said in | Level | Reaches |
|---|---|---|
| the case body, and anything it calls | the case | that case |
| a `describe` callback, its `beforeAll`, its `beforeEach` | that `describe` | every case inside it, and no sibling |
| the file's top level, a top-level `beforeAll` or `beforeEach` | the file | every case of the file |

A `beforeEach` runs once per case and its call lands on that case, at the
level of the `describe` that declared the hook. Nested `describe`s are levels in
their own right, the innermost the narrowest.

- **A narrower level overrides a wider one** for the same name, silently: a
  file-level `flag=ff-off` and a case-level `flag=ff-on` give the case `ff-on`.
  That is the ordinary shape of a default and its exception.
- **Two values for one name at one level** are a contradiction. The case carries
  both with their call sites and is reported, never resolved to the last one
  said. A retry that says a different value from its earlier attempt is the same
  contradiction; otherwise a retried case carries what its attempts said.
- **A call in `afterEach` or `afterAll`** is not Arrange. It is reported with its
  call site and recorded on no case.

The case is resolved the way a probe crossing is. Under the `continuations` mode
a call made by one of two concurrent cases lands on that case. Under the flat
mode a `test.concurrent` group is the contaminated line `cases.ts` describes,
and its calls are read with the same limit its crossings are.

Every value keeps the repository-relative `file:line` of the call that said it.
That is the link from the recording into the test body, read from git at the
recording's commit. The body itself is never copied.

## What is recorded

A case-level precondition is `{ name, value, site }`, held on the case row in
`cases.bin` beside `stopped` and `duration`, through the string table every
other column uses. It travels in the journal beside the case frame, which is a
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
  up among every case the same question reached before `--where` narrowed it,
  so `--where flag=ff-on` still prints each case's `ff-off` twin. `covering`
  prints it beside the case: the `ff-off` twin of an `ff-on` case, with what each
  ran. Several cases at that coordinate are all printed with their count; none is
  printed as *no twin recorded*.

Absent is not empty. A recording that kept no cases, or was made before this
column existed, answers `--where` with **unmeasured**, never with "no case
declared it".

## What would discharge it

1. The entry `@variance-authority/sense/precondition` with `variancePrecondition`,
   no imports, and the no-recording call as a measured no-op.
2. The recording side under Vitest, Jest, Rstest and Playwright: the channel
   installed where a case scope exists, the case resolved from it, and hook
   calls resolved to the cases they ran for. Fixtures for a case-level call, a
   `describe`-scoped `beforeEach` that does not reach a sibling `describe`, a
   file-level default overridden by a case, a same-level contradiction, a call
   in `afterEach`, a `test.concurrent` pair under `continuations`, and a retry
   that changes a value.
3. The `cases.bin` column and its journal frame, with the size it adds to this
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
