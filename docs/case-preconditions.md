# Record the state each test ran under

[Test-level coverage](test-level-coverage.md) tells you which tests ran a piece
of code. A **case precondition** records the state each of those tests ran it
under: a feature flag, what a mock returns, which user a fixture signs in.
Coverage gives you the code path; case preconditions give that path its
scenario.

Two tests can run exactly the same lines under different conditions:

- a feature flag is on in one and off in the other;
- a mock returns full prices in one and discounted prices in the other;
- a fixture is an admin in one and a regular user in the other.

Those conditions are part of what each test covers, and execution coverage
cannot see them: they are set in the test, not in a region of your source.

## A first example

Record the state in the helper that changes it:

```ts
// test/flags.ts
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { flags } from '../src/flags.js';

export function setDiscountFlag(enabled: boolean): void {
  flags.discount = enabled;
  variancePrecondition({ discount: enabled ? 'on' : 'off' });
}
```

Tests call the helper as they did before:

```ts
// test/total.test.ts
import { expect, it } from 'vitest';
import { total } from '../src/checkout/total.js';
import { setDiscountFlag } from './flags.js';

it('charges the regular price', async () => {
  setDiscountFlag(false);
  expect(await total(['apple', 'pear'])).toBe(5);
});

it('applies the discount', async () => {
  setDiscountFlag(true);
  expect(await total(['apple', 'pear'])).toBe(4.5);
});
```

Record the suite with [test-level coverage](test-level-coverage.md), and
`variance covering` answers which tests ran `total`, and in which state:

```bash
variance covering --file src/checkout/total.ts --function total
```

```text
2 named tests covered function total of src/checkout/total.ts:
  test/total.test.ts — 2/2
    applies the discount — discount=on (test/flags.ts:6)
    charges the regular price — discount=off (test/flags.ts:6)
```

`covering` calls each test a case, as the runners do: one `it` or `test`, by
its file and its `describe` path. Each value carries the `file:line` of the call
that recorded it. Here that is
the line in the helper, so every test that uses `setDiscountFlag` points back to
one place.

## Record state where you arrange it

Do not repeat the metadata in every test. A helper that owns a state change
records it too. This one sets what the mocked `fetchPrices` returns:

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

Setup can now carry the defaults, and a nested `describe` or a test body
refines them:

```ts
// test/total.test.ts
vi.mock('../src/checkout/prices.js');

beforeEach(() => {
  setDiscountFlag(false);
  pricesReturn('full');
});

it('charges the regular price', async () => {
  expect(await total(['apple', 'pear'])).toBe(5);
});

it('applies the discount', async () => {
  setDiscountFlag(true);
  expect(await total(['apple', 'pear'])).toBe(4.5);
});

describe('sale prices', () => {
  beforeEach(() => {
    pricesReturn('discounted');
  });

  it('charges the sale price', async () => {
    expect(await total(['apple', 'pear'])).toBe(3);
  });

  it('applies the discount', async () => {
    setDiscountFlag(true);
    expect(await total(['apple', 'pear'])).toBe(2.7);
  });
});
```

Each test is recorded with the state that applied to it. The more specific
setup wins for the same name: the nested `beforeEach` over the top-level one,
and the test body over both.

```text
4 named tests covered function total of src/checkout/total.ts:
  test/total.test.ts — 4/4
    applies the discount — discount=on (test/flags.ts:6), prices=full (test/prices.ts:12)
    charges the regular price — discount=off (test/flags.ts:6), prices=full (test/prices.ts:12)
    sale prices > applies the discount — discount=on (test/flags.ts:6), prices=discounted (test/prices.ts:12)
    sale prices > charges the sale price — discount=off (test/flags.ts:6), prices=discounted (test/prices.ts:12)
```

The test does not need a second description of what its helpers already did.

## Find coverage for a particular scenario

`--where` keeps only the covering tests that ran under a precondition:

```bash
variance covering --file src/checkout/total.ts --function total --where prices=discounted
```

