# Name what a case arranged

Have each test say the state it set up, such as a flag or what a mock
returns, and `variance covering` tells you which tests ran a line in that state
and which ran it without.

## Why the recording needs to be told

[Test-level coverage](test-level-coverage.md) records, for each test case, the
regions of your source it ran. A case has three steps: Arrange, Act and
Assert. Act runs your source. Arrange mostly runs in the test: `vi.mock`, a
feature flag written into a store, a fixture loaded into a fake database. Each one
changes what your source does, and none of them is a region of your source.

Two cases that call `total` with the full price table and with the sale table
cover the same lines of `src/checkout/total.ts`. The difference between them is
what the test told the mock to return, and the recording does not see it. The
test source does not settle it either: a `beforeEach` in a nested `describe`
overrides one at the top of the file, and a helper sets the state for whoever
calls it, so which state a case ran in is decided while the suite runs.

So the code that arranges the state says what it arranged. Each thing it says
is a **case precondition**: a name and a value, recorded on the case's row with
the `file:line` of the call. A case's preconditions name the scenario it
covers — sale prices with the flag on, full prices with the flag off.

## Say it in the helper that arranges it

Put `variancePrecondition` inside the test helper that sets the state, so every
case that sets it through the helper says it. This helper turns the discount
flag on or off:

```ts
// test/flags.ts
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { type Flag, flags } from '../src/flags.js';

export function setFlag(flag: Flag): void {
  flags.discount = flag;
  variancePrecondition({ flag });
}
```

This one sets what the mocked `fetchPrices` returns:

```ts
// test/prices.ts
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { vi } from 'vitest';
import { fetchPrices } from '../src/checkout/prices.js';

const TABLES = {
  full: { apple: 2, pear: 3 },
  discounted: { apple: 1, pear: 2 },
};

export function pricesReturn(table: keyof typeof TABLES): void {
  vi.mocked(fetchPrices).mockResolvedValue(TABLES[table]);
  variancePrecondition({ prices: table });
}
```

The test file calls only the helpers:

```ts
// test/total.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { total } from '../src/checkout/total.js';
import { setFlag } from './flags.js';
import { pricesReturn } from './prices.js';

vi.mock('../src/checkout/prices.js');

beforeEach(() => {
  setFlag('ff-off');
  pricesReturn('full');
});

describe('on sale', () => {
  beforeEach(() => {
    pricesReturn('discounted');
  });

  it('charges the sale price', async () => {
    expect(await total(['apple', 'pear'])).toBe(3);
  });

  it('discounts the sale price behind the flag', async () => {
    setFlag('ff-on');
    expect(await total(['apple', 'pear'])).toBe(2.7);
  });
});

it('charges the full price', async () => {
  expect(await total(['apple', 'pear'])).toBe(5);
});

it('discounts the full price behind the flag', async () => {
  setFlag('ff-on');
  expect(await total(['apple', 'pear'])).toBe(4.5);
});
```

The site recorded on each row is the line in the helper, `test/flags.ts:6` or
`test/prices.ts:12`. A case precondition is not the integration's file-level
`preconditions` option described in [distance](distance.md), which names a file
a test reads so that editing the file selects the test; a case precondition
never selects a test.

### What the call takes

```ts
import { variancePrecondition } from '@variance-authority/sense/precondition';
```

The call takes a record of names to values, and one record can name several:
`variancePrecondition({ flag: 'ff-on', prices: 'discounted' })`. A value is a
string, a finite number or a boolean. When one value is anything else, the
whole record is dropped and the console says so:

```text
variance-authority: variancePrecondition at test/cleanup.test.ts:9 takes a record of names to a string, number or boolean; nothing was recorded
```

The entry point imports nothing, and without a recording the call does
nothing, so a helper your tests share can keep it. Vitest, Jest, Rstest and
Playwright record each call on a case when the suite is recorded with
[test-level coverage](test-level-coverage.md); the rest of this page describes
a recorded run.

