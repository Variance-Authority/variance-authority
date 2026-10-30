# Spec 0102 — a case records what the code read

**Missing:** what a decision input held when the code consulted it. A case can
say what it arranged ([spec 0093](0093-a-case-names-its-preconditions.md)), and
the record holds the regions it entered, but nothing records the value a feature
flag, an experiment or a permission had at the moment the code read it. So the
question a reviewer of a flagged change asks — *did the new code run with its
flag off?* — cannot be asked of the recording. What a test says it arranged is
a claim, and the claim and the read part ways whenever the mock does not reach
the provider the code reads from.
**Built on:** `variancePrecondition` and the case rows of spec 0093, whose call
this spec changes (below); the case scope every producer already enters; the
execution collector's journal, which a Playwright driver already drains from
every page it drives; `covering --since` and
`review`, which list the cases that entered each changed region; and
`caseMotion`, which compares two case indexes region by region
([`case-motion.ts`](../../packages/sense/src/test-selection/case-motion.ts)).

## Purpose

A common rule in product teams is that new code ships behind a feature flag. The
failure it guards against is a changed line reached with the flag off, by a
default configuration or by another flag's case. Today the recording can say
that a case entered the changed line, and nothing about the flag it ran under.

Arrange and Act each hold half of the answer. A **precondition** is what the
test *said*: `flags` set as `{ 'new-checkout': true }`. A **breadcrumb** is what the
code *read*: `flags:new-checkout` was `true` when line 41 of `pay.ts` consulted it. Laid
on the same case, beside the regions it entered, the two make the reading the
rule needs:

```
checkout/pay.ts  lines 41-58  (changed)
  pay › charges a new card   read flags:new-checkout=true   said true
  pay › retries on 502       read flags:new-checkout=true   said nothing
  cart › totals
```

Variance does not judge the row. Whether `cart › totals` reaching new code with
no flag read is a leak, a shared helper or the flag's own wiring is decided by
whoever reads it — usually a review agent that holds the diff, the pull request
and the team's rule. Nothing here proves statically which branch a flag guards:
what ran is recorded, and the reader reasons over it.

The same reading answers the cost of introducing a flag. A case that read the new
flag as `false` entered the function the change edited and did not enter the new
arm, so every region it entered holds the same cases it held before, and
`caseMotion` reports no movement for it. The only regions with new cases are the new arm's,
and each of those cases read the flag on.

That holds where the new arm is added beside old code the edit leaves alone. The
usual shapes — `if (enabled) { … } else { … }`, `enabled ? next() : previous()`, an
early `if (!enabled) return previous()` — move the old code into the flag-off arm.
Whether a line that only moved or re-indented is a changed region is the change
reading's rule, not this spec's; where it is, the cases that reach it read the
flag `false`, and that is the expected reading, not a leak. The reader tells
the two apart by the arm the diff shows, and the flag value says which arm a
case was in. A fixture for each shape pins what `review` prints.

## The calls

Both take a **dimension** first:

```ts
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { varianceBreadcrumb } from '@variance-authority/event';

variancePrecondition('flags', flags);   // { 'new-checkout': true, … }, as the test hands it to its provider
variancePrecondition('network', { upsell: 'mocked' });

if (varianceBreadcrumb('flags', 'new-checkout', flags['new-checkout'])) {
  // the new arm
}
```

- **A dimension is the user's string.** It is open, untyped and declared
  nowhere: no config, no list of known dimensions, no schema for a value.
  `flags` and `network` are examples, not a vocabulary. Variance is a reporting
  tool, and a typo is visible to whoever reads the data back.
- **Dimensions are separate.** A name is a `(dimension, key)` pair, and
  `new-checkout` under `flags` and under `experiments` are two unrelated names.
  Nothing overrides, merges or matches across dimensions. The text form is
  `flags:new-checkout`, split at the first `:`, so a key keeps whatever the flag
  system spells it with, dots and colons included. A said key and a read key
  join only when they are spelled the same. A dimension holding `:` makes
  `variancePrecondition` throw, naming the call site, as spec 0093's misuse
  does; the breadcrumb's answer to it is below.
