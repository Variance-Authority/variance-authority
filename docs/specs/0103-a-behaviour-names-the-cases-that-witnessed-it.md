# Spec 0103 — a behaviour names the cases that witnessed it

**Missing:** a question composed from more than one fact about a case. Today
`covering` takes one region and narrows the cases that entered it by what they
said (`--where`). It cannot also ask for a name, for a second region, or for
the cases that did *not* enter a region. It cannot tell a case that said a value
apart from one that said two values at once, or one that passed apart from one
that failed. It answers by resolving every case's row before it filters.
So *which passing cases ran the fallback as an anonymous user during a
timeout* can be asked only half-way, and the half that answers counts a
contradiction as a match.
**Built on:** `covering --where` and its unmeasured count
([`covering-where.ts`](../../packages/cli/src/commands/covering-where.ts)); the
items over crossing sets of
[ADR-0094](../context/adr/0094-what-a-case-said-is-items-over-crossing-sets.md),
whose one owner is
[`case_said.rs`](../../packages/sense/native/src/case_said.rs); the crossing-set
pool and its LIST, BITS and RUNS containers
([`crossing_sets.rs`](../../packages/sense/native/src/crossing_sets.rs)); and
the cases that stopped before a region
([`stopped.ts`](../../packages/sense/src/test-selection/stopped.ts)).
**Waits for:** each case's outcome, as
[spec 0067](0067-a-case-carries-its-outcome.md) records it: the record stores
the case and how it ended. And spec 0093's two-part name, `dimension:key`, and the bare
dimension that unions its keys. The record and `--where` hold one flat name
today; until the grammar lands, a name below is that flat name.
**Amends:** [spec 0093](0093-a-case-names-its-preconditions.md)'s *Where it is
read*: a `--where` repeated for one `dimension:key` is *any* of its values, and
a contradicted case no longer matches. ADR-0094's Strategy, where `--where`
filters resolved rows with its semantics fixed, and its cost row for `--where`.

## Purpose

A failing test is already explained by its stack trace. The question Variance
can answer and nobody else can is the opposite one: **why did the others
pass, and what did they actually run?** Aggregate coverage says a fallback was
entered. It does not say whether any case entered it as an anonymous user during
a timeout, which is the risk the change is about. A *witness* is a passing case
that holds every fact the question names. An empty set of witnesses inside a
green, 100%-covered region is a missing scenario, and it can be found without
writing a test first.

The questions this spec must answer, each on one recording:

| | The developer asks | Facts |
|---|---|---|
| 1 | Did an anonymous user hit the fallback during a timeout? | entered `fallback` · said `user=anonymous` · said `network=timeout` |
| 2 | Which retry test runs `paymentRetry` with a failed payment? | named `retry` · entered `paymentRetry` · said `payment=failed` |
| 3 | Does any case reach both the save handler and the database write, with real storage? | entered `saveHandler` · entered `databaseWrite` · said `storage=real` |
| 4 | Which timeout tests never reached timeout handling? | named `timeout` · said `network=timeout` · did not enter `timeoutHandler` |

The answer to 2 gives an agent the one test to read, extend or run. A name alone
was a guess; a name with the region it entered and the state it said is
evidence. The answer to 4 is a fixture, a name or an early exit worth reading. A
test can pass without ever exercising what its name claims.

