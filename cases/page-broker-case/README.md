# A page broker, alive against a shop

A spike, not a package. It asks whether a test can stand on a small model of
the app — fragments, the actions they offer, and where each action leads —
instead of on selectors and waits.

- A **fragment** is a stable state: a probe that says it shows, actions that
  stay by default, reads, parts it `uses`.
- `leads({ payment: Payment, signIn: over(SignIn), invalid: stay })` names the
  outcomes; the broker senses which one the app reached. `.to('payment')`
  insists on one and fails with the branch actually taken.
- A **handle** is linear: departing revokes it, a cover (`over`) leaves it
  readable but refuses its actions, and `back` hands the same handle back.
- Every step lands in a per-test **journal**; `fork(a, b)` prints where two
  walks part.
- Between steps the broker **settles** on `aria-busy`, requests in flight and
  announced `@variance-authority/event` work. `BROKER_DROP=busy,network,events`
  drops signals to see which one each case rests on.

`src/spec/naive.spec.ts` holds the same scenarios in raw Playwright, passing
for the wrong reason.

## Run it

From the repository root, after `yarn install && yarn build`:

```bash
cd cases/page-broker-case && node ../../node_modules/@playwright/test/cli.js test --config=src/playwright.config.mjs
```
