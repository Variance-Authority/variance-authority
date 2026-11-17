// Navigation is the subject: each case loads the page it walks.
// Arrival is witnessed from both ends, and by one outcome only. These fragments
// are wrong on purpose: each declares an edge the app does not take that way.
import { back, byLabel, byRole, fragment, leads, over, stay } from '../broker/broker.js';
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
  // The form is gone whichever outcome it was: its handle goes with it.
  await expect(billing.submit()).rejects.toThrow('billing-blurred departed at billing-blurred.submit');
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

test('a part entered before its owner checks the owner it learns', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const header = await app.enter(StillHeader);
  const billing = await app.enter(Searching);
  expect(billing.header).toBe(header);
  await expect(header.search('socks') as unknown as Promise<unknown>).rejects.toThrow(
    'header-still.search is declared to stay, and billing-searching left',
  );
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

const dialog = byRole('dialog', 'Sign in');
const cancel = (d: { click: Function }) => d.click(byRole('button', 'Cancel'));
const submitting = (name: string, signIn: Parameters<typeof over>[0]) =>
  fragment(name, {
    probe: form,
    actions: {
      submit: leads({ payment: Payment, signIn: over(signIn) }, async (d) => {
        await fill(d as never);
        await d.click(byRole('button', 'Continue'));
      }),
    },
  });

// The close button is a part of the dialog, and going back is the part's to do.
const Closer = fragment('sign-in-closer', { probe: dialog, actions: { close: leads({ billing: back }, cancel as never) } });
const Parted = fragment('sign-in-parted', { probe: dialog, uses: { closer: Closer } });
const UnderParted = submitting('billing-parted', Parted);

test('a part of a cover goes back to what the cover covers', async ({ page, app }) => {
  await page.goto('/checkout?user=guest', { waitUntil: 'commit' });
  const billing = await app.enter(UnderParted);
  const signIn = await billing.submit.to('signIn');
  expect(await signIn.closer.close.to('billing')).toBe(billing);
});

// Going back may also not happen: the dialog refuses to close, and says so by staying.
const Patient = fragment('sign-in-patient', { probe: dialog, actions: { cancel: leads({ billing: back, still: stay }, cancel as never) } });
const UnderPatient = submitting('billing-patient', Patient);

test('a cover that stays is not taken for going back', async ({ page, app }) => {
  await page.goto('/checkout?user=guest&stuck', { waitUntil: 'commit' });
  const billing = await app.enter(UnderPatient);
  const signIn = await billing.submit.to('signIn');
  expect(await signIn.cancel.to('still')).toBe(signIn);
  await expect(billing.submit() as unknown as Promise<unknown>).rejects.toThrow('billing-patient is covered by sign-in-patient');
});

// A cover on a cover: help opens over the sign-in, which opened over the form.
const Help = fragment('help', { probe: byRole('dialog', 'Help'), actions: { close: leads({ signIn: back }, (d) => d.click(byRole('button', 'Close'))) } });
const Helped = fragment('sign-in-helped', { probe: dialog, actions: { help: leads({ help: over(Help) }, (d) => d.click(byRole('button', 'Help'))) } });
const Reading = fragment('billing-reading', {
  probe: form,
  actions: { submit: leads({ payment: Payment, signIn: over(Helped) }, async (d) => { await fill(d as never); await d.click(byRole('button', 'Continue')); }) },
  reads: { address: (r) => r.value(byLabel('Street')) },
});

test('closing a cover on a cover leaves the page beneath both still covered and readable', async ({ page, app }) => {
  await page.goto('/checkout?user=guest', { waitUntil: 'commit' });
  const billing = await app.enter(Reading);
  const signIn = await billing.submit.to('signIn');
  const help = await signIn.help.to('help');
  expect(await help.close.to('signIn')).toBe(signIn);
  expect(await billing.address()).toBe('Damrak 1');
  await expect(billing.submit() as unknown as Promise<unknown>).rejects.toThrow('billing-reading is covered by sign-in-helped');
});

// The same part used twice by one owner is one part.
const Twice = fragment('billing-twice', { probe: form, uses: { top: Header, again: Header } });

test('a part an owner uses twice is one handle', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const billing = await app.enter(Twice);
  expect(billing.again).toBe(billing.top);
  expect(await app.enter(Header)).toBe(billing.top);
});
