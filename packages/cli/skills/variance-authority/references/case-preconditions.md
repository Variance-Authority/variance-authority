# The state each covering test ran under

Coverage records which test ran the code; a case precondition records the
state it ran under: a flag, what a mock returns, which user a fixture signs in.
A test that calls `variancePrecondition(dimension, record)` from
`@variance-authority/sense/precondition` has that state recorded on its row:
each key as `dimension:key`, its value (anything JSON can hold) and the
`file:line` of the call. A **breadcrumb** is the other side: code under test
that calls `varianceBreadcrumb(dimension, key, value)` from
`@variance-authority/event` has the value it read recorded on the case that ran
it. `variance covering` prints both beside every case it lists, `--where` keeps
the cases by what they said and `--read` by what the code read. Neither ever
selects or excludes a test. The public page is
[case preconditions](https://variance-authority.dev/docs/case-preconditions).

## Which tests ran this function with discounted prices

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

`Kept the 2 of 4` is out of the cases that covered the function before
`--where`, within the `--cases` scope when one is given. Repeat `--where` and
a case is kept only when it recorded all of them. `--where mocks` keeps any key
of the dimension; a bare `--where mocks:seeded-cart` keeps every value, so it
also keeps a case that recorded `false`; `--where mocks:seeded-cart=true` keeps
only `true`. A `true` value prints as the bare name.

## Did the code read the flag the test says it set

```bash
variance covering --file src/checkout/total.ts --function total
```

```text
    applies the discount — read flags:discount=true said true, mocks:prices=full (test/prices.ts:12)
    stale mock — read flags:discount=false said true, mocks:prices=full (test/prices.ts:12)
```

`read K=V said W` pairs what the code read under a name with what the case
said under it; `said nothing` means the case never said that name. A name the
case said in a dimension the code read, and that the code never read, is
dropped; a dimension the code never read prints as the case said it, with its
site. A read and a said value that differ are the finding: the test's claim
did not reach the code. Do not "fix" the read to match the claim.

```bash
variance covering --file src/checkout/total.ts --function total --read flags:discount=true
```

`--read` takes the forms `--where` takes and filters by reads only;
`--where flags:discount=true --read flags:discount=false` keeps exactly the
mismatches. A read is laid on the case running it, and a read made while the
test file loads on every case of the file. Vitest, Jest and Rstest in Node record reads,
and Playwright in the worker and in a page that carries the execution collector,
where a read made while a file loads is laid on no case; elsewhere the answer
prints nothing about them.

`variance review` splits each changed region's cases by what they read:
`flags:express read false by 1, true by 1, not by 6` — `not` counts the cases
that entered the region and never read the key, `unmeasured for N` the cases
from a recording that did not listen. A misused breadcrumb follows the split as
`misused varianceBreadcrumb at src/flags.ts:7 by 1: the key 7 is not a string`.
The handover's `reached by` carries the same split.

## What state did the tests covering this function run under

Each value is the one the case ran under: the case body overrides a
`beforeEach`, an inner `describe`'s overrides an outer one's. The site is the
call that won, which is the line in the helper when a helper recorded it.
`flags:discount contradicted: false (…), true (…)` means two values were
recorded at one level; both are kept, and a `--where` naming either keeps the
case. Do not pick one. Under `--format json`, `covering` gives each test the
recorded `said` text and the answer `where: {asked, read, kept, of,
unmeasured}`; `review` gives each case `preconditions` and `reads`, each
`[{name, value, site, level}]`, and
`misused: [{argument, value, site, level}]` — the argument that was wrong,
`dimension` or `key`, and what it was given, an array or an object by its kind
alone — empty where none was misused; `reads` and `misused` are absent where
the run did not listen.

## Record the state this test runs under

```ts
// test/flags.ts
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { flags } from '../src/flags.js';

export function setDiscountFlag(enabled: boolean): void {
  flags.discount = enabled;
  variancePrecondition('flags', { discount: enabled });
}

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

// src/flags.ts — the code under test
import { varianceBreadcrumb } from '@variance-authority/event';

export function isOn(key: string): boolean {
  return varianceBreadcrumb('flags', key, flags[key] === true);
}
```

- Put the call in the helper that changes the state, so changing it records it.
  Do not write a second `variancePrecondition` beside a helper call. The site on
  the row is the line in the helper.
- Name the precondition with the dimension and key the code reads it under, so
  `read flags:discount` pairs with `said`.
- The helper runs in the case body or a `beforeEach`. A file-wide state goes in
  a top-level `beforeEach`.
- In a `beforeAll` or `afterAll` the call throws (`ran in a beforeAll, which
  runs for no one case`); in a `describe` callback or at the file's top level it
  throws `ran outside a running case`. Either fails the test file. Under
  Playwright, a call at the top level or in a `describe` callback of the first
  file a worker loads records nothing and does not throw.
- In an `afterEach` it warns and records nothing.
- A dimension holding `:` throws. A call without a dimension and a record
  records nothing, with a warning. A value JSON cannot hold keeps its name and
  prints as `unrecorded`.
- `varianceBreadcrumb` returns its value, never throws, and does nothing
  without a recording; it ships in product source. A read where no case runs
  warns once per site and is recorded nowhere. A dimension or key that is not
  a non-empty string, or a dimension holding `:`, is a misuse: `covering` prints
  `misused varianceBreadcrumb at <site>: the key 7 is not a string` after the
  reads, once per argument and value given, at its first site, and `review
  --format json` gives the case `misused: [{argument, value, site, level}]`. It
  is never a read, so `--read` and the split never
  count it. Fix the call.
- Both only take effect in a recorded run: a record made before the call was
  added holds none of it.

## The answer keeps none, unmeasured — what now

```text
Kept none of the 6 cases that covered line 2 of src/cart.ts: none of them was recorded with preconditions.
6 cases were recorded without preconditions, so whether they ran under any of that is unmeasured.
```

`where.unmeasured` equals `where.of` under `--format json`. No case in the
record was recorded with preconditions (or, for `--read`, with reads): it was
recorded by a runner that does not listen to them. Do not read it as *no test
ran with discounted prices*. Asking again changes nothing; only a record made
with that recording answers it.

`N cases were recorded without preconditions, so whether they ran under any of
that is unmeasured.` under `Kept` is the partial form: the kept list is right
for the cases that were recorded with preconditions, and is no evidence about
those N.
