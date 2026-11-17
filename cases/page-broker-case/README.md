# A page broker, alive against a shop

A spike, not a package. It asks whether a test can stand on a small model of
the app — fragments, the actions they offer, and where each action leads —
instead of on selectors and waits.

- A **fragment** is a stable state: a probe that says it shows, actions that
  stay by default, reads, parts it `uses`. Parts agree with the whole: a
  fragment whose part, however deep, does not show is neither entered nor
  arrived at, and one that stays with a part gone departs.
- `leads({ payment: Payment, signIn: over(SignIn), invalid: stay })` names the
  outcomes; the broker senses which one the app reached. `.to('payment')`
  insists on one and fails with the branch actually taken.
- A **handle** is linear: departing revokes it, a cover (`over`) leaves every
  handle on the page readable but refuses their actions, those entered beneath
  it after it opened included, and `back` uncovers
  exactly what that cover covered and hands the owner's handle back. What is
  entered using an open cover lives and leaves with it, with every part only
  it holds; a part another owner holds stays, and answers to that owner alone.
  Sharing a part with an open cover is not using the cover: the part waits
  beneath with the page, whichever owner came first.
- Every step lands in a per-test **journal**; `fork(a, b)` prints where two
  walks part, edge by edge, outcome included.
- Between steps the broker **settles** on `aria-busy`, requests in flight and
  announced `@variance-authority/event` work. `BROKER_DROP=busy,network,events`
  drops signals to see which one each case rests on.

Four rules keep the model honest, each pinned in `src/spec/`:

1. **An arrival is witnessed from both ends.** A leaving outcome needs its
   owner gone, `over` needs the owner still showing, and `back` needs the
   cover itself gone, not only what uses it; a cover is what the action
   opened, so one already entered, or showing before it, does not arrive. An outcome that shows beside its owner without `over` is an
   error that names the fix.
2. **An arrival is unambiguous.** Two declared outcomes showing at once fail;
   the order of the declaration never decides. Ambiguity a declaration holds
   already is refused where it is written: two outcomes of one action that
   land alike, or two fragments under one name.
3. **A fragment has one lifecycle, however it is reached.** Entering it again
   returns its one handle, covered or live, and a part is one handle however
   many owners use it, answering to all of them whichever came first, and to
   every owner between it and them, however deep; a part
   that stays, plainly or by a lead, needs every owner showing, and one gone
   is the page left; and a navigation the broker did not take departs every
   handle on the old document, with a request or without one, as to
   `about:blank`, where a history push or a hash change keeps
   the document and its handles.
4. **The declared edges are the app's test interface.** `edges(roots)` lists
   them, `walked(edges, journals)` counts which the tests took, and the
   `edges-reporter` prints both after a run, unwalked edges at zero.

`src/spec/naive.spec.ts` holds the same scenarios in raw Playwright, passing
for the wrong reason.

## Run it

From the repository root, after `yarn install && yarn build`:

```bash
cd cases/page-broker-case && node ../../node_modules/@playwright/test/cli.js test --config=src/playwright.config.mjs
```
