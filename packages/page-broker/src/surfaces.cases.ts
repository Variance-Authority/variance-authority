// One test body, run over every surface the package ships: a broker holds,
// and fails, the same way over a document and over a browser page.
import { expect, it, vi } from 'vitest';
import { by } from './broker.js';
import { broker, stay, Unreached } from './index.js';
import type { Surface } from './surface.js';

/**
 * A checkout on the surface, announcing nothing: a Billing form — Street,
 * Delivery, Gift, a `summary` output and Continue — whose server answers
 * `answer` after `after` ms. Each answer is what the app then does, as the
 * fixture's `show` draws it; answers joined by a comma happen together.
 */
export type Checkout = (
  answer: 'payment' | 'signIn' | 'help' | 'helpShown' | 'tipsShown' | 'next' | 'next,help' | 'gone' | 'nothing' | 'alert' | 'link' | 'blank' | 'hash' | 'post' | 'window',
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
    key: (on, key: string) => on.press({ label: 'Street' }, key),
    deliver: (on, how: string) => on.select({ label: 'Delivery' }, how),
    gift: (on) => on.check({ label: 'Gift' }),
    submit: leads({ payment: Payment, signIn: SignIn, invalid: stay }, proceed),
    enter: leads({ payment: Payment, signIn: SignIn, invalid: stay }, (on) => on.press({ label: 'Street' }, 'Enter')),
    pay: leads({ payment: Payment }, proceed),
    next: leads({ again: stay }, proceed),
    wait: brief({ again: stay }, proceed),
    hold: brief({ payment: Payment }, proceed),
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

  it('fills, presses, chooses and ticks as a person does, and reads the page back by text, test id and selector', async () => {
    const on = await checkout('nothing', 20);
    const billing = await Billing.on(on);

    // Brackets are text, never a key's name.
    await billing.street('{Apt} [2]');
    await billing.key('Backspace');
    await billing.key('+');
    await billing.key('Shift++');
    // By its label, then by its value.
    await billing.deliver('Express');
    await billing.deliver('standard');
    await billing.deliver('express');
    // Ticked once, however often asked.
    await billing.gift();
    await billing.gift();

    expect(await on.find({ text: '{Apt} [2++ / express / gift' }).visible()).toBeDefined();
    expect(await on.find({ testId: 'summary' }).visible()).toBeDefined();
    expect(await on.find({ css: 'output' }).visible()).toBeDefined();
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

  it.each(['helpShown', 'tipsShown'] as const)('fails on a modal dialog that was on the page hidden and is shown by the action: %s', async (answer) => {
    const billing = await Billing.on(await checkout(answer, 20));

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

  it('does not stay under a modal dialog opened with a new address, though it is still on the page', async () => {
    const billing = await Billing.on(await checkout('next,help', 20));

    await expect(billing.next()).rejects.toMatchObject({ reason: 'elsewhere', went: 'a modal dialog opened' });
  });

  it('does not stay under a native dialog', async () => {
    const billing = await Billing.on(await checkout('alert', 20));

    await expect(billing.next()).rejects.toMatchObject({ reason: 'elsewhere', went: 'a native alert dialog opened' });
  });

  it.each([
    ['link', 'a new document at /checkout/elsewhere'],
    ['post', 'a new document at /checkout/elsewhere'],
    ['blank', 'a new page opened'],
    ['window', 'a new page opened'],
  ] as const)('does not stay when the app followed %s, which the page does not prevent', async (answer, went) => {
    const billing = await Billing.on(await checkout(answer, 20));

    await expect(billing.next()).rejects.toMatchObject({ reason: 'elsewhere', went });
  });

  it('stays when the app followed a link within its own document', async () => {
    const billing = await Billing.on(await checkout('hash', 20));

    await expect(billing.next()).resolves.toMatchObject({ outcome: 'again' });
  });

  it('fails at its timeout naming the outcomes never reached, when the app answered with none', async () => {
    const billing = await Billing.on(await checkout('nothing', 20));

    await expect(billing.hold()).rejects.toMatchObject({
      reason: 'late',
      message: 'billing.hold: reached none of payment within 600 ms',
    });
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
    const act = vi.fn(proceed);
    const Again = broker('again', {
      probe: { role: 'form', name: 'Billing' },
      actions: {
        submit: leads({ billing: Billing }, act),
      },
    });
    const again = await Again.on(await checkout('payment', 20));

    await expect(again.submit()).rejects.toMatchObject({
      reason: 'start',
      message: 'again.submit: billing is on the page before the action, so it could not be arrived at',
    });
    expect(act).not.toHaveBeenCalled();
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
        hold: { payment: 'payment' },
      },
    });
  });
}