- **A value is untyped.** It is recorded as the JSON text of what was passed, a
  JSON flag variant included. A value JSON cannot hold — a function, a cycle, a
  `bigint` — is recorded as its key, named unrecorded, never dropped.
- **The precondition takes a record of keys.** Within one dimension, calls merge
  key by key under spec 0093's level rules: the case body over a `beforeEach`,
  an inner `describe` over an outer one, two values at one level a
  contradiction. Passing the whole flag set the test configured is the intended
  shape.
- **The breadcrumb takes one key and returns its value unchanged**, so it wraps a read
  where the read already stands and changes nothing the code does. *Read
  nothing* is only as complete as the wrapping: a read nobody wrapped is
  silent. Wrapping the flag client's getter once records every read through it,
  with the getter's line as each read's site; wrapping at the consuming line
  costs a call per read and keeps the line that decided, a value the
  application cached after one evaluation included.

The breadcrumb is called from application source, and that fixes three things the
precondition does not share:

- **It never throws.** A misuse — a dimension or key that is not a non-empty
  string, or a dimension with a `:` — is recorded on the case as a fact of its
  own, the argument that was wrong and what it was given, at its site, apart
  from what the code read, once per argument and value as a read is once per
  key and value, and the value
  is returned. A recorder's failure is
  swallowed, as the precondition's is.
- **It imports nothing and costs one property read without a recording**,
  measured, because it runs in production builds. Like the precondition's
  entry, it reads one function a recording installs under a `Symbol.for` key on
  `globalThis`, so the cost is the code's promise, not the bundler's.
- **It lives in `@variance-authority/event`**, beside `vae`. That is the package
  whose calls already live in application source and ship with it, and whose
  one dependency is `@variance-authority/wire`. `@variance-authority/sense`
  brings a native addon per platform with it, which no product bundle should
  depend on. A breadcrumb is not an announcement: `vae` carries no value by design,
  and the value is the point of a breadcrumb. It shares the transport, not the
  contract.

## Which case a read belongs to

- **Under Vitest, Jest and Rstest in Node**, the read lands on the case running
  when it is made, through the case scope preconditions already use.
- **A read made while the test file loads** — `const enabled = flags.newCheckout`
  at a module's top level — lands on the test file, marked *at load*, and every
  case of that file carries it. It is the value every one of them ran under,
  and the read will not happen again for any of them.
- **In a Vitest browser realm**, the read lands as a precondition said there
  does.
- **In a page a Playwright case drives**, the execution collector's journal
  carries the read to the driver with its drain, and it lands on the case
  driving the page. One case drives one page at
  a time; interleaving cases are not supported.
- **A read in a `beforeAll`** lands as one at load does, on every case of the
  `describe` that declared it: a value built once there is the value each of
  those cases ran under.
- **A read where no case is running after load** — an `afterAll`, a timer that
  outlives its case — lands on no case. The breadcrumb cannot throw where the
  precondition would, so the read is counted on its test file and reported with
  its site.
- **One key read twice with one value** is recorded once. **One key read with two
  values** in one case keeps both, each with the site of its first read.
- **Each read keeps its site**, the repository-relative `file:line` of the
  breadcrumb call, taken only on the first read of a key and value in a case so that a flag
  read on every render costs a set lookup after the first.

## What is recorded

On the case row of spec 0094, beside the preconditions: for each dimension the
case read, its `(key, value, site)` reads, a value JSON cannot hold marked
*unrecorded*, and each misuse of the breadcrumb: the argument, the value it was
given and its site. On the test file: the
reads made *at load*, which every case of the file carries, and the count of
reads made where no case was running, with their sites.

A read is recorded as spec 0093 lays a precondition: an item `(name, value,
site)` and the set of cases that read it, interned in the record's crossing-set
pool, in a `tests.read` section with the layout and the owner ADR-0094 gives
`tests.said`. A test that says a whole flag set says every key on every case,
and those cases share one set per key and value, so the size grows with the
distinct facts, not with the cases; the size that adds to this repository's
recording is measured and stated.

