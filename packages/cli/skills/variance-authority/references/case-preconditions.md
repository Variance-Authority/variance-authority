# The state each covering test ran under

Coverage tells you which test ran the code; a case precondition records the
state it ran under: a flag, what a mock returns, which user a fixture signs in.
A test that calls `variancePrecondition` from
`@variance-authority/sense/precondition` has that state recorded on its row: a
name, a value (string, finite number or boolean) and the `file:line` of the
call. `variance covering` prints it beside every case it lists, and `--where`
keeps the cases that recorded it. A precondition never selects or excludes a
test. The public page is
[case preconditions](https://variance-authority.dev/docs/case-preconditions).

## Which tests ran this function with discounted prices

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

`Kept the 2 of 4` is out of the cases that covered the function before
`--where`, within the `--cases` scope when one is given. Repeat `--where` and
a case is kept only when it recorded all of them. `--where prices` keeps every
value. Values compare as text, so `--where seeded-cart` and
`--where seeded-cart=true` are the same question. On a declared axis, a case
that recorded nothing for it is read at the axis's base, and `--where` matches
it there.

## What state did the tests covering this function run under

```bash
variance covering --file src/checkout/total.ts --function total
```

```text
    charges the regular price — discount=off (test/flags.ts:6), prices=full (test/prices.ts:12)
    sale prices > charges the sale price — discount=off (test/flags.ts:6), prices=discounted (test/prices.ts:12)
```

Each value is the one the case ran under: the case body overrides a
`beforeEach`, an inner `describe`'s overrides an outer one's. The site is the
call that won, which is the line in the helper when a helper recorded it.
`discount contradicted: off (…), on (…)` means two values were recorded at one
level; both are kept, and a `--where` naming either keeps the case. Do not
pick one. Under `--format json` each test has
`preconditions: [{name, value, site, level}]`.

## Find the discount=off twin of this case

The axis must be declared in the root `variance.config.json`, base first:

```json
{ "names": { "axes": [{ "axis": "discount", "values": ["off", "on"] }] } }
```

Then ask about the code, with or without `--where`:

```bash
variance covering --file src/checkout/total.ts --function total --where discount=on
```

```text
    applies the discount — discount=on (test/flags.ts:6), prices=full (test/prices.ts:12)
      twin at discount=off: charges the regular price
```

- A twin is the test in the same file that covered the same code with the axis
  at its base and every other precondition the same (`prices=full` must match
  too), among the cases that covered it before `--where`, within the `--cases`
  scope.
- With several axes, the twin differs on one only: the last declared axis the
  case is away from its base on, at the nearest value toward the base.
- Twins print whenever `names.axes` is declared, with or without `--where`, in
  every answer: line, function, whole file, `--since`.
- A case that recorded nothing for `discount` is read as `discount=off`. That
  reading comes from the configuration, not from the run; do not report it as
  observed.
- `2 twins at …` names several. `no twin recorded at discount=off` means no case
  in this test file covered this code at `off`, recorded or read at the base,
  with everything else the same. The twin may be in another test file, which is
  not searched, or the code may not run at `off` at all. Check other files
  before writing a test.
- Under `--format json` twins are `twins: [{case, axis, from, to, twins}]`; an
  empty `twins` is `no twin recorded`.
- `discount=half (test/flags.ts:6) is not one of off, on` under the `Kept` line
  is a value outside the axis. The case is kept and has no twin on that axis.

## Record the state this test runs under

```ts
// test/flags.ts
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { flags } from '../src/flags.js';

export function setDiscountFlag(enabled: boolean): void {
  flags.discount = enabled;
  variancePrecondition({ discount: enabled ? 'on' : 'off' });
}

// test/prices.ts
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { vi } from 'vitest';
import { fetchPrices } from '../src/checkout/prices.js';

const TABLES = { full: { apple: 2, pear: 3 }, discounted: { apple: 1, pear: 2 } };

export function pricesReturn(table: keyof typeof TABLES): void {
  vi.mocked(fetchPrices).mockResolvedValue(TABLES[table]);
  variancePrecondition({ prices: table });
}

// test/total.test.ts
vi.mock('../src/checkout/prices.js');

beforeEach(() => {
  setDiscountFlag(false);
  pricesReturn('full');
});

it('applies the discount', async () => {
  setDiscountFlag(true);
  expect(await total(['apple', 'pear'])).toBe(4.5);
});
```

- Put the call in the helper that changes the state, so changing it records it.
  Do not write a second `variancePrecondition` beside a helper call. The site on
  the row is the line in the helper.
- The helper runs in the case body or a `beforeEach`. A file-wide state goes in
  a top-level `beforeEach`.
- In a `beforeAll` or `afterAll` the call throws (`ran in a beforeAll, which
  runs for no one case`); in a `describe` callback or at the file's top level it
  throws `ran outside a running case`. Either fails the test file. Under
  Playwright, a call at the top level or in a `describe` callback of the first
  file a worker loads records nothing and does not throw.
- In an `afterEach` it warns and records nothing.
- One value that is not a string, finite number or boolean drops the whole
  record, with a warning.
- It only takes effect in a recorded run; record the suite again before asking.

## The answer says unmeasured — what now

```text
`--where prices=discounted` is unmeasured here: the record holds no case's preconditions. …
```

Exit `2`, `{"refused":"unmeasured"}` under `--format json`. No row in the
record has a `preconditions` field: it was recorded by a runner without the
precondition recording. Do not read it as *no test ran with discounted prices*.
Record the suite again; asking again changes nothing.

`N cases were not listened to, so whether they said any of that is unmeasured.`
under `Kept` is the partial form: the kept list is right for the cases that
were recorded with preconditions, and tells you nothing about those N.
