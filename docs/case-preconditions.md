# Record the state each test ran under

[Test-level coverage](test-level-coverage.md) tells you which tests ran a piece
of code. A **case precondition** records the state each of those tests ran it
under: a feature flag, what a mock returns, which user a fixture signs in.
Coverage gives you the code path; case preconditions give that path its
scenario. A **breadcrumb** records the other side: the value the code under test
read, so you can check that the scenario a test claims is the one that ran.

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
  variancePrecondition('flags', { discount: enabled });
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
    applies the discount — flags:discount (test/flags.ts:6)
    charges the regular price — flags:discount=false (test/flags.ts:6)
```

`covering` calls each test a case, as the runners do: one `it` or `test`, by
its file and its `describe` path. The first argument is a dimension, a group of
names you choose, so `discount` is recorded as `flags:discount`. A value `true`
prints as the bare name, so `flags:discount` means the discount was on. Each value
carries the `file:line` of the call that recorded it. Here that is the line in
the helper, so every test that uses `setDiscountFlag` points back to one place.

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
  variancePrecondition('mocks', { prices: table });
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
    applies the discount — flags:discount (test/flags.ts:6), mocks:prices=full (test/prices.ts:12)
    charges the regular price — flags:discount=false (test/flags.ts:6), mocks:prices=full (test/prices.ts:12)
    sale prices > applies the discount — flags:discount (test/flags.ts:6), mocks:prices=discounted (test/prices.ts:12)
    sale prices > charges the sale price — flags:discount=false (test/flags.ts:6), mocks:prices=discounted (test/prices.ts:12)
```

The test does not need a second description of what its helpers already did.

## Find coverage for a particular scenario

`--where` keeps only the covering tests that ran under a precondition:

```bash
variance covering --file src/checkout/total.ts --function total --where mocks:prices=discounted
```

```text
Kept the 2 of 4 cases that covered function total of src/checkout/total.ts and recorded mocks:prices=discounted.
2 named tests covered function total of src/checkout/total.ts:
  test/total.test.ts — 2/4
    sale prices > applies the discount — flags:discount (test/flags.ts:6), mocks:prices=discounted (test/prices.ts:12)
    sale prices > charges the sale price — flags:discount=false (test/flags.ts:6), mocks:prices=discounted (test/prices.ts:12)
```

- `--where mocks:prices` keeps every test that recorded `mocks:prices`, whatever
  its value.
- `--where mocks` keeps every test that recorded any name in `mocks`.
- `--where mocks:prices=discounted` keeps one value.
- Repeat `--where` to require several:
  `--where mocks:prices=discounted --where flags:discount=true`.