Absent is not empty. A record made before this column existed answers
**unmeasured**. A case from a recording that listened and read nothing keeps an
empty read: its case line prints nothing about reads, since in a codebase that
leaves no breadcrumb that is every case, and a region's split counts it under
`not by`.

A breadcrumb, like a precondition, **never selects and never excludes** a test.

## Where it is read

- **`covering` and `review`, for each case they list**, print the keys that case
  read, with the value read and the value it said for the same key, or *said
  nothing*. In a dimension the case read, a key that was said and never read is
  not printed: a test passing a whole flag set says hundreds of keys, and the
  reading is about the ones the code consulted. A dimension the case said and
  never read prints as spec 0093 prints it.
- **`--read <dimension>[:<key>][=<value>]`** keeps the cases that read it, as
  `--where` keeps the cases that said it, with the same grammar. The two filters
  stay separate, because said and read are separate facts.
- **A misused breadcrumb** prints after the reads, with its site and what was
  wrong, and a region's split names it after the split by key, with the number
  of cases that met it. No filter and no split counts it as a read.
- **The handover `review --format handover` writes for a reviewer** carries the
  reads of every case it names on a changed region.

## Prior art

- **SPLat** (Kim, Marinov, Khurshid, Batory, Souto, Barros and d'Amorim, FSE
  2013) records which configuration variables an execution reads and explores
  only the configurations over those. The breadcrumb is SPLat's observation, kept as a
  fact on the case rather than used to enumerate runs.
- **Piranha** (Uber, ICSE SEIP 2020) declares the flag API in configuration so
  that a static rewrite finds every read. It is static only and answers flag
  removal, not what ran.
- **OpenFeature hooks** see the key and the resolved value at each evaluation.
  They are a possible second intake, and they miss a value an application caches
  after evaluating it once.
- **OpenTelemetry's `feature_flag` semantic conventions** record a flag's key
  and resolved value per evaluation, on the trace that made it. They are the
  industry's shape for the same fact, and a later intake for a head.
- **LaunchDarkly Code References** lists where a key occurs in source, without
  execution.

None of them joins what was read to the cases that entered a changed region.

## What would discharge it

1. `variancePrecondition(dimension, record)`, with the one-argument form deleted
   and every caller in the repository and its examples moved; values recorded as
   JSON text; a dimension holding `:` refused.
2. `varianceBreadcrumb` in `@variance-authority/event`: returns its value, never
   throws, the no-recording call measured as one property read, misuse recorded
   on the case.
3. The recording side under Vitest, Jest and Rstest through the case scope, in
   the Vitest browser realm, and under Playwright through the execution collector's drain.
   Fixtures for a read in the case body, a read at load, a read after its case
   settled, one key read with two values, a read with no recording, and a
   recorder that throws.
4. The read column on the case rows and in the journal frame, the file's
   *at load* reads and its count of reads outside a case, the *unrecorded*
   marker and recorded misuse; the size the reads and a whole said flag set add
   to this repository's recording stated, and the unmeasured answer for an
   older record.
5. `covering`, `review` and the handover printing reads beside what was said,
   and `--read`. Fixtures read off `review`'s output: a change behind a new
   flag that a flag-off case reaches, one it does not, and the old code moved
   into the flag-off arm by an `else`, a ternary and an early return, each with
   the output it is expected to print.

Items 1 and 2, item 3 under Vitest, Jest and Rstest in Node and under
Playwright, and item 5 for `review` land first, end to end, except a
Playwright read made while a test file loads, which lands on no case; the other
runners and readings follow.

## Open

- **A read in a head.** A flag read by a server the page calls belongs to the
  case through the journey's trace context
  ([spec 0036](0036-a-journey-crosses-processes.md)); nothing carries it there
  yet.
- **The site of a read in a page** is a bundled location. Turning it into a
  repository file needs the bundle's source map; what is recorded without one
  is open.
- **Skipping a flag-off case** in selection, rather than running it and reading
  that it did not move, would need a static proof that the change is guarded by
  the flag. It is not part of this spec.
