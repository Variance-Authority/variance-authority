<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/page-broker

> Declare where an action on a page can end, over a document or a browser, and learn which outcome the app reached.

Part of [Variance Authority](https://variance-authority.dev).
Point your coding agent at [`llms.txt`](https://variance-authority.dev/llms.txt).

## What this is for

Submitting a checkout form can reach the payment page, open a sign-in dialog,
or stay where it is with errors. A test asserts the one it expected, and when
the app opened the sign-in instead, it fails on a timeout naming what it waited
for, not where the app went. An outcome that is the absence of something — no
alert on the page — passes at once, before the answer has arrived.

With this package **the action carries its outcomes**. You declare once where
it starts and where it can end, and performing it returns the one the app
reached:

```ts
const { outcome } = await submit(on); // 'payment' | 'signIn' | 'invalid'
await submit(on).to('payment'); // or fails: submit: expected payment, reached signIn
```

The same declaration runs over a document — jsdom, happy-dom, a test runner's
browser mode — and over a Playwright page. Only the surface `on` differs.

It needs nothing from the app. No attribute, event or hook written for tests is
read: an outcome is a part of the page becoming visible, and staying is the page
going quiet with none of them on it. It is a page object whose methods also say
which of their declared destinations the app took, not a framework: your runner,
`expect` and everything else stay yours. It depends on nothing else in Variance
Authority.

## Requirements

Node 22 or newer and an ESM project. Over a document, `@testing-library/dom`
10.4 or newer; over a browser, `playwright-core` 1.55 or newer, which
`@playwright/test` already brings.

```bash
npm install --save-dev @variance-authority/page-broker
```

## Declare an action and perform it

```ts
// checkout.model.ts
import { action, region, stay } from '@variance-authority/page-broker';

export const billing = region('billing', { role: 'form', name: 'Billing' });
export const payment = region('payment', { role: 'form', name: 'Payment' });
export const signIn = region('signIn', { role: 'dialog', name: 'Sign in' });

export const submit = action(
  'submit',
  { from: billing, to: { payment, signIn, invalid: stay } },
  (on) => on.click({ role: 'button', name: 'Continue' }),
);
```

Over a document, in any runner with a DOM environment:

```ts
import { surface } from '@variance-authority/page-broker/dom';

const { at } = await submit(surface(document)).to('payment');
```

Over a browser page:

```ts
import { surface } from '@variance-authority/page-broker/playwright';

await page.goto('/checkout');
await submit(surface(page)).to('invalid');
// No waiting: the answer has arrived by the time staying is reported.
expect(await page.getByRole('alert').count()).toBe(1);
```

`region(name, query)` names a part of the page once. A query finds it the way a
person does: `{ role, name? }`, `{ text }`, `{ label }`, `{ testId }` or
`{ css }`, with `frame` set to an iframe's CSS when the part is inside one. A
string matches whole and a pattern within.

`action(name, { from?, to }, act)` takes:

- **`name`**, which every failure message starts with.
- **`from`**, the region or regions the action starts in. It is refused unless
  one of them is visible: `pay: starts from payment, and none is on the page`.
- **`to`**, the outcomes by name: a region the app arrives at, or `stay` for an
  action after which none of them appears. At most one outcome may be `stay`.
- **`act`**, what the test does. The surface offers `click`, `fill`, `press`,
  `check` and `select` by query, and `native` — the document or the Playwright
  page — for anything else. Arguments after the surface are yours:
  `(on, words: string) => …` is performed as `search(on, 'kiwi')`.

The app has 5000 ms after the act to reach an outcome or go quiet, and is
quiet once nothing has been pending for 500 ms. Neither is yours to set.

Performing the action returns a promise of `{ outcome, at }`: the name reached,
and what the surface found — an element, or a locator — which is absent for
`stay`. `.to(name)` on that promise insists on one outcome and narrows the type
to it.

`here(on, regions)` names the regions visible now, without acting, and
`submit.declared` is the action as data — its name, `from` and outcomes — for
whatever reads a model without running it.

## How an outcome is decided

Before the act, every declared region is looked for.

- **None is on the page**: the act runs, and the action waits for one to
  appear.
- **One already is**: it cannot be arrived at, so the action rests there,
  reported the way staying is — once the page is quiet and it is still there.
  An action that likes a product, ending on the product it started on, declares
  it so. Beside `stay` it is refused, since the two could not be told apart, and
  two regions on the page before the act are refused for the same reason.

After the act, whichever comes first — a declared region becoming visible, or
the page going quiet — every region is looked at once.

- **One is visible**: that is the outcome.
- **Two are visible at once**: the action fails, naming both. The order you
  wrote them in never decides.
- **None, and the action can rest or stay**: that outcome is reported once the
  act has finished and nothing has been pending for the quiet period. Work that
  starts within it begins the wait again, so a slow answer that leads somewhere
  is not mistaken for staying.
- **None, quiet, and the app went somewhere you did not declare**: the action
  fails and says where — `submit: reached none of payment, signIn, and the page
  went to /help, which no outcome declares`. Somewhere is the page navigating,
  a hash or history change included, a new page opening, or a modal dialog
  opening. Staying is never reported for it.
- **None, and nothing to rest at**: the action fails at the timeout, naming the
  outcomes none of which was reached.
- **None, and never quiet**: the action fails at the timeout too, naming what
  was still pending. Time running out is not staying: the answer is not in.

A failure is an `Unreached` error carrying the action, its outcomes, a `reason`
— `start`, `expected`, `both`, `elsewhere`, `late` or `unquiet` — and, where it
is known, `went`: where the app went or what kept it busy.

The timeout starts when the act has finished, so a slow act does not spend it.

## Over a document, and over a browser

Both surfaces answer the same questions from what each can see.

| | A document | A Playwright page |
|---|---|---|
| Finds a region | Testing Library's queries | Playwright's locators |
| Visible | not hidden, not `display: none` or `visibility: hidden`, itself or around it | Playwright's visibility, from layout |
| Pending | a `fetch` or `XMLHttpRequest` in flight, or a change to the document | a request in flight |
| Elsewhere | the location changing, `window.open`, a new modal dialog | a navigation, a new page, a new modal dialog |
| Acts | the events a user's input makes: a click is pointer and mouse down, up, then click | Playwright's actions |

A document has no layout, so an element drawn off screen or covered still reads
as visible there. jsdom has no `:modal`, so a modal dialog is one marked
`aria-modal="true"`.

## What it does not do

Know these before you rely on it:

- **It does not say when an action may start.** A page that takes its clicks
  before it is ready to answer them loses them with or without this package.
- **Staying does not mean the page is unchanged.** It means none of the declared
  regions appeared and the app did not navigate, open a page or open a modal
  dialog. A panel, a popover or a dialog that is not modal, opened in the page
  and not declared, still reads as staying, so declare every place the action
  can lead.
- **An undeclared destination is caught only when the action can rest or
  stay.** Without that, it fails at the timeout naming the outcomes it did not
  reach.
- **Over a browser, work that makes no request is invisible to it.** A change
  that arrives on a timer longer than the quiet period, with no request in
  flight, is read as staying. Over a document, a change to it counts as work.
- **Work already pending when the action starts is not waited for.** Only what
  begins during the action holds staying back.
- **A stream, a web socket, media, a font or an image is not followed.** A
  stream stays open as long as the page does, and the rest is what a page loads
  to draw itself. An outcome that arrives over one is still recognised when it
  shows.
- **A region that appears and is gone again may be missed.** The regions are
  looked at one after another once any of them is visible, so one that has left
  by then is not reported.
- **It models no page.** What else is on screen, and which actions are possible
  now, are yours to declare.

---

**[@variance-authority/page-broker](https://variance-authority.dev/reference/packages/page-broker)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · [GitHub](https://github.com/Variance-Authority/variance-authority/tree/main/packages/page-broker) · MIT