### Which case a call is recorded on

- **In a case body**, or in a helper the body calls, the precondition is that
  case's.
- **In a `beforeEach`**, or in a helper the hook calls, it belongs to the case
  the hook runs for, at the level of the `describe` that declared the hook: the
  file's top level, then one deeper for each nested `describe`. The case body
  is the highest level.
- **The highest level wins, per name.** In `test/total.test.ts` above, the two
  `on sale` cases ran with `prices=discounted`, and the two cases that call
  `setFlag('ff-on')` ran with `flag=ff-on`.
- **Two values at one level are a contradiction, and both are kept.** The
  recording does not pick one. A retry that says a different value from the
  first attempt is the same contradiction.
- **In an `afterEach`**, the call is recorded on no case, because cleanup is
  not Arrange. The console names the call:

  ```text
  variance-authority: variancePrecondition at test/cleanup.test.ts:5 ran after its case and is recorded on no case — say what a case arranged before it runs
  ```

- **Where no case is running** — in a `describe` callback, a `beforeAll` or
  `afterAll`, at the file's top level, or from work that outlives its case — the
  call throws, and the test file fails:

  ```text
  Error: variance-authority: variancePrecondition at test/misplaced.test.ts:5 ran outside a running case — a precondition belongs to the case it arranged, so say it in the case body or in a beforeEach
  ```

  Under Playwright, a call at the top level or in a `describe` callback of the
  first file a worker loads records nothing and does not throw.

  A state set up once for a whole file is still a state each case ran in, so
  say it in a top-level `beforeEach`.
- **A `beforeEach` that throws** records nothing on its case, including what it
  said before the throw.

## Read it back

