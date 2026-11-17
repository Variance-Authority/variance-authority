// Navigation is the subject: each case loads the page it walks.
// Arrival is witnessed from both ends, and by one outcome only. These fragments
// are wrong on purpose: each declares an edge the app does not take that way.
import { byLabel, byRole, fragment, leads } from '../broker/broker.js';
import { expect, test } from '../fixture.js';
import { Header, Payment, SignIn } from '../shop.js';

const form = byRole('form', 'Billing details');
const fill = async (d: { select: Function; fill: Function }) => {
  await d.select(byLabel('Country'), 'NL');
  await d.fill(byLabel('Street'), 'Damrak 1');
};

// Forgets that sign-in opens over the form: the form still shows when it arrives.
const Careless = fragment('billing-careless', {
  probe: form,
  actions: {
    submit: leads({ payment: Payment, signIn: SignIn }, async (d) => {
      await fill(d as never);
      await d.click(byRole('button', 'Continue'));
    }),
  },
});

// Names a part of the payment page as a destination of its own.
const Blurred = fragment('billing-blurred', {
  probe: form,
  actions: {
    submit: leads({ payment: Payment, header: Header }, async (d) => {
      await fill(d as never);
      await d.click(byRole('button', 'Continue'));
    }),
  },
});

test('a departure the departed fragment outlives is refused, naming the cover it needs', async ({ page, app }) => {
  await page.goto('/checkout?user=guest', { waitUntil: 'commit' });
  const billing = await app.enter(Careless);
  await expect(billing.submit()).rejects.toThrow(
    'billing-careless.submit reached sign-in, and billing-careless still shows; declare it over(sign-in)',
  );
});

test('two outcomes that both show are refused, not chosen by order', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const billing = await app.enter(Blurred);
  await expect(billing.submit()).rejects.toThrow('billing-blurred.submit reached payment and header at once');
});
