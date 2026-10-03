# Record the state each test ran under

[Test-level coverage](test-level-coverage.md) tells you which tests ran a piece
of code. A **case precondition** records the state each of those tests ran it
under: a feature flag, what a mock returns, which user a fixture signs in. You
say it once, in the test helper that arranges the state, and `variance covering`
prints it beside each test that ran the code. It is only read: a case
precondition never selects or skips a test, unlike the file-level
`preconditions` option in [distance](distance.md), which does. It is recorded in the same run as test-level coverage,
under Vitest, Jest, Rstest or Playwright, so your suite needs that recording
first.

## The state coverage does not see

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

The module the call comes from has no dependencies, and the call does nothing
outside a recorded run, so a helper your tests share keeps it everywhere. Tests call the helper as they did before:

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

Record the suite, and `variance covering` answers which tests ran `total`, and
in which state:

```bash
variance covering --file src/checkout/total.ts --function total
```

```text
2 named tests covered function total of src/checkout/total.ts:
  test/total.test.ts — 2/2
    charges the regular price — discount=off (test/flags.ts:6)
    applies the discount — discount=on (test/flags.ts:6)
```

`covering` calls each test a case, as the runners do: one `it` or `test`, by
its file and its `describe` path. Each value comes with the `file:line` of the
call that recorded it. Here that is the line in the helper, so every test that
uses `setDiscountFlag` points back to one place.

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
    charges the regular price — discount=off (test/flags.ts:6), prices=full (test/prices.ts:12)
    applies the discount — discount=on (test/flags.ts:6), prices=full (test/prices.ts:12)
    sale prices > charges the sale price — discount=off (test/flags.ts:6), prices=discounted (test/prices.ts:12)
    sale prices > applies the discount — discount=on (test/flags.ts:6), prices=discounted (test/prices.ts:12)
```

The test does not need a second description of what its helpers already did.

## Find coverage for a particular scenario

`--where` keeps only the covering tests that ran under a precondition:

```bash
variance covering --file src/checkout/total.ts --function total --where prices=discounted
```

```text
Kept the 2 of 4 cases that covered function total of src/checkout/total.ts and said prices=discounted.
2 named tests covered function total of src/checkout/total.ts:
  test/total.test.ts — 2/4
    sale prices > charges the sale price — discount=off (test/flags.ts:6), prices=discounted (test/prices.ts:12)
    sale prices > applies the discount — discount=on (test/flags.ts:6), prices=discounted (test/prices.ts:12)
```

That is the question to ask before you change how sale prices are charged: not
whether any test runs `total`, but which tests run it with the prices you are
about to change.

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
with `discount` at the base and every other precondition the same.

```text
4 named tests covered function total of src/checkout/total.ts:
  test/total.test.ts — 4/4
    charges the regular price — discount=off (test/flags.ts:6), prices=full (test/prices.ts:12)
    applies the discount — discount=on (test/flags.ts:6), prices=full (test/prices.ts:12)
      twin at discount=off: charges the regular price
    sale prices > charges the sale price — discount=off (test/flags.ts:6), prices=discounted (test/prices.ts:12)
    sale prices > applies the discount — discount=on (test/flags.ts:6), prices=discounted (test/prices.ts:12)
      twin at discount=off: sale prices > charges the sale price
```

`applies the discount` is twinned with `charges the regular price`, not with
`sale prices > charges the sale price`, because `prices` differs. That puts a
question in front of you while you read coverage: *this code ran with the
discount on; did a test also run it with the discount off, everything else
equal?*

When no such test exists, the answer says so:

```text
    applies the discount — discount=on (test/flags.ts:6), prices=full (test/prices.ts:12)
      no twin recorded at discount=off
```

Twins are looked for in the same test file only, so `no twin recorded` is a
question for you, not proof that no test anywhere runs this code with the
discount off.

## Where to go next

- The `variance-authority` skill shipped with the CLI answers how to run all of
  this, for you or a coding agent: every form of `--where`, contradictions,
  several axes, the JSON answer and a record made without preconditions.
- What `variancePrecondition` accepts, and where a call counts, is in
  [`@variance-authority/sense`](../packages/sense/README.md#name-what-a-case-arranged).
- How the coverage itself is recorded is
  [test-level coverage](test-level-coverage.md).

