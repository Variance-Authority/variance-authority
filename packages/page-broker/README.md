<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/page-broker

> Declare where a Playwright action can end, and learn which outcome the app reached.

Part of [Variance Authority](https://variance-authority.dev).
Point your coding agent at [`llms.txt`](https://variance-authority.dev/llms.txt).

## What this is for

Submitting a checkout form can reach the payment page, open a sign-in dialog,
or stay where it is with errors. A Playwright test asserts the one it expected:

```ts
await page.getByRole('button', { name: 'Continue' }).click();
await expect(page.getByRole('form', { name: 'Payment' })).toBeVisible();
```

When the app opened the sign-in instead, that test fails on a timeout naming the
selector it waited for, not where the app went. And an outcome that is the
absence of something — `expect(alerts).toHaveCount(0)` — passes at once, before
the answer has arrived.

With this package **the action carries its outcomes**. You declare them once,
and performing the action returns the one the app reached:

```ts
const { outcome } = await submit(page); // 'payment' | 'signIn' | 'invalid'
await submit(page).to('payment'); // or fails: submit: expected payment, reached signIn
```

It needs nothing from the app. No attribute, event or hook written for tests is
read: an outcome is a part of the page becoming visible, and staying is the page
going quiet with none of them on it.

It is a small addition to a Playwright suite, not a framework. Locators,
waiting, `test` and `expect` stay Playwright's. It depends on nothing else in
Variance Authority and no other package here needs it.

## Requirements

Node 22 or newer, an ESM project, and `@playwright/test` 1.55 or newer, which
you already have.

```bash
npm install --save-dev @variance-authority/page-broker
```

## Declare an action and perform it

```ts
// checkout.spec.ts
import { expect, test } from '@playwright/test';
import { action, stay } from '@variance-authority/page-broker';

const submit = action(
  'submit',
  {
    payment: (page) => page.getByRole('form', { name: 'Payment' }),
    signIn: (page) => page.getByRole('dialog', { name: 'Sign in' }),
    invalid: stay,
  },
  async (page) => {
    await page.getByRole('button', { name: 'Continue' }).click();
  },
);

test('a member with an address reaches payment', async ({ page }) => {
  await page.goto('/checkout');
  await page.getByLabel('Street').fill('Damrak 1');

  const { at } = await submit(page).to('payment');

  await expect(at!.getByLabel('Card')).toBeVisible();
});

test('an empty form stays, with its errors', async ({ page }) => {
  await page.goto('/checkout');

  await submit(page).to('invalid');

  // No waiting: the answer has arrived by the time staying is reported.
  expect(await page.getByRole('alert').count()).toBe(1);
});
```

`action(name, outcomes, act, options?)` takes:

- **`name`**, which every failure message starts with.
- **`outcomes`**, by name. Each is a function from the page to the locator that
  is visible once the app is there, or `stay` for an action after which none of
  the declared parts appears. At most one outcome may be `stay`.
- **`act`**, what the test does to the page. Arguments after `page` are yours:
  `async (page, words: string) => …` is performed as `find(page, 'card')`.
- **`options`**: `timeout`, how long the app has, after the act, to reach an
  outcome or go quiet (5000 ms), and `quiet`, how long the page must be quiet
  before staying is reported (500 ms).

Performing the action returns a promise of `{ outcome, at }`: the name reached,
and the locator recognised, which is absent for `stay`. `.to(name)` on that
promise insists on one outcome and narrows the type to it.

## How an outcome is decided

Before the act, every declared part of the page is looked for, and one already
visible is refused: reaching it could not be told from standing still.

After the act, Playwright waits for any declared part to become visible, and
the page's requests are followed to learn when it has gone quiet. Whichever
comes first, every declared part is then looked at once.

- **One is visible**: that is the outcome.
- **Two are visible at once**: the action fails, naming both. The order you
  wrote them in never decides.
- **None, and `stay` is declared**: staying is reported once the act has
  finished and no request has been in flight for the quiet period. A request
  that starts within it begins the wait again, so a slow answer that leads
  somewhere is not mistaken for staying.
- **None, and no `stay`**: the action fails at the timeout, naming the outcomes
  none of which was reached.
- **None, and never quiet**: the action fails at the timeout too, naming the
  requests still in flight. Time running out is not staying: with a request
  still in flight the answer is not in.

A request for a server-sent stream, a web socket, media, a font or an image
does not count as in flight: a stream stays open for as long as the page does,
and the rest is what a page loads to draw itself.

The timeout starts when the act has finished, so a slow act does not spend it.

## What it does not do

Know these before you rely on it:

- **It does not say when an action may start.** A page that takes its clicks
  before it is ready to answer them loses them with or without this package.
- **Staying does not mean the page is unchanged.** It means none of the declared
  parts appeared. A dialog or a page you did not declare reads as staying, so
  declare every place the action can lead.
- **Work that makes no request is invisible to it.** A change that arrives on a
  timer longer than the quiet period, with no request in flight, is read as
  staying. Raise `quiet` for an action you know is slow that way.
- **A request already in flight when the action starts is not waited for.** Only
  requests that begin during the action hold staying back.
- **An outcome must be specific to its arrival.** A recogniser that matches
  something on the page before the act is refused. When what you arrive at
  depends on an argument, declare the action per argument:

  ```ts
  const open = (story: string) =>
    action(
      'open',
      { story: (page) => page.locator(`[data-item-id="${story}"][data-selected="true"]`) },
      async (page) => {
        await page.getByRole('option', { name: story }).click();
      },
    );

  await open('card--with-actions')(page).to('story');
  ```

- **A part that appears and is gone again may be missed.** The parts are looked
  at one after another once any of them is visible, so one that has left by
  then is not reported.
- **An answer carried by a stream or a web socket is not waited for.** An
  outcome that arrives over one is still recognised when it shows; only
  staying is reported without it.
- **It models no page.** What else is on screen, whether the part you left is
  gone, and which actions are available now are not answered.

---

**[@variance-authority/page-broker](https://variance-authority.dev/reference/packages/page-broker)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · [GitHub](https://github.com/Variance-Authority/variance-authority/tree/main/packages/page-broker) · MIT
