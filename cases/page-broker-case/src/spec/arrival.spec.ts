// Navigation is the subject: each case loads the page it walks.
// Arrival is witnessed from both ends, and by one outcome only. These fragments
// are wrong on purpose: each declares an edge the app does not take that way.
import { byLabel, byRole, fragment, leads, stay } from '../broker/broker.js';
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

// Forgets that searching leaves the page: the search box stays, the form does not.
const StillHeader = fragment('header-still', {
  probe: byRole('banner'),
  actions: {
    search: async (d, q: string) => {
      await d.fill(byRole('searchbox', 'Search'), q);
      await d.press(byRole('searchbox', 'Search'), 'Enter');
    },
  },
});
const Searching = fragment('billing-searching', { probe: form, uses: { header: StillHeader } });

test('a part that stays does not hide its owner leaving', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const billing = await app.enter(Searching);
  await expect(billing.header.search('socks') as unknown as Promise<unknown>).rejects.toThrow(
    'header-still.search is declared to stay, and billing-searching left',
  );
  await expect(billing.header.search('wool') as unknown as Promise<unknown>).rejects.toThrow('departed');
});

// The same mistake, declared as a lead that stays.
const StayingHeader = fragment('header-staying', {
  probe: byRole('banner'),
  actions: {
    search: leads({ here: stay }, async (d, q: string) => {
      await d.fill(byRole('searchbox', 'Search'), q);
      await d.press(byRole('searchbox', 'Search'), 'Enter');
    }),
  },
});
const Staying = fragment('billing-staying', { probe: form, uses: { header: StayingHeader } });

test('a part whose lead stays does not hide its owner leaving', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const billing = await app.enter(Staying);
  await expect(billing.header.search('socks')).rejects.toThrow('header-staying.search declares here, and the page shows');
  await expect(billing.header.search('wool')).rejects.toThrow('departed');
});
