# What the covering cases arranged

A case that calls `variancePrecondition` from
`@variance-authority/sense/precondition` carries the state it arranged on its
row: a name, a value (string, finite number or boolean; `true` when omitted)
and the `file:line` of the call. `variance covering` prints it beside every
case a file, line or function answer lists, and `--where` keeps the cases that
said it. A precondition never selects or excludes a test; it is read, never
diffed. The public page is
[case preconditions](https://variance-authority.dev/docs/case-preconditions).

## Which tests ran this function with the network mocked

```bash
variance covering --file src/checkout/total.ts --function applyDiscount --where network=mocked
```

```text
Kept the 4 of 7 cases that said network=mocked.
  flag=ff-half (test/refund.test.ts:11) is not one of ff-off, ff-on
3 named tests covered function applyDiscount of src/checkout/total.ts:
  test/total.test.ts — 2/4
    offline > discounts behind the flag — flag=ff-on (test/total.test.ts:19), network=mocked (test/total.test.ts:11)
      twin at flag=ff-off: offline > discounts without the flag
    offline > discounts without the flag — network=mocked (test/total.test.ts:11)
  test/refund.test.ts — 1/3
    half rollout > discounts at half — flag=ff-half (test/refund.test.ts:11), network=mocked (test/refund.test.ts:11)
```

`Kept the 4 of 7` counts every case in the record, or in the `--cases` scope
when one is given; the answer below it is the kept cases that covered the
function. Repeat `--where` and every one must hold. `--where network` keeps
every value. Values compare as text, so `--where seeded-cart` and
`--where seeded-cart=true` are the same question.

## What did the tests covering this line arrange

```bash
variance covering --file src/checkout/total.ts --line 2
```

```text
    offline > discounts behind the flag — flag=ff-on (test/total.test.ts:19), network=mocked (test/total.test.ts:11)
    pays against the live service — network=live (test/total.test.ts:6)
```

Each value is the one the case ran under: the case body overrides a
`beforeEach`, an inner `describe`'s overrides an outer one's. The site is the
call that won. `flag contradicted: ff-off (…:19), ff-on (…:18)` means two values
were said at one level; both are kept, and a `--where` naming either keeps the
case. Do not pick one. Under `--format json` each test has
`preconditions: [{name, value, site, level}]`.

## Find the ff-off twin of this case

The axis must be declared in the root `variance.config.json`, base first:

```json
{ "names": { "axes": [{ "axis": "flag", "values": ["ff-off", "ff-on"] }] } }
```

Then ask at the case's value, with `--line` or `--function`:

```bash
variance covering --file src/checkout/total.ts --function applyDiscount --where flag=ff-on
```

```text
    offline > discounts behind the flag — flag=ff-on (test/total.test.ts:19), network=mocked (test/total.test.ts:11)
      twin at flag=ff-off: offline > discounts without the flag
```

- A twin is one step toward the base on the case's last declared axis, saying
  everything else the same (`network=mocked` must match too), among the cases
  that covered the same line or function before `--where` narrowed them.
- A case that never said `flag` stands at `ff-off`.
- `2 twins at …` names several; `no twin recorded at flag=ff-off` means no case
  covering this code ran it with the flag off. That is a missing test, not a
  missing record.
- Twins print only under `--where`, and only for `--line` or `--function`.
  Under `--format json` they are `twins: [{case, axis, from, to, twins}]`.
- `flag=ff-half (…) is not one of ff-off, ff-on` under the `Kept` line is a
  value outside the axis. The case is kept and has no twin on that axis.

## Declare what this test arranged

```ts
import { variancePrecondition } from '@variance-authority/sense/precondition';

beforeEach(() => {
  variancePrecondition('network', 'mocked');
});

it('discounts behind the flag', () => {
  variancePrecondition('flag', 'ff-on');
});
```

- Say it beside the arrangement: in the case body or a `beforeEach`. A
  file-wide state goes in a top-level `beforeEach`.
- In a `describe` callback, `beforeAll`, `afterAll` or at the file's top level
  the call throws and the test file fails (`ran outside a running case`).
- In an `afterEach` it warns and records nothing.
- It only takes effect in a recorded run; record the suite again before asking.

## The answer says unmeasured — what now

```text
`--where network=mocked` is unmeasured here: the record holds no case's preconditions. …
```

Exit `2`, `{"refused":"unmeasured"}` under `--format json`. No case in the
record was listened to: it predates the calls or came from a runner that did
not listen. Do not read it as *no case had the network mocked*. Record the
suite again; asking again changes nothing.

`N cases were not listened to, so whether they said any of that is unmeasured.`
under `Kept` is the partial form: the kept list is right for the cases that
were listened to, and says nothing about those N.