`--where` works with `--line`, `--function`, a whole file and `--since`, and in
every format. The count in `Kept` is out of the tests that covered what you
asked, before `--where`, and within the
[`--cases`](../packages/cli/README.md#reading-the-test-you-are-writing) scope
when you give one. When `--where` keeps none, `covering` prints that and counts
them:

```text
Kept none of the 4 cases that covered function total of src/checkout/total.ts: none recorded mocks:prices=sale.
```

## Check what the code read

A test says what it arranged, and that is a claim. When a mock does not reach
the provider the code reads from, the test says one thing and the code runs
another. `varianceBreadcrumb` records what the code read, in the source, where
it reads. Vitest, Jest and Rstest record reads in Node, and Playwright records
them in the worker and in the page the case drives, when the page carries the
execution collector. A case that drove a page without it has no read facet,
rather than an empty one, unless the worker read something.

```ts
// src/flags.ts
import { varianceBreadcrumb } from '@variance-authority/event';

export const flags: Record<string, boolean> = { discount: false };

export function isOn(key: string): boolean {
  return varianceBreadcrumb('flags', key, flags[key] === true);
}
```

It returns the value it is given, so it wraps the read in place. Each case now
pairs what the code read with what the test said under the same name:

```text
4 named tests covered function total of src/checkout/total.ts:
  test/total.test.ts — 4/4
    applies the discount — read flags:discount=true said true, mocks:prices=full (test/prices.ts:12)
    charges the regular price — read flags:discount=false said false, mocks:prices=full (test/prices.ts:12)
    sale prices > applies the discount — read flags:discount=true said true, mocks:prices=discounted (test/prices.ts:12)
    sale prices > charges the sale price — read flags:discount=false said false, mocks:prices=discounted (test/prices.ts:12)
```

A name in a dimension the code read prints once, as the read with what the test
said beside it, both values in full: `read flags:discount=true said true`. `mocks` was never read, so it prints as the test said it. A
test that says the discount is on without setting the flag shows the gap:

```text
    applies the discount — read flags:discount=false said true, mocks:prices=full (test/prices.ts:12)
```

`--read` keeps the cases by what the code read, as `--where` keeps them by what
the test said, and takes the same forms:

```bash
variance covering --file src/checkout/total.ts --function total --read flags:discount=true
```

```text
Kept the 2 of 4 cases that covered function total of src/checkout/total.ts and read flags:discount=true.
2 named tests covered function total of src/checkout/total.ts:
  test/total.test.ts — 2/4
    applies the discount — read flags:discount=true said true, mocks:prices=full (test/prices.ts:12)
    sale prices > applies the discount — read flags:discount=true said true, mocks:prices=discounted (test/prices.ts:12)
```

The two never stand in for each other: `--where flags:discount=true` keeps what
the test said, `--read flags:discount=true` keeps what the code read, and both
together keep the cases where both hold. So the cases whose claim never reached
the code are one question:

```bash
variance covering --file src/checkout/total.ts --function total --where flags:discount=true --read flags:discount=false
```

## Reference

### What `variancePrecondition` takes

```ts
import { variancePrecondition } from '@variance-authority/sense/precondition';

variancePrecondition('mocks', { prices: 'discounted', 'seeded-cart': true });
```

The call takes a dimension and a record of keys to values, and records each
key as `dimension:key`. The dimension is any string without `:`, declared
nowhere. A value is anything JSON can hold, and prints as itself when it is a
string and as its JSON otherwise. A value JSON cannot hold, such as a function
or `NaN`, keeps its name and prints its value as `unrecorded`. A call without a dimension
and a record records nothing, and the console names it:

```text
variance-authority: variancePrecondition at test/cleanup.test.ts:9 takes a dimension and a record of keys to values; nothing was recorded
```

A dimension holding `:` throws, since a name splits at its first `:`.

The entry point has no dependencies, and where a test is running it does not
change what the test does.
Without a recording the call does nothing, so a helper your tests share can
keep it. Vitest, Jest, Rstest and Playwright record it when the suite is
recorded with [test-level coverage](test-level-coverage.md).

A value `true` prints as the bare name, so `{ 'seeded-cart': true }` prints
`mocks:seeded-cart`. Values are compared as text, so
`--where mocks:seeded-cart=true` keeps the tests that recorded `true`. A bare
`--where mocks:seeded-cart` keeps every value, `false` included.

### What `varianceBreadcrumb` takes

```ts
import { varianceBreadcrumb } from '@variance-authority/event';

if (varianceBreadcrumb('flags', 'new-checkout', flags['new-checkout'])) {
  // …
}
```

The call takes a dimension, a key and the value the code read, and returns the
value unchanged. It names the read `dimension:key`, as `variancePrecondition`
names what a test said, and keeps each value a case read once, at the site it
was first read. It never throws and never changes what the code does: without a
recording it is one property read and a return, so it ships with your source.
Vitest, Jest and Rstest record it in Node when the suite is recorded with
[test-level coverage](test-level-coverage.md).

| Where the read runs | What is recorded |
|---|---|
| In a test, its hooks, or code they call | On that test |
| While the test file loads | On every test of the file, as if a top-level `beforeEach` read it |
| Where no test is running | Nothing, with one warning per site |
| Two values for one key in one test | Both, each as its own `read` |
| A dimension or key that is not a non-empty string, or a dimension holding `:` | A misuse on that test, once per argument and value given, at its first site, never a read |

`variance covering` prints a misuse after the reads, and `variance review` gives
the test `misused: [{argument, value, site, level}]` under `--format json`,
where `argument` is `dimension` or `key` and `value` is what it was given, an
array or an object by its kind alone:

```text
    applies the discount — read flags:discount=true said true, misused varianceBreadcrumb at src/flags.ts:7: the key 7 is not a string
```

A misuse never joins `--read` or the split `review` makes by what the code
read: `review` names it after that split, as `misused varianceBreadcrumb at
src/flags.ts:7 by 1: the key 7 is not a string`, with the number of tests that
met it.

A read never throws, unlike `variancePrecondition` where no test runs: it sits
in product code, which runs whether or not a test does.

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
prints `flags:discount contradicted:` and both values, each with its site. A retry
that records a different value from an earlier attempt is the same
contradiction. A `--where` naming either value keeps the test.

### JSON

Under `--format json`, `variance review` gives each case `preconditions` and
`reads`, each `[{name, value, site, level}]`, where `level` is `0` for the
file's top-level `beforeEach`, one more for each nested `describe`, and highest
for the test body, and `misused: [{argument, value, site, level}]`, empty where
no breadcrumb was misused. `reads` and `misused` are absent where the run did
not listen to reads. `variance covering` gives each test the recorded `said`
text, and its answer has `where: {asked, read, kept, of, unmeasured}`, with
`read` present only when you gave `--read`.

### An unmeasured record

A case recorded by a runner that records preconditions and that said nothing
has none. A case recorded by a runner that does not has no answer, and whether
that test set any state is unmeasured. Reads are kept the same way, but a case that
read nothing prints nothing about reads under either runner: in a codebase
that leaves no breadcrumb, that is every case. Unmeasured is never read as
none.

When no case was recorded with what you asked for, `--where` or `--read` keeps
none and says that none of them was recorded with preconditions or reads, never
that no test covered the line. Under `--format json`, `where.unmeasured` equals
`where.of`. When only some cases lack it, the answer counts them apart. Either
way the count is a line under `Kept`:

```text
3 cases were recorded without preconditions, so whether they ran under any of that is unmeasured.
```

### Not the file-level `preconditions` option

A case precondition is a state and never selects a test. The integration's
file-level `preconditions` option, described in [distance](distance.md), names
a file a test reads, so that editing the file selects the test.