`variance covering` names the cases that ran a file, a line or a function of
your source, and prints what each one said beside it. The examples below come
from `test/total.test.ts` above and a second file, `test/refund.test.ts`, whose
two cases set the sale prices and the flag to `ff-on` and `ff-half`. The root
`variance.config.json` declares the flag as an axis, explained under
[twins](#twins):

```bash
variance covering --file src/checkout/total.ts --function total
```

```text
6 named tests covered function total of src/checkout/total.ts:
  test/total.test.ts — 4/4
    charges the full price — flag=ff-off (test/flags.ts:6), prices=full (test/prices.ts:12)
    discounts the full price behind the flag — flag=ff-on (test/flags.ts:6), prices=full (test/prices.ts:12)
      twin at flag=ff-off: charges the full price
    on sale > charges the sale price — flag=ff-off (test/flags.ts:6), prices=discounted (test/prices.ts:12)
    on sale > discounts the sale price behind the flag — flag=ff-on (test/flags.ts:6), prices=discounted (test/prices.ts:12)
      twin at flag=ff-off: on sale > charges the sale price
  test/refund.test.ts — 2/2
    refunds at the half rollout — flag=ff-half (test/flags.ts:6), prices=discounted (test/prices.ts:12)
    refunds the discounted total behind the flag — flag=ff-on (test/flags.ts:6), prices=discounted (test/prices.ts:12)
      no twin recorded at flag=ff-off
```

A value `true` prints as the bare name, so a case that said
`variancePrecondition({ 'seeded-cart': true })` prints `seeded-cart`. A
contradiction prints `flag contradicted:` and both values, each with its site.

### Keep the cases that said it

`--where name=value` keeps the cases that said it:

```bash
variance covering --file src/checkout/total.ts --function total --where prices=discounted
```

```text
Kept the 4 of 6 cases that covered function total of src/checkout/total.ts and said prices=discounted.
  flag=ff-half (test/flags.ts:6) is not one of ff-off, ff-on
4 named tests covered function total of src/checkout/total.ts:
  test/refund.test.ts — 2/2
    refunds at the half rollout — flag=ff-half (test/flags.ts:6), prices=discounted (test/prices.ts:12)
    refunds the discounted total behind the flag — flag=ff-on (test/flags.ts:6), prices=discounted (test/prices.ts:12)
      no twin recorded at flag=ff-off
  test/total.test.ts — 2/4
    on sale > charges the sale price — flag=ff-off (test/flags.ts:6), prices=discounted (test/prices.ts:12)
    on sale > discounts the sale price behind the flag — flag=ff-on (test/flags.ts:6), prices=discounted (test/prices.ts:12)
      twin at flag=ff-off: on sale > charges the sale price
```

The count in `Kept` is out of the cases that covered what you asked, before
`--where`, and within the
[`--cases`](../packages/cli/README.md#reading-the-test-you-are-writing) scope
when you give one.

- `--where prices` keeps every value of `prices`.
- Repeat `--where` and a case is kept only when it said all of them.
- Values are compared as text, so `--where seeded-cart` and
  `--where seeded-cart=true` keep the same cases.
- A contradiction is kept by a `--where` naming either of its values.
- When `--where` keeps none of the cases, the answer says so and counts them:

  ```text
  Kept none of the 4 cases that covered function applyDiscount of src/checkout/total.ts: none said flag=ff-off.
  ```

`--where` works with `--line`, `--function`, a whole file and `--since`, and in
every format.

### Twins

A name becomes an axis when `names.axes` in the root `variance.config.json`
declares its values, the same vocabulary
[variations](variations.md#tell-it-what-the-words-mean) reads subject names
with:

```json
{
  "names": {
    "axes": [{ "axis": "flag", "values": ["ff-off", "ff-on"] }]
  }
}
```

The first value is the base. A case that never said `flag` ran at the base
value, `ff-off`, so `--where flag=ff-off` keeps it.

Once an axis is declared, every case off its base prints its **twin**: the
case with the nearest value toward the base on the last declared axis the case
is off its base on, and every other name the same. `discounts the full price behind the flag` has `charges the full
price` as its twin, and not `on sale > charges the sale price`, because a name
off the axes, here `prices`, has to match exactly. Twins print with or without
`--where`, in every answer: a line, a function, a whole file, `--since`.
Several twins print with their count, and a case at the base of every axis
prints no twin line.

A twin is looked for only among the cases of the same test file that covered
what you asked, before `--where` and within the `--cases` scope. A case in
another file is not looked at, because a case that said nothing is at the base
of every axis, and across files
it would be the twin of every case that said a value. So
`no twin recorded at flag=ff-off` means no case in this test file ran this code
at `ff-off` with everything else the same. It can mean the twin is in another
file, as it is for `refunds the discounted total behind the flag`, or that no
case runs this code at `ff-off`. On `applyDiscount`, which only runs with the
flag on, every `ff-on` case prints it.

With several axes, the twin differs from the case only on the last axis, in
the order you declare them, that the case is not at the base of, as
[variations](variations.md#tell-it-what-the-words-mean) reads a name. A value
the axis does not list, such as `ff-half` above, gives the case no twin on that
axis. Under `--where`, it is printed under `Kept` with its site, and the case
is kept.

Under `--format json`, each test has `preconditions: [{name, value, site,
level}]`, where `level` is `0` for the file's top-level `beforeEach`, one more
for each nested `describe`, and highest for the case body. The answer has
`where: {asked, kept, of, unmeasured, outside}`, where `outside` lists the
values said off a declared axis, and `twins: [{case, axis, from, to, twins}]`,
where an empty `twins` is `no twin recorded`.

## An unmeasured record

A row says `preconditions: []` when the case's runner recorded preconditions
and the case said nothing. A row with no `preconditions` field was recorded by
a runner that does not record them, and whether that case arranged anything is
unmeasured.
When no row in the record has the field, `--where` is refused with exit `2`
rather than answered with no case, and under `--format json` stdout is
`{"refused":"unmeasured"}`. Record the suite again to read the preconditions.
When only some rows lack it, the answer counts those cases apart from the
cases that said nothing, in a line under `Kept`:
`N cases were not listened to, so whether they said any of that is unmeasured.`
