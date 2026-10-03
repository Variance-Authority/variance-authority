# Case preconditions

A **case precondition** is a state one test case says it arranged — the network
mocked, a flag on, a cart seeded — written as a name and a value, and recorded
on that case's row in [test-level coverage](test-level-coverage.md) with the
`file:line` of the call that said it. It turns *which tests ran this line* into
*which tests ran this line with the network mocked*, and it lets you find the
case that ran the same code with the flag off.

## Why the recording cannot see Arrange

Test-level coverage names the cases that ran a region of your source. It cannot
tell you under what state they ran it, because Arrange mostly happens outside
the code it measures. `vi.mock('./api')`, a feature-flag override, a fixture
written into a fake store: each one changes what your source does, and none of
them is a region of your source. Two cases that ran `applyDiscount`, one with
the flag on and one with it off, look the same in the recording. The difference
between them lives in the test file, and of a test file the recording keeps
only the names of its cases.

So the case says it, as part of its Arrange:

```ts
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { expect, it } from 'vitest';
import { total } from '../src/checkout/total.js';
import { setFlag } from './flags.js';

it('discounts behind the flag', () => {
  setFlag('ff-on');
  variancePrecondition({ flag: 'ff-on' });
  expect(total([5], 2)).toBe(3);
});
```

Both this case and one without the flag run `applyDiscount`; only this one's
row says `flag=ff-on`, with the `file:line` of the call.

Reading the difference back from the test source does not work either. A mock
set up three `describe` levels out, a `beforeEach` that one nested block
overrides, a helper that sets the flag for whoever calls it: the state a case
ran under is resolved at run time, by the runner, in an order the source does
not show. The case says it at the moment it arranges it, and the runner — which
knows which case is running and which hook it is in — places it.

### What it is not

- **Not a file-level precondition.** The execution integration's
  `preconditions` option, described in [distance](distance.md), names a file a
  test depends on without importing it: a README, a fixture read with `fs`.
  Editing that file selects every test that declared it. A case precondition is
  a name and a value, nothing in a checkout changes it, and so it never selects
  a test and never excludes one. It is read, never diffed.
- **Not a scenario.** A [runtime scenario](scenarios.md) records a UI
  state your harness arranged and compares what it rendered across authored
  Acts. A case precondition labels a unit or integration test's coverage row,
  and compares nothing on its own.
