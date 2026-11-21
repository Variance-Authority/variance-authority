// One test body, run over every surface the package ships: a broker holds,
// and fails, the same way over a document and over a browser page.
import { expect, it } from 'vitest';
import { by } from './broker.js';
import { broker, stay, Unreached } from './index.js';
import type { Surface } from './surface.js';

/**
 * A checkout on the surface, announcing nothing: a Billing form with a Street
 * field and a Continue button that submits it whose answer, after `after` ms, is `answer` — `payment`
 * shows the Payment form, `signIn` the Sign in dialog, `help` opens a modal
 * dialog, `helpShown` shows a modal dialog that was on the page hidden, `next`
 * moves the page to `/checkout/next` with the form still on it, `gone` hides
 * the form and shows nothing in its place, and `nothing` leaves the page as it was.
 */
export type Checkout = (
  answer: 'payment' | 'signIn' | 'help' | 'helpShown' | 'next' | 'gone' | 'nothing',
  after: number,
) => Promise<Surface>;

const leads = by({ timeout: 2000, quiet: 100 });
const brief = by({ timeout: 600, quiet: 100 });
const proceed = (on: Surface): Promise<void> => on.click({ role: 'button', name: 'Continue' });

const Payment = broker('payment', { probe: { role: 'form', name: 'Payment' } });
const SignIn = broker('signIn', { probe: { role: 'dialog', name: 'Sign in' } });
const Billing = broker('billing', {
  probe: { role: 'form', name: 'Billing' },
  actions: {
    // Stays within the form: nothing is declared, nothing is decided.
    street: (on, words: string) => on.fill({ label: 'Street' }, words),
    submit: leads({ payment: Payment, signIn: SignIn, invalid: stay }, proceed),
    enter: leads({ payment: Payment, signIn: SignIn, invalid: stay }, (on) => on.press({ label: 'Street' }, 'Enter')),
    pay: leads({ payment: Payment }, proceed),
    next: leads({ again: stay }, proceed),
    wait: brief({ again: stay }, proceed),
  },
});

/** Declares the shared cases in the calling `describe`. */
export function cases(checkout: Checkout): void {
  it('returns the outcome the app reached, by its declared name, as that broker', async () => {
    const billing = await Billing.on(await checkout('payment', 20));

    const reached = await billing.submit();

    expect(reached.outcome).toBe('payment');
    expect(reached.at.root).toBeDefined();
  });

  it('fails a test that insisted on another outcome, naming the one reached', async () => {
    const billing = await Billing.on(await checkout('signIn', 20));

    await expect(billing.submit().to('payment')).rejects.toThrow('billing.submit: expected payment, reached signIn');
  });

  it('hands the insisted broker back when it is the one reached', async () => {
    const billing = await Billing.on(await checkout('signIn', 20));

    const dialog = await billing.submit().to('signIn');

    expect(Object.keys(dialog)).toEqual(['root']);
  });

  it('does not report staying while a slower declared outcome is on its way', async () => {
    // Three quiet periods.
    const billing = await Billing.on(await checkout('payment', 300));

    await expect(billing.submit()).resolves.toMatchObject({ outcome: 'payment' });
  });

  it('stays, as itself, once the page is quiet with it still there and nothing else arrived', async () => {
    const billing = await Billing.on(await checkout('nothing', 20));

    const reached = await billing.submit();

    expect(reached.outcome).toBe('invalid');
    expect(Object.keys(reached.at).sort()).toEqual(Object.keys(billing).sort());
  });

  it('acts within itself and returns what the act returned, deciding nothing', async () => {
    const billing = await Billing.on(await checkout('nothing', 20));

    await expect(billing.street('Main Street 1')).resolves.toBeUndefined();
  });

  it('submits a form by Enter in its field, as a person does', async () => {
    const billing = await Billing.on(await checkout('payment', 20));
    await billing.street('Main Street 1');

    await expect(billing.enter().to('payment')).resolves.toBeDefined();
  });

  it('fails an arrival no outcome declares with the failure value, naming where the app went', async () => {
    const billing = await Billing.on(await checkout('help', 20));

    const failed = await billing.submit().catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(Unreached);
    expect(failed).toMatchObject({
      action: 'billing.submit',
      outcomes: ['payment', 'signIn', 'invalid'],
      reason: 'elsewhere',
      went: 'a modal dialog opened',
    });
  });

  it('fails on a modal dialog that was on the page hidden and is shown by the action', async () => {
    const billing = await Billing.on(await checkout('helpShown', 20));

    await expect(billing.submit()).rejects.toMatchObject({ reason: 'elsewhere', went: 'a modal dialog opened' });
  });

  it('names where the app went for an action that cannot stay, once the page is quiet there', async () => {
    const billing = await Billing.on(await checkout('help', 20));
    const began = Date.now();

    await expect(billing.pay()).rejects.toMatchObject({ reason: 'elsewhere', went: 'a modal dialog opened' });
    // Told when the page went quiet there, not at the timeout.
    expect(Date.now() - began).toBeLessThan(1500);
  });

  it('stays when the app moved to a new address with itself still on the page', async () => {
    const billing = await Billing.on(await checkout('next', 20));

    await expect(billing.next()).resolves.toMatchObject({ outcome: 'again' });
  });

  it('does not stay under a modal dialog opened over it', async () => {
    const billing = await Billing.on(await checkout('help', 20));

    await expect(billing.next()).rejects.toMatchObject({ reason: 'elsewhere', went: 'a modal dialog opened' });
  });

  it('does not stay once it has left the page, though nothing declared took its place', async () => {
    const billing = await Billing.on(await checkout('gone', 20));

    await expect(billing.wait()).rejects.toMatchObject({
      action: 'billing.wait',
      reason: 'late',
      message: 'billing.wait: billing left the page, and nothing declared took its place within 600 ms',
    });
  });

  it('is not found where its probe is not on the page', async () => {
    const on = await checkout('nothing', 20);

    await expect(Payment.on(on)).rejects.toMatchObject({
      name: 'Unreached',
      reason: 'start',
      message: 'payment: not on the page',
    });
  });

  it('refuses to act when an outcome is on the page before the action, since it could not be arrived at', async () => {
    let acted = false;
    const Again = broker('again', {
      probe: { role: 'form', name: 'Billing' },
      actions: {
        submit: leads({ billing: Billing }, async (on) => {
          acted = true;
          await proceed(on);
        }),
      },
    });
    const again = await Again.on(await checkout('payment', 20));

    await expect(again.submit()).rejects.toMatchObject({
      reason: 'start',
      message: 'again.submit: billing is on the page before the action, so it could not be arrived at',
    });
    expect(acted).toBe(false);
  });

  it('reads as data: its probe, and where each action leads, without a page', () => {
    expect(Billing.declared).toEqual({
      name: 'billing',
      probe: { role: 'form', name: 'Billing' },
      leads: {
        submit: { payment: 'payment', signIn: 'signIn', invalid: stay },
        enter: { payment: 'payment', signIn: 'signIn', invalid: stay },
        pay: { payment: 'payment' },
        next: { again: stay },
        wait: { again: stay },
      },
    });
  });
}
