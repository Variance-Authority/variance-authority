<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/page-broker

> One broker per complex part of an app — a checkout form, a combobox, a dialog: how a test finds it, what it can do there, and where each action can lead, over a document or a browser.

Part of [Variance Authority](https://variance-authority.dev).
Point your coding agent at [`llms.txt`](https://variance-authority.dev/llms.txt).

## What this is for

Submitting a checkout form can reach the payment page, open a sign-in dialog,
or stay where it is with errors. A test asserts the one it expected, and when
the app opened the sign-in instead, it fails on a timeout naming what it waited
for, not where the app went. An outcome that is the absence of something — no
alert on the page — passes at once, before the answer has arrived.

With this package each complex part of the app gets a **broker**: the query a
person finds it by, and its actions, each with the outcomes it can lead to.
Performing an action returns the one the app reached:

```ts
const billing = await Billing.on(surface(page));
const { outcome } = await billing.submit(); // 'payment' | 'signIn' | 'invalid'
await billing.submit().to('payment'); // or fails: billing.submit: expected payment, reached signIn
```

A broker is the public interface a test drives, the controller that decides
where an action ended, and the spec of that part: what can be done in it and
where each action can go, readable without a page. A simple control needs none;
a broker is for a part with more than one way out.

The same declaration runs over a document — jsdom, happy-dom, a test runner's
browser mode — and over a Playwright page. Only the surface `on` differs.

It needs nothing from the app. No attribute, event or hook written for tests is
read: an outcome is another broker becoming visible, and staying is the page
going quiet with the broker still on it. It is a page object whose methods also
say which of their declared destinations the app took, not a framework: your runner,
`expect` and everything else stay yours. Of Variance Authority it needs only
`@variance-authority/core`, for which requests count as work.

## Requirements

Node 22 or newer and an ESM project. Over a document, `@testing-library/dom`
10.4 or newer and `@testing-library/user-event` 14.6 or newer; over a browser, `playwright-core` 1.55 or newer, which
`@playwright/test` already brings.

```bash
npm install --save-dev @variance-authority/page-broker
```

## Declare a broker and perform its actions

```ts
// checkout.broker.ts
import { broker, leads, stay } from '@variance-authority/page-broker';

export const Payment = broker('payment', { probe: { role: 'form', name: 'Payment' } });
export const SignIn = broker('signIn', { probe: { role: 'dialog', name: 'Sign in' } });

export const Billing = broker('billing', {
  probe: { role: 'form', name: 'Billing' },
  actions: {
    street: (on, words: string) => on.fill({ label: 'Street' }, words),
    submit: leads({ payment: Payment, signIn: SignIn, invalid: stay }, (on) =>
      on.click({ role: 'button', name: 'Continue' }),
    ),
  },
});
```

Over a document, in any runner with a DOM environment:

```ts
import { surface } from '@variance-authority/page-broker/dom';

const billing = await Billing.on(surface(document));
const payment = await billing.submit().to('payment');
```

Over a browser page:

```ts
import { surface } from '@variance-authority/page-broker/playwright';

await page.goto('/checkout');
const billing = await Billing.on(surface(page));
await billing.submit().to('invalid');
// No waiting: the answer has arrived by the time staying is reported.
expect(await page.getByRole('alert').count()).toBe(1);
```

`broker(name, { probe, actions })` takes:

- **`name`**, which every failure message starts with.
- **`probe`**, the query a person finds the part by: `{ role, name? }`,
  `{ text }`, `{ label }`, `{ testId }` or `{ css }`. A string matches whole
  and a pattern within.
- **`actions`**, its members by name. A plain function `(on, ...args) => …`
  acts or reads within the broker and decides nothing. `leads(outcomes, act)`
  declares one that can end somewhere else: its outcomes by name, each a broker
  the app arrives at or `stay`, and the act. Arguments after the surface are
  yours: `(on, words: string) => …` is called as `search('kiwi')`.

The surface `on` offers `click`, `fill`, `press`, `check` and `select` by
query, and `native` — the document or the Playwright page — for anything else.
An act is not scoped to the broker's root: a part's controls are not always
inside it.

`Billing.on(surface)` finds the broker, or fails with `billing: not on the
page`. What it returns has `root`, what the surface found — an element, or a
locator — and each member bound to the surface. A member declared with `leads`
returns a promise of `{ outcome, at }`: the name reached, and the broker the
test is now in, bound the same way — for `stay`, the one it started in. `.to(name)`
on that promise insists on one outcome and resolves to its broker.

The app has 5000 ms after the act to reach an outcome or go quiet, and is
quiet once nothing has been pending for 500 ms. Neither is yours to set.

`Billing.declared` is the broker as data — its name, its probe, and for each
action its outcomes by the name of the broker each leads to, or `stay` — for
whatever reads the brokers without running them.

## How an outcome is decided

Before the act, the broker must be visible, and none of the brokers it can
lead to may be: one already on the page could not be arrived at, since its
being there would read as the answer. Either refusal is an `Unreached` whose
reason is `start`, and the act does not run. Declare a part that stays on the
page through the action — a liked product, a form showing its errors — as
`stay`.

After the act, whichever comes first — a declared broker becoming visible, or
the page going quiet — every outcome is looked at once.

- **One is visible**: that is the outcome.
- **Two are visible at once**: the action fails, naming both. The order you
  wrote them in never decides.
- **None, quiet, and the broker is still on the page**: the action stays, once
  the act has finished and nothing has been pending for the quiet period. Work
  that starts within it begins the wait again, so a slow answer that leads
  somewhere is not mistaken for staying. A new address that still shows the
  broker is staying — "next product" moves to `/product/2` — but a new
  document, a new page or a modal dialog never is, even with the address
  changed in the same action.
- **None, quiet, and the app went somewhere you did not declare**: the action
  fails and says where — `billing.submit: reached none of payment, signIn, and
  the page went to /help, which no outcome declares`. Somewhere is the page
  navigating, a hash or history change included, a new document loading, a
  new page opening, or a modal dialog opening.
- **None, and the broker has left the page**: staying is not the answer, so the
  action waits on and fails at the timeout — `billing left the page, and
  reached none of payment, signIn within 5000 ms`.
- **None, and never quiet**: the action fails at the timeout too, naming what
  was still pending. Time running out is not staying: the answer is not in.

An action refused or reaching no outcome fails with an `Unreached` error
carrying the action, its outcomes, a `reason`
— `start`, `expected`, `both`, `elsewhere`, `late` or `unquiet` — and, where it
is known, `went`: where the app went or what kept it busy. An error the act
itself throws reaches you as it was thrown.

The timeout starts when the act has finished, so a slow act does not spend it.

## Over a document, and over a browser

Both surfaces answer the same questions from what each can see.

| | A document | A Playwright page |
|---|---|---|
| Finds a broker | Testing Library's queries | Playwright's locators |
| Visible | not hidden, not `display: none` or `visibility: hidden`, itself or around it | Playwright's visibility, from layout |
| Pending | a `fetch` or `XMLHttpRequest` in flight, or a change to the document | a request in flight |
| Elsewhere | the location changing, `window.open`, a new modal dialog | a navigation, a new page, a new modal dialog |
| Acts | the events a user's input makes: a click is pointer and mouse down, up, then click | Playwright's actions |

Over a document, `fetch`, `XMLHttpRequest` and `window.open` are wrapped while
an action runs, so its work and where it went can be seen, and put back when the
last action overlapping it has finished. A document has no layout, so an
element drawn off screen or covered still reads as visible there.

On both, a modal dialog is one `:modal` matches or one marked
`aria-modal="true"`, as component libraries draw them; jsdom has no `:modal`,
so there only the mark counts. One is new when it is shown and was not before
the act, so a dialog kept on the page hidden and then shown opens like one
added. Over a document, a `fetch` is pending until its body has arrived, not
only its headers.

## What it does not do

Know these before you rely on it:

- **It does not say when an action may start.** A page that takes its clicks
  before it is ready to answer them loses them with or without this package.
- **Staying does not mean the page is unchanged.** It means the broker is still
  there, none of the declared brokers appeared, and the app did not navigate
  away from it, open a page or open a modal dialog. A panel, a popover or a dialog that is not modal, opened in the page
  and not declared, still reads as staying, so declare every place the action
  can lead.
- **An undeclared destination is caught once the page is quiet there, or at
  the timeout.** An app that leaves and keeps working is named when time runs
  out, not before.
- **Over a browser, work that makes no request is invisible to it.** A change
  that arrives on a timer longer than the quiet period, with no request in
  flight, is read as staying. Over a document, a change to it counts as work.
- **Work already pending when the action starts is not waited for.** Only what
  begins during the action holds staying back.
- **A stream, a web socket, media, a font or an image is not followed.** A
  stream stays open as long as the page does, and the rest is what a page loads
  to draw itself. An outcome that arrives over one is still recognised when it
  shows.
- **An outcome that appears and is gone again may be missed.** The outcomes are
  looked at once any of them is visible, so one that has left by then is not
  reported.
- **It models no page.** What else is on screen, and which brokers are on it
  now, are yours to declare.

---

**[@variance-authority/page-broker](https://variance-authority.dev/reference/packages/page-broker)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · [GitHub](https://github.com/Variance-Authority/variance-authority/tree/main/packages/page-broker) · MIT
