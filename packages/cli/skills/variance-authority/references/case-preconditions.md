# What the covering cases arranged

A case that calls `variancePrecondition` from
`@variance-authority/sense/precondition` has the state it arranged recorded on
its row: a name, a value (string, finite number or boolean) and the `file:line`
of the call. `variance covering` prints it beside every case it lists, and
`--where` keeps the cases that said it. A precondition never selects or
excludes a test. The public page is
[case preconditions](https://variance-authority.dev/docs/case-preconditions).

## Which tests ran this function with sale prices

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

`Kept the 4 of 6` is out of the cases that covered the function before
`--where`, within the `--cases` scope when one is given. Repeat `--where` and
a case is kept only when it said all of them. `--where prices` keeps every value. Values compare as
text, so `--where seeded-cart` and `--where seeded-cart=true` are the same
question.

## What did the tests covering this function arrange

```bash
variance covering --file src/checkout/total.ts --function total
```

```text
    charges the full price — flag=ff-off (test/flags.ts:6), prices=full (test/prices.ts:12)
    on sale > charges the sale price — flag=ff-off (test/flags.ts:6), prices=discounted (test/prices.ts:12)
```

Each value is the one the case ran under: the case body overrides a
`beforeEach`, an inner `describe`'s overrides an outer one's. The site is the
call that won, which is the line in the helper when a helper said it.
`flag contradicted: ff-off (…), ff-on (…)` means two values were said at one
level; both are kept, and a `--where` naming either keeps the case. Do not
pick one. Under `--format json` each test has
`preconditions: [{name, value, site, level}]`.

## Find the ff-off twin of this case

The axis must be declared in the root `variance.config.json`, base first:

```json
{ "names": { "axes": [{ "axis": "flag", "values": ["ff-off", "ff-on"] }] } }
```

Then ask about the code, with or without `--where`:

```bash
variance covering --file src/checkout/total.ts --function total --where flag=ff-on
```

```text
    discounts the full price behind the flag — flag=ff-on (test/flags.ts:6), prices=full (test/prices.ts:12)
      twin at flag=ff-off: charges the full price
```

- A twin is the case with the nearest value toward the base on the last
  declared axis the case is off its base on, with everything else the same (`prices=full` must
  match too), among the cases of the same test file that covered the same code
  before `--where`, within the `--cases` scope.
- Twins print whenever `names.axes` is declared, with or without `--where`, in
  every answer: line, function, whole file, `--since`.
- A case that never said `flag` ran at the base value, `ff-off`.
- `2 twins at …` names several. `no twin recorded at flag=ff-off` means no case
  in this test file ran this code at `ff-off` with everything else the same.
  The twin may be in another test file, which is not searched, or the code may
  not run at `ff-off` at all. Check other files before writing a test.
- Under `--format json` twins are `twins: [{case, axis, from, to, twins}]`; an
  empty `twins` is `no twin recorded`.
- `flag=ff-half (…) is not one of ff-off, ff-on` under the `Kept` line is a
  value outside the axis. The case is kept and has no twin on that axis.

## Declare what this test arranged

```ts
// test/flags.ts
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { type Flag, flags } from '../src/flags.js'; // Flag = 'ff-off' | 'ff-on' | 'ff-half'

export function setFlag(flag: Flag): void {
  flags.discount = flag;
  variancePrecondition({ flag });
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

// test/refund.test.ts
import { beforeEach, expect, it, vi } from 'vitest';
import { refund } from '../src/checkout/refund.js';
import { setFlag } from './flags.js';
import { pricesReturn } from './prices.js';

vi.mock('../src/checkout/prices.js');

beforeEach(() => {
  pricesReturn('discounted');
});

it('refunds at the half rollout', async () => {
  setFlag('ff-half');
  expect(await refund(['apple', 'pear'])).toBe(-2.85);
});
```

- Put the call in the helper that arranges the state, so arranging it says it.
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
precondition recording. Do not read it as *no case had sale prices*. Record the suite again;
asking again changes nothing.

`N cases were not listened to, so whether they said any of that is unmeasured.`
under `Kept` is the partial form: the kept list is right for the cases that
were recorded with preconditions, and says nothing about those N.
