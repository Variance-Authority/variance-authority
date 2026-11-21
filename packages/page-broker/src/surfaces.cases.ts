// One test body, run over every surface the package ships: a declaration
// holds, and fails, the same way over a document and over a browser page.
import { expect, it } from 'vitest';
import { here, model, region, stay, Unreached } from './index.js';
import { by } from './model.js';
import type { Surface } from './surface.js';

/**
 * A checkout on the surface, announcing nothing: a Billing form with a Street
 * field and a Continue button that submits it whose answer, after `after` ms, is `answer` — `payment`
 * shows the Payment form, `signIn` the Sign in dialog, `help` opens a modal
 * dialog, `next` moves the page to `/checkout/next` with the form still on it,
 * and `nothing` leaves the page as it was.
 */
export type Checkout = (answer: 'payment' | 'signIn' | 'help' | 'next' | 'nothing', after: number) => Promise<Surface>;

const billing = region('billing', { role: 'form', name: 'Billing' });
const payment = region('payment', { role: 'form', name: 'Payment' });
const signIn = region('signIn', { role: 'dialog', name: 'Sign in' });

const submit = by({ timeout: 2000, quiet: 100 })(
  'submit',
  { from: billing, to: { payment, signIn, invalid: stay } },
  (on) => on.click({ role: 'button', name: 'Continue' }),
);

/** Declares the shared cases in the calling `describe`. */
export function cases(checkout: Checkout): void {
  it('returns the outcome the app reached, by its declared name', async () => {
    await expect(submit(await checkout('payment', 20))).resolves.toMatchObject({ outcome: 'payment' });
  });

  it('fails a test that insisted on another outcome, naming the one reached', async () => {
    await expect(submit(await checkout('signIn', 20)).to('payment')).rejects.toThrow(
      'submit: expected payment, reached signIn',
    );
  });

  it('does not report staying while a slower declared outcome is on its way', async () => {
    // Three quiet periods.
    await expect(submit(await checkout('payment', 300))).resolves.toMatchObject({ outcome: 'payment' });
  });

  it('reports staying once the page is quiet with no outcome on it', async () => {
    await expect(submit(await checkout('nothing', 20))).resolves.toEqual({ outcome: 'invalid', at: undefined });
  });

  it('fails an arrival no outcome declares with the failure value, naming where the app went', async () => {
    const failed = await submit(await checkout('help', 20)).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(Unreached);
    expect(failed).toMatchObject({
      action: 'submit',
      outcomes: ['payment', 'signIn', 'invalid'],
      reason: 'elsewhere',
      went: 'a modal dialog opened',
    });
  });

  it('names where the app went for an action with nowhere to rest, once the page is quiet there', async () => {
    const pay = by({ timeout: 2000, quiet: 100 })('pay', { from: billing, to: { payment } }, (on) =>
      on.click({ role: 'button', name: 'Continue' }),
    );
    const began = Date.now();

    await expect(pay(await checkout('help', 20))).rejects.toMatchObject({ reason: 'elsewhere', went: 'a modal dialog opened' });
    // Told when the page went quiet there, not at the timeout.
    expect(Date.now() - began).toBeLessThan(1500);
  });

  it('submits a form by Enter in its field, as a person does', async () => {
    const enter = by({ timeout: 2000, quiet: 100 })(
      'enter',
      { from: billing, to: { payment, signIn, invalid: stay } },
      async (on) => {
        await on.fill({ label: 'Street' }, 'Main Street 1');
        await on.press({ label: 'Street' }, 'Enter');
      },
    );

    await expect(enter(await checkout('payment', 20))).resolves.toMatchObject({ outcome: 'payment' });
  });

  // Continue with only the form declared: it rests there, or fails where the app went.
  const next = by({ timeout: 2000, quiet: 100 })('next', { to: { billing } }, (on) =>
    on.click({ role: 'button', name: 'Continue' }),
  );

  it('rests at a region still on the page after the app moved to a new address', async () => {
    await expect(next(await checkout('next', 20))).resolves.toMatchObject({ outcome: 'billing' });
  });

  it('does not rest at a region a modal dialog has opened over', async () => {
    await expect(next(await checkout('help', 20))).rejects.toMatchObject({
      reason: 'elsewhere',
      went: 'a modal dialog opened',
    });
  });

  it('lists a model\'s actions, and those that can start where the page is, without acting', async () => {
    let acted = 0;
    const pay = by({ timeout: 2000, quiet: 100 })('pay', { from: payment, to: { signIn } }, async () => {
      acted += 1;
    });
    const shop = model([submit, pay]);
    const on = await checkout('payment', 20);

    expect(shop.actions).toEqual([submit.declared, pay.declared]);
    expect(shop.regions).toEqual([billing, payment, signIn]);
    expect(shop.from(await here(on, shop.regions))).toEqual([submit.declared]);
    expect(acted).toBe(0);
  });

  it('reads the regions on the page and the action as data, without acting', async () => {
    const on = await checkout('payment', 20);

    await expect(here(on, [billing, payment, signIn])).resolves.toEqual(['billing']);
    // Each outcome names its region, so a program reading the model knows where it leads.
    expect(submit.declared).toEqual({ name: 'submit', from: [billing], to: { payment, signIn, invalid: stay } });
  });
}