- **Not an announcement.** An announcement is a call your *application* makes
  to [`@variance-authority/event`](https://variance-authority.dev/reference/packages/event)
  at a decision, which a test waits for. A case precondition is the *test*
  saying what it set up before the code ran.

## Say what a case arranged

```ts
import { variancePrecondition } from '@variance-authority/sense/precondition';
```

The call takes a record of names to values, and one record can name several:

```ts
variancePrecondition({ network: 'mocked' });
variancePrecondition({ flag: 'ff-on', colour: 'green' });
variancePrecondition({ 'seeded-cart': true });
```

A value is a string, a finite number or a boolean. Anything else is reported on
the console and records nothing:

```text
variance-authority: variancePrecondition at /home/you/shop/test/total.test.ts:24 takes a record of names to a string, number or boolean; nothing was recorded
```

The `@variance-authority/sense/precondition` entry point imports nothing.
Without a recording the call is one property read and does nothing, in Node
and in a page — it neither records nor throws, wherever it is made — so it can
stay in a helper your tests share.
Vitest, Jest, Rstest and Playwright place each call on a case (*listen*, below)
when the suite is recorded with [test-level coverage](test-level-coverage.md);
everything under this heading describes a recorded run.

### Where a call lands

Say it where you arrange it. This file mocks the network for one `describe`
and turns a flag on in one case:

```ts
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { beforeEach, describe, expect, it } from 'vitest';
import { total } from '../src/checkout/total.js';

beforeEach(() => {
  variancePrecondition({ network: 'live' });
});

describe('offline', () => {
  beforeEach(() => {
    variancePrecondition({ network: 'mocked' });
  });

  it('pays', () => {
    expect(total([1, 2])).toBe(3);
  });

  it('discounts behind the flag', () => {
    variancePrecondition({ flag: 'ff-on' });
    expect(total([5], 2)).toBe(3);
  });

  it('discounts without the flag', () => {
    expect(total([5], 1)).toBe(4);
  });
});

it('pays against the live service', () => {
  expect(total([4])).toBe(4);
});
```

- **In a case body**, the precondition is that case's.
- **In a `beforeEach`**, the precondition belongs to the case the hook runs
  for, at the level of the
  `describe` that declared the hook: the file's top level, then one deeper for
  each nested `describe`.
- **The narrowest level wins, per name.** The case body overrides any
  `beforeEach`, and an inner `describe`'s `beforeEach` overrides an outer one's.
  Above, the three `offline` cases ran with `network=mocked` and the last case
  with `network=live`.
- **Two values at one level are a contradiction, and both are kept.** The
  recording does not pick one for you. A retry that says a different value from
  the first attempt is the same contradiction.
- **In an `afterEach`**, the call lands on no case, because cleanup is not
  Arrange. It is reported with its site:

  ```text
  variance-authority: variancePrecondition at /home/you/shop/test/refund.test.ts:6 ran after its case and is recorded on no case — say what a case arranged before it runs
  ```

- **Where no case is running** — in a `describe` callback, a `beforeAll` or
  `afterAll`, at the file's top level, or from work that outlives its case — the
  call throws, and the test file fails:

  ```text
  Error: variance-authority: variancePrecondition at /home/you/shop/test/misplaced.test.ts:5 ran outside a running case — a precondition belongs to the case it arranged, so say it in the case body or in a beforeEach
  ```

  A state set up once for a whole file is still a state each case ran under,
  so say it in a top-level `beforeEach`.
- **A `beforeEach` that throws** records nothing on its case, including what it
  said before the throw.

## Read it back

`variance covering` names the cases that ran a file, a line or a function of
your source; [test-level coverage](test-level-coverage.md) introduces it. Every
case it lists for a file, a line or a function prints
what it said and the call that said it:

```bash
variance covering --file src/checkout/total.ts --line 2
```

```text
4 named tests covered line 2 of src/checkout/total.ts:
  test/total.test.ts — 4/4
    offline > discounts behind the flag — flag=ff-on (test/total.test.ts:19), network=mocked (test/total.test.ts:11)
    offline > discounts without the flag — network=mocked (test/total.test.ts:11)
    offline > pays — network=mocked (test/total.test.ts:11)
    pays against the live service — network=live (test/total.test.ts:6)
```

`--where name=value` keeps the cases that said it:

```bash
variance covering --file src/checkout/total.ts --line 2 --where network=mocked
```

```text
Kept the 3 of 4 cases that said network=mocked.
3 named tests covered line 2 of src/checkout/total.ts:
  test/total.test.ts — 3/4
    offline > discounts behind the flag — flag=ff-on (test/total.test.ts:19), network=mocked (test/total.test.ts:11)
      2 twins at flag=ff-off: offline > discounts without the flag, offline > pays
    offline > discounts without the flag — network=mocked (test/total.test.ts:11)
    offline > pays — network=mocked (test/total.test.ts:11)
```

The `twins` line is read in [axes and twins](#axes-and-twins) below.

The `Kept` line counts every case in the record, wherever it ran, or every case
[`--cases`](../packages/cli/README.md#reading-the-test-you-are-writing) scoped
the question to; the answer below it lists the kept cases that covered what you
asked about.

- `--where network` keeps every value of `network`.
- Repeat `--where` and a case is kept only when it said all of them:
  `--where network=mocked --where flag=ff-on` prints `Kept the 1 of 4 cases that
  said network=mocked and flag=ff-on.`

With a second file, `test/refund.test.ts`, recorded beside the first, the
record has seven cases, and the remaining examples come from it.

- Values are compared as text, so `--where seeded-cart` and
  `--where seeded-cart=true` both keep a case that said
  `variancePrecondition({ 'seeded-cart': true })`. It prints as the bare name:
  `seeds a cart — seeded-cart (test/refund.test.ts:28)`.
- A contradiction prints both values with their sites, and a `--where` naming
  either one keeps it:

  ```text
  confused > discounts twice over — flag contradicted: ff-off (test/refund.test.ts:19), ff-on (test/refund.test.ts:18)
  ```

`--where` works with `--line`, `--function`, a whole file and `--since`, and in
every format. Under `--format json` each test has
`preconditions: [{name, value, site, level}]`, where `level` is `0` for the
file's top-level `beforeEach`, one more for each nested `describe`, and `65535`
for the case body. The answer has
`where: {asked, kept, of, unmeasured, outside}`, where `outside` lists the
values said off a declared axis, and, beside a line or a function,
`twins: [{case, axis, from, to, twins}]`.

### Axes and twins

A name becomes an axis when `names.axes` in the root `variance.config.json`
declares its values, the same vocabulary [variations](variations.md#tell-it-what-the-words-mean)
reads subject names with:

```json
{
  "names": {
    "axes": [{ "axis": "flag", "values": ["ff-off", "ff-on"] }]
  }
}
```

The first value is the base. A case that never said `flag` ran at `ff-off`, so
`--where flag=ff-off` keeps it: on line 2 above, that is the three cases that
said no flag.

Under `--where`, every case listed beside a line or a function prints its
**twin**: the case one step toward the base on its last declared axis, that
said everything else the same. A case already at the base of every axis has no
twin line. A name off the axes, such as `network` above,
has to match exactly, so the twins of `discounts behind the flag` are the
`network=mocked` cases with no flag, not the live one. Several twins are
printed with their count. Twins are looked up among the cases that covered the
line or the function before `--where` narrowed them, so a twin is a case that
ran the same code:

```bash
variance covering --file src/checkout/total.ts --function applyDiscount --where flag=ff-on
```

```text
Kept the 1 of 4 cases that said flag=ff-on.
1 named test covered function applyDiscount of src/checkout/total.ts, and it is the only case that could have:
  test/total.test.ts — 1/4
    offline > discounts behind the flag — flag=ff-on (test/total.test.ts:19), network=mocked (test/total.test.ts:11)
      twin at flag=ff-off: offline > discounts without the flag
```

`offline > pays` is a twin on line 2 and not here, because it never called
`applyDiscount`. A case with no case one step down prints
`no twin recorded at flag=ff-off`.

With several axes, the order you declare them in is the order a twin steps
back through, so it has to be the same order every time — the
[great green dragon rule](variations.md). A value the axis does not list is
printed by name with its site, and the case is kept:

```text
Kept the 1 of 7 cases that said flag=ff-half.
  flag=ff-half (test/refund.test.ts:11) is not one of ff-off, ff-on
1 named test covered line 2 of src/checkout/total.ts, and it is the only case that could have:
  test/refund.test.ts — 1/3
    half rollout > discounts at half — flag=ff-half (test/refund.test.ts:11), network=mocked (test/refund.test.ts:11)
```

## Absent is not empty

A case row says `preconditions: []` when the case was listened to and said
nothing. A row with no `preconditions` at all was not listened to: the record
was made before cases said what they arranged, or by a runner that did not
listen. An empty list would read as *no case had the network mocked*, which is
a claim the record cannot make, so a record where no case was listened to is
refused, with exit `2`:

```text
`--where network=mocked` is unmeasured here: the record holds no case's preconditions. It was made before cases said what they arranged, or by a runner that did not listen. Record the suite again to read them.
```

Under `--format json` stdout is `{"refused":"unmeasured"}`. When only some
cases were not listened to, the answer counts them apart from the cases that
said nothing, in a line under `Kept`: `2 cases were not listened to, so whether
they said any of that is unmeasured.`

## Recipes

**Which tests ran this function with the network mocked**

```bash
variance covering --file src/checkout/total.ts --function applyDiscount --where network=mocked
```

**What did the tests covering this line arrange**

```bash
variance covering --file src/checkout/total.ts --line 2
```

Each case is followed by what it said. A case with nothing after its name was
listened to and said nothing.

**Find the flag-off twin of a case**

Declare the flag as an axis with its base first, then ask under `--where` at
the case's value:

```bash
variance covering --file src/checkout/total.ts --line 2 --where flag=ff-on
```

The `twin at flag=ff-off:` line under each case names it. `no twin recorded`
means no case that covered the line said everything else the same with the
flag off — that is a test you have not written.

**Declare what a test arranged**

Put the call beside the arrangement, in the `beforeEach` or the case body that
does it, and record the suite again. A helper that sets the state can say it
for every case that calls it.

**The answer says unmeasured**

The record predates the calls, or the runner did not listen. Record the suite
again with test-level coverage; asking again before that changes nothing.