```text
Kept the 2 of 4 cases that covered function total of src/checkout/total.ts and recorded prices=discounted.
2 named tests covered function total of src/checkout/total.ts:
  test/total.test.ts — 2/4
    sale prices > applies the discount — discount=on (test/flags.ts:6), prices=discounted (test/prices.ts:12)
    sale prices > charges the sale price — discount=off (test/flags.ts:6), prices=discounted (test/prices.ts:12)
```

- `--where prices` keeps every test that recorded `prices`, whatever its value.
- `--where prices=discounted` keeps one value.
- Repeat `--where` to require several:
  `--where prices=discounted --where discount=on`.

On a name you declare as an axis, below, a test that recorded nothing for it is
read at the axis's base, and `--where` matches it there.

`--where` works with `--line`, `--function`, a whole file and `--since`, and in
every format. The count in `Kept` is out of the tests that covered what you
asked, before `--where`, and within the
[`--cases`](../packages/cli/README.md#reading-the-test-you-are-writing) scope
when you give one. When `--where` keeps none, `covering` prints that and counts
them:

```text
Kept none of the 4 cases that covered function total of src/checkout/total.ts: none recorded prices=sale.
```

## Twins

Some preconditions have a meaningful base: flag off against flag on, default
against experimental behaviour, anonymous against signed in. Declare those
values as an axis in the root `variance.config.json`:

```json
{
  "names": {
    "axes": [{ "axis": "discount", "values": ["off", "on"] }]
  }
}
```

The first value is the base. Every covering test recorded away from the base
now prints its **twin**: the test in the same file that covered the same code
with `discount` nearer the base and every other precondition the same. On a
two-value axis such as this one, that is the base.

```text
4 named tests covered function total of src/checkout/total.ts:
  test/total.test.ts — 4/4
    applies the discount — discount=on (test/flags.ts:6), prices=full (test/prices.ts:12)
      twin at discount=off: charges the regular price
    charges the regular price — discount=off (test/flags.ts:6), prices=full (test/prices.ts:12)
    sale prices > applies the discount — discount=on (test/flags.ts:6), prices=discounted (test/prices.ts:12)
      twin at discount=off: sale prices > charges the sale price
    sale prices > charges the sale price — discount=off (test/flags.ts:6), prices=discounted (test/prices.ts:12)
```

`applies the discount` is twinned with `charges the regular price`, not with
`sale prices > charges the sale price`, because `prices` differs. That puts a
question in front of you while you read coverage: *this code ran with the
discount on; did a test also run it with the discount off, everything else
equal?*

When no such test exists, `covering` prints that:

```text
    applies the discount — discount=on (test/flags.ts:6), prices=full (test/prices.ts:12)
      no twin recorded at discount=off
```

That means no test in the same file covered this code with `discount=off`,
recorded or read at the base, and the same other preconditions. It does not mean
that no such test exists elsewhere, and on code that only runs with the discount
on, such as an `applyDiscount` function, every `discount=on` test prints it.

Twins are looked for only within one test file, among the tests that covered
what you asked, before `--where` and within the `--cases` scope. Across files,
a test that recorded nothing is read at the base of every axis, so it would be
the twin of every test that recorded a value. Twins print with or without `--where`,
in every answer.

## Reference

### What `variancePrecondition` takes

```ts
import { variancePrecondition } from '@variance-authority/sense/precondition';

variancePrecondition({ discount: 'on', prices: 'discounted', 'seeded-cart': true });
```

The call takes a record of names to values. A value is a string, a finite
number or a boolean. When one value is anything else, the whole record is
dropped and the console names the call:

```text
variance-authority: variancePrecondition at test/cleanup.test.ts:9 takes a record of names to a string, number or boolean; nothing was recorded
```

The entry point has no dependencies and does not change what the test does.
Without a recording the call does nothing, so a helper your tests share can
keep it. Vitest, Jest, Rstest and Playwright record it when the suite is
recorded with [test-level coverage](test-level-coverage.md).

A value `true` prints as the bare name, so `{ 'seeded-cart': true }` prints
`seeded-cart`. Values are compared as text, so `--where seeded-cart=true`
keeps the tests that recorded `true`. A bare `--where seeded-cart` keeps every
value, `false` included.

### Which test a call is recorded on

| Where the call runs | What is recorded |
|---|---|
| The test body, or a helper it calls | On that test |
| A `beforeEach`, or a helper it calls | On the test the hook runs for, at the level of the `describe` that declared the hook |
| A more deeply nested `beforeEach`, or the test body | Overrides the same name from an outer `beforeEach` |
| Two different values at one level | Both, as a contradiction |
| A `beforeEach` that throws | Nothing, including what it recorded before the throw |
| An `afterEach` | Nothing, with a warning |
| Where no test is running | An error that fails the test file |

An `afterEach` runs after the test, so it does not describe the state the test
ran under. The console names the call:

```text
variance-authority: variancePrecondition at test/cleanup.test.ts:5 ran after its case and is recorded on no case — say what a case arranged before it runs
```

No test is running in a `describe` callback, a `beforeAll` or `afterAll`, at a
file's top level, or in work that outlives its test, such as a timer that fires
after it settled. A call there throws:

```text
Error: variance-authority: variancePrecondition at test/misplaced.test.ts:5 ran outside a running case — a precondition belongs to the case it arranged, so say it in the case body or in a beforeEach
```

Under Playwright, a call at the top level or in a `describe` callback of the
first file a worker loads records nothing and does not throw.

State set up once for a whole file is still a state each test ran under, so
record it from a top-level `beforeEach`.

### Contradictions

When one name gets two different values at the same level, as in

```ts
setDiscountFlag(false);
setDiscountFlag(true);
```

in one test body, both values are kept rather than one picked. The answer
prints `discount contradicted:` and both values, each with its site. A retry
that records a different value from an earlier attempt is the same
contradiction. A `--where` naming either value keeps the test.

### An omitted name on an axis

The recording holds only what was recorded. For a name declared as an axis,
`variance covering` reads a test that recorded nothing for it at the axis's
base: with `discount` declared as `["off", "on"]`, a test that never called
`setDiscountFlag` is read as `discount=off`, and `--where discount=off` keeps
it. This reading comes from your configuration, not from anything observed
while the test ran.

### Several axes

With several axes declared, a test's twin differs from it on one axis only:
the last axis, in the order you declare them, on which the test is away from
the base. On that axis the twin is at the nearest value below its own at
which a test in the file covered the code: on an axis `["off", "half", "on"]`,
a test at `on` is twinned with one at `half` when one exists, and with one at
`off` otherwise. When no test qualifies, the answer prints
`no twin recorded at` the base. Every other precondition, on an axis or not,
has to match exactly, as
[variations](variations.md#tell-it-what-the-words-mean) reads a subject's name.

A value the axis does not list, such as `discount=half`, gives the test no twin
on that axis. Under `--where`, it is printed under `Kept` with its site, and the
test is kept:

```text
  discount=half (test/flags.ts:6) is not one of off, on
```

When several tests qualify as a twin, they print with their count.

### JSON

Under `--format json`, each test has `preconditions: [{name, value, site,
level}]`, where `level` is `0` for the file's top-level `beforeEach`, one more
for each nested `describe`, and highest for the test body. The answer has
`where: {asked, kept, of, unmeasured, outside}`, where `outside` lists the
values recorded off a declared axis, and `twins: [{case, axis, from, to,
twins}]`, where an empty `twins` is `no twin recorded`.

### An unmeasured record

A row with `preconditions: []` was recorded by a runner that records
preconditions, and the test recorded none. A row with no `preconditions` field
was recorded by a runner that does not, and whether that test set any state is
unmeasured. Unmeasured is never read as none.

When no row in the record has the field, `--where` is refused with exit `2`
rather than answered with no test, and under `--format json` stdout is
`{"refused":"unmeasured"}`. Record the suite again to read the preconditions.
When only some rows lack it, the answer counts them apart, in a line under
`Kept`:

```text
3 cases were recorded without preconditions, so whether they ran under any of that is unmeasured.
```

### Not the file-level `preconditions` option

A case precondition is a state and never selects a test. The integration's
file-level `preconditions` option, described in [distance](distance.md), names
a file a test reads, so that editing the file selects the test.
