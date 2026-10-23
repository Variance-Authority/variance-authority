# Spec 0093 — a case names its preconditions

**Missing:** the dimension. `variancePrecondition` takes one record, so a name
is one word and nothing parses `dimension:key`. `covering` reads that word on
an axis, which this spec withdraws until spec 0102 settles it. A snapshot in
the Vitest browser realm names no case, a case row names no snapshot, and a
subject's coordinate is never compared with what its case said.
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

variancePrecondition('network', { upsell: 'mocked' });
variancePrecondition('flags', { 'new-checkout': true });
variancePrecondition('subject', { colour: 'green', 'seeded-cart': true });
```

- **One form: a dimension, then a record of keys to values**, as
  [spec 0102](0102-a-case-records-what-the-code-read.md) defines it. A name is
  the `(dimension, key)` pair, written `flags:new-checkout`; the dimension is
  the user's string, open and untyped, and nothing crosses between two of them.
  A value is recorded as the JSON text of what was said; a state that is present
  with nothing further to say holds `true`. A dimension holding `:` throws,
  naming the call site. The one-argument record is deleted, not kept beside the
  new form.
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
  `flags:new-checkout=false` from a `beforeEach` at the top of the file and a
  `flags:new-checkout=true` from the case body give the case `true`. That is the ordinary shape of a
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

A case-level precondition is `{ name, value, site, level }`, its name the
`(dimension, key)` pair, its value the JSON text the realm wrote. Each distinct
one is an item, and the cases that said it are a set in the record's
crossing-set pool, as ADR-0094 lays it in the case index's `tests.said`
section. Every item is kept, an overridden one too; a case's row is resolved
when it is read. It is layered, seeded, sharded and shared with the coverage
the same run recorded, by the same code. It travels in the journal beside the case frame, which is a
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

- **`variance covering … --where <dimension>[:<key>][=<value>]`**, in every
  form of `covering` that answers with cases, keeps the cases that declared it.
  Repeated for different names, every `--where` must hold; repeated for one
  `dimension:key`, any of its values may
  ([spec 0103](0103-a-behaviour-names-the-cases-that-witnessed-it.md)), and a
  case that said two values for it at one level is counted as contradicted,
  not matched. `--where network` matches any key of
  `network`, `--where flags:new-checkout` any value of that key, and
  `--where network=mocked` any key of `network` that holds `mocked`. A value
  is parsed as JSON when it parses, so `=true` is the boolean and `=mocked` the
  string, and compared with the recorded JSON text.
- **Every case `covering` lists carries its preconditions** with their call
  sites, in each format, except a dimension the case also read: that one is
  printed by its reads, with the value said beside each and no key said and
  never read, as [spec 0102](0102-a-case-records-what-the-code-read.md) prints
  it.

A precondition is read as the case said it, never against `names.axes`. That
grammar orders subject ids. A precondition's value is the user's word and stays
open, so no value is reported as outside a vocabulary, and a case that never
said a name is not placed at a base: a default filled in would be a declaration
presented as an observation. `--where flag=ff-off` matches the cases that said
it.

- **The twin** is the contrast of
  [spec 0103](0103-a-behaviour-names-the-cases-that-witnessed-it.md): a case
  of the same test file that said the same except on one name. It needs no
  axis.
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
the case said. A case that never said the name is not compared. A
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
5. The twin, as spec 0103's contrast, discharged there.
6. A snapshot inside a case: the case's key and the preconditions in force when
   it was taken, unmeasured from a run that did not listen, on Playwright and in
   the Vitest browser realm; the disagreement between a subject's coordinate and
   the case's value, reported by axis name; and the snapshot named on the case's
   row and in the run's one record, so a reviewer reaches one from the other.