A witness proves the facts co-occurred on one case. It does not prove that they
happened in order, that one caused another, or that a value applied to one
particular call of the region: co-occurrence is what fault localisation reads
too, and it is not cause
([prior art](../context/prior-art.md#fault-localization)). Each attempt is read
on its own, so a witness is one run. A case whose attempts disagree is the
stability report's: it records both runs and reports the difference. A witness is reach, not checking
([prior art](../context/prior-art.md#coverage-adequacy)): a case that asserts
nothing about the fallback still witnesses that it ran.

`covering` already calls every case that reached its target a witness, and spec
0067 calls a case that entered a region one. Under a fact flag the word narrows
to the definition above, and the existing wording says so.

## The question

A question has a population and facts. The population is every case
`covering` keeps: its narrowings `--cases`, `--at-distance` and `--in-package`,
and its target — `--file` with `--function` or `--line`, or a diff from
`--since` — whose first fact is *entered the target*. A question with no target
asks over every case the narrowings keep, so question 4 reads:

```
$ variance covering --named timeout --where network=timeout \
    --except-entered src/net/timeout.ts:timeoutHandler
```

The flags add facts:

```
--where <name>[=<value>]                said it, in spec 0093's grammar
--named <text>                          the case's title chain holds <text>
--entered <file>[:<function>]           entered that region as well
--except-entered <file>[:<function>]    did not enter that region
--limit <n>                             list at most n cases
```

- **Different facts are all required.** Every positive fact must hold, and the
  excepted region must not have been entered.
- **One `dimension:key` given several values is any of them.** `--where
  network:cdn=timeout --where network:cdn=offline` asks for either. Today both
  are required, which only a contradiction can satisfy. Repeats that name a
  dimension alone, or different keys, stay all-required as spec 0093 reads
  them. This is the only *any* this spec adds. A general boolean grammar is a
  query language, and none of the questions above needs one.
- **`--named` matches the title chain** — the describe blocks and the test's
  name, as the runner gave them — by code-unit substring, so `retry` finds a
  case under `describe('retry')`. It never reads the file: `--cases` picks a
  file's cases. It is never unmeasured.
- **`--entered` and `--except-entered` resolve their region as `--file` and
  `--function` resolve the target.** The function, a recorded one or a scope
  that holds functions, follows the last `:`; a function name holds no `:`. A
  path the checkout does not hold is refused as `--file` refuses it. A file the
  record holds no coverage for is read as `--file` reads it, and the fact is
  unmeasured for every case.
- **`--limit` caps every list `covering` prints**, with or without a fact flag.
  Absent, every case is listed, as today. Counts are always whole.

A precondition is read as the case said it. A case that never said a name has
not said it: no value is filled in from `names.axes` or any other
configuration, because a default filled in is a declaration presented as an
observation. No value is checked against a vocabulary either. What a case says
is the user's word, and a closed list would turn a new value into an error.

## What a case counts as

Every case of the population lands in exactly one of these: the first that
applies, in this order. A fact is read three ways — it holds, it fails, or it
cannot be read — and a fact that fails decides before one that cannot be read.

- **Not a witness.** A fact that was read fails.
- **Unmeasured.** A fact or the outcome cannot be read for it: a `--where` on a
  case outside the measured set, a region in a file the record holds no
  coverage for, or a record that stores no outcome.
- **Contradicted.** At the narrowest level it said a `dimension:key` that made
  a fact hold, it said two values. ADR-0094 keeps both, and a filter that
  matches either of them hides the contradiction, so it is counted apart even
  when one of the two is a value the question asked for. A contradiction on a
  key the fact did not need is not counted.
- **Failed.** It holds every fact, but its recorded outcome is a failure. It is
  printed with that outcome, never as a witness.
- **Witness.** It holds every fact and its recorded outcome is a pass.

*Entered* means the case called into the region. A module that was only loaded
was not entered; the record says which, and a record that cannot is a defect
in what wrote it, not a category here.

**No recorded witness** is said only when the witness count is zero, no case is
*unmeasured*, and the target is no hole in spec 0067's sense: no case that holds
the asked state stopped before it could reach the target. Those cases are
printed as their own line. A record that cannot say which cases stopped before
the target (no relations, a missing file, no recorded reach) has an unknown
hole, never an empty one. Otherwise the answer says the record cannot tell, and
names how many cases it could not read. *Contradicted* and *failed* are printed
and never turn into a negative: the reader sees them and decides.

```
$ variance covering --file src/pay/fallback.ts --function fallback \
    --where user=anonymous --where network=timeout

fallback in src/pay/fallback.ts was entered by 14 cases.
2 witnessed user=anonymous and network=timeout:
  src/pay/fallback.test.ts > falls back when the gateway times out
  src/checkout/guest.test.ts > guest retries after a timeout
7 did not.
3 were recorded without preconditions, so whether they ran under it is unmeasured.
1 said network=timeout and network=offline in one beforeEach.
1 failed.
```

A listed line is resolved, name and file, only for the cases printed. Every
other line is a count.

## A contrast

A witness says the facts co-occurred. The nearest case where they did not is the
cheapest evidence of which fact the pass depended on. A witness's **contrast**
is a case of the same test file, in the population, that said exactly what the
witness said except on one name a `--where` fact needed. There it said another
value, or said nothing. It is printed under the witness with that one
difference and whether it entered the target:

```
  src/pay/fallback.test.ts > falls back when the gateway times out
    contrast: network=offline · src/pay/fallback.test.ts > shows the offline page · did not enter
```

- **Said nothing is printed as said nothing**, never as a base value.
- **Another file's case is never a contrast.** A case that said nothing would
  otherwise be the contrast of every case that said one thing.
- **Several cases at one difference** print as their count and the first name.
  None prints *no contrast recorded*. A contradicted case is never a contrast.
- **It needs no axis.** The difference is computed on the effective items of two
  cases, so no grammar orders the values and none has to be declared.

A contrast is computed for the listed witnesses only, against their own files'
cases: at most `--limit` times the largest file's case count, never the whole
population.

## How it is answered

Write `S(n, v, l)` for the cases holding item `(n, v, ·, l)`, joined over
sites, and `M` for the measured set.

- **Said, effective:** `P(n=v) = ⋃ₗ [ S(n,v,l) − ⋃_{l'>l} S(n,·,l') ]`. A
  narrower level overrides a wider one. This is ADR-0094's resolution, and it
  moves into `case_said.rs` as sets: the effective and contradicted sets per
  `(name, value)` are computed there, and the per-case `resolve` that prints a
  row becomes that computation over one case's membership. One resolver
  remains.
- **A name without a value or a key:** `P(n) = ⋃_{v,l} S(n,v,l)`, and a bare
  dimension is the union over its keys.
- **Contradicted:** `P(n=v) ∩ P(n=v')` for some `v' ≠ v`, on the key that made
  the fact hold.
- **Entered:** the cases that called into the region, a set in the pool. A
  `--function` or a scope is the union of its regions' sets.
- **A hole:** the cases `stoppedBefore` names for the target, as spec 0067
  reads them. Its `undefined`, a record it cannot read, is an unknown hole and
  blocks the negative.
- **Named:** a scan of the case-name column, the one step linear in cases. It
  runs only when `--named` is given.
- **Outcome:** the recorded outcome of each case, one attempt at a time.
- **The population:** the cases `covering` kept, passed in as one set.

The said sets come from `case_said.rs`, its one owner. Set intersection,
difference and cardinality over pool ids belong to `crossing_sets.rs`, the
pool's owner, where spec 0102 and selection can call them. The composed query
is a decision in its own file over their results: it adds no reading of what a
case said and no set code. It is called once through N-API with the section
and pool bytes `covering` already read, as the said reader is, and it returns
counts per category and the first `n` ids of each list. Nothing resolves a case
into a row to filter it.

The general path is a sorted merge over decoded sets, smallest first, and every
count is a cardinality. That makes the cost proportional to the sets the
question touches, not to the facts multiplied by the cases; `--where` today is
O(cases × items), and ADR-0094's cost table says so. A container-against-
container path — a galloping search for a short list, a word-wise AND for BITS,
intervals for RUNS — is written only where item 4's measurement asks for it.

`whereCases`, and the per-case filter through `rowOf` it runs, are deleted with
this change, not kept beside it. One answer to `--where` exists after it, and
`heldValues` goes with it. Whatever axis reading is still in the tree when this
lands is deleted, not rebuilt over sets: filling a base credits a case with a
value it never said, and a vocabulary check closes an open word. The twin it
printed returns as the contrast above, which needs neither.

## Prior art

- **QuickCheck's `classify`, `label` and `cover`**, and Hypothesis's `event`,
  report which labelled scenarios the passing cases held, and `cover` fails a
  run whose scenario is under-represented. It is the field's form of *why did
  the others pass*, over generated inputs and without the code they reached.
- **Combinatorial coverage measurement** (Kuhn et al., NIST IR 7878, 2012; the
  NIST CCM tool) measures which t-way combinations of configuration values a
  test set covers. It answers *was anonymous × timeout ever arranged*, over the
  inputs alone. A witness adds the region the combination reached.
- **Trace queries** (TraceQL in Grafana Tempo, Honeycomb) filter span sets by
  attributes with conjunction, negation and structure: *entered X with
  attribute Y*, over production traces, not over the cases of a suite.
- **Spectrum-based fault localisation** (Tarantula, Ochiai) counts which
  passing and failing cases entered a statement. It reads the same
  co-occurrence for the failure; a witness reads it for the pass, with state.
- **Test gap analysis** (CQSE / Teamscale) intersects *changed* with *executed
  by any test*. That is one fact per method, and it names no test.
- **Per-test coverage lookups** in JetBrains IDEs, Parasoft Jtest and
  Wallaby.js answer *which tests covered this line*: one region, no state, no
  composition.
- **Roaring bitmaps** (Lemire et al., *Software: Practice and Experience*,
  2016) store a set as array, bitmap or run containers and intersect them
  container against container. The pool has the same three container kinds,
  chosen per set rather than per 2¹⁶ chunk.

None of them answers a question that joins a name, two regions and an arranged
state on one case of a suite.

## What would discharge it

1. Set intersection, difference and cardinality over pool ids in
   `crossing_sets.rs`. The effective and contradicted sets in `case_said.rs`,
   with `resolve` rewritten over them. The composed query in its own file:
   bare-name sets, entered, the hole, named, the outcome, the population, all
   and except, counts per category and the first `n` ids. Unit tests for an
   override, a contradiction on the key a fact needed and on one it did not, a
   case failing one fact and unmeasured on another, a failed case holding every
   fact, a hole, a record with no outcome, and a record with no measured set.
2. `covering` routed to it: `--named`, `--entered`, `--except-entered`,
   `--limit`, a question with no target, one `dimension:key` given several
   values read as any of them, and the output above. `whereCases`, its `rowOf`
   filter and any axis reading still in the tree are deleted. The tests that
   assert repeated values all-required, a contradicted case matched or a base
   value credited are amended first, and fail. A contrast under each listed
   witness, with a case that said nothing on the differing name, one in another
   file left out, and a contradicted case left out. `covering`'s existing *witness* wording is
   amended. ADR-0094's Strategy bullet and cost row for `--where` are amended.
3. Fixtures for questions 1 to 4, recorded under Vitest, Jest and Rstest and run
   through `covering`, with the output each is expected to print. One of them is
   green at 100% line coverage and prints *no recorded witness*.
4. The cost measured on this repository's recording and on the seven-MUI
   corpus: `--where` before and after, a three-fact question, and a `--function`
   scope that unions several regions, against the size of the sets each touched.

The first slice is item 1's set operations and resolver, `--where` and
`--except-entered` through `covering`, and question 1 end to end under Vitest.
`--named`, the contrast, the other runners and the measurement
follow.

## Open

- **Declared defaults.** A project may one day declare what a name is when no
  case says it. If such a declaration is read, it is its own count beside the
  observations, never a witness.
- **Excepted state and names.** `--except-where` and `--except-named` are the
  same set difference. No question above needs them, and how an excepted
  `--where` reads a contradicted or unmeasured case is undecided.
- **Gates.** Spec 0102's `read` facts join as `--read`, the same sets over a
  `tests.read` section, when that section exists. Comparing what a case said
  against what its code read is that spec's.
- **Two recordings.** Comparing a question's witnesses before and after a change
  needs cases aligned by identity first. Otherwise a case that was not rerun
  reads as one that stopped reaching the region. `caseMotion` compares regions,
  not questions; how a question rides it is open.
- **A reviewer's checklist.** `review` could take the questions a reviewer
  names and print *witnessed*, *no recorded witness* or *unmeasured* for each
  changed region, as QuickCheck's `cover` fails an under-represented scenario.
  Which questions, and where a reviewer writes them, is open; enumerating every
  configuration is not the answer.
- **Unique evidence.** *If these tests were removed, which question loses its
  last witness?* is the same query with a test-file except, run once per
  candidate. Whether that deserves its own flag is open.
