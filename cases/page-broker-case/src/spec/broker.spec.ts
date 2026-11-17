// The shop through its broker. No test here waits for anything by name or by
// time: every wait is the broker's settle, fed by what the app says it is doing.
import { fork } from '../broker/broker.js';
import { expect, test } from '../fixture.js';
import { Billing, Product } from '../shop.js';

test('a member pays', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const form = await app.enter(Billing);
  const payment = await form.country('NL').street('Damrak 1').submit.to('payment');
  expect(payment).toBeDefined();
  // The handle is revoked: the form is gone, and the test cannot read it as if it were not.
  await expect(form.errors()).rejects.toThrow('billing departed at billing.submit');
});

test('a guest is asked to sign in over the form, and the form waits under it', async ({ page, app }) => {
  await page.goto('/checkout?user=guest', { waitUntil: 'commit' });
  const form = await app.enter(Billing);
  const signIn = await form.country('NL').street('Damrak 1').submit.to('signIn');
  await signIn.email('a@b.c');
  expect(await form.address()).toBe('Damrak 1');
  await expect(form.street('Rokin 2') as unknown as Promise<unknown>).rejects.toThrow(
    'billing is covered by sign-in; street would act under it',
  );
  const back = await signIn.cancel.to('billing');
  expect(back).toBe(form);
  await form.street('Rokin 2');
  expect(await form.address()).toBe('Rokin 2');
});

test('a form left empty stays, and says why', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const form = await app.enter(Billing);
  await form.submit.to('invalid');
  expect(await form.errors()).toEqual(['Choose a country', 'Enter a street']);
});

test('naming the wrong branch fails with the branch that was taken', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const form = await app.enter(Billing);
  await expect(form.country('NL').street('Damrak 1').submit.to('signIn')).rejects.toThrow(
    'billing.submit was expected to reach signIn, and reached payment',
  );
});

test('a like lands before the count is read', async ({ page, app }) => {
  await page.goto('/product', { waitUntil: 'commit' });
  const product = await app.enter(Product);
  const before = await product.likes();
  await product.like().like().like();
  expect(await product.likes()).toBeGreaterThanOrEqual(before + 3);
});

test('the header searches from any page that uses it', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const form = await app.enter(Billing);
  const results = await form.header.search.to('results', 'socks');
  expect(await results.items()).toEqual(['socks — wool', 'socks — cotton']);
  await expect(form.address()).rejects.toThrow('departed');
});

test('an unnamed step goes wherever the app goes, and the journal says so', async ({ page, app }) => {
  await page.goto('/checkout?user=guest', { waitUntil: 'commit' });
  const form = await app.enter(Billing);
  const next = await form.country('DE').street('Unter den Linden').submit();
  expect(next.outcome).toBe('signIn');
  expect(app.journal.at(-1)).toMatchObject({ action: 'submit', named: undefined, to: 'sign-in' });
});

test('the raw escape hatch works, and is written down', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const form = await app.enter(Billing);
  await app.raw(form).getByLabel('Street').fill('typed around the broker');
  expect(app.journal).toContainEqual({ from: 'billing', action: 'raw', kind: 'raw', to: 'billing' });
});

test('two walks print where they part', async ({ browser, baseURL }) => {
  const { App } = await import('../broker/broker.js');
  const { watch } = await import('../broker/settle.js');
  const walk = async (user: string) => {
    const page = await browser.newPage({ baseURL });
    watch(page);
    const app = new App(page);
    await page.goto(`/checkout?user=${user}`, { waitUntil: 'commit' });
    const form = await app.enter(Billing);
    await form.country('NL').street('Damrak 1').submit();
    await page.close();
    return app.journal;
  };
  const parted = fork(await walk('member'), await walk('guest'));
  expect(parted).toBe(
    [
      'shared: billing.country → billing  ·  billing.street → billing',
      'a: billing.submit → payment (unnamed)',
      'b: billing.submit → sign-in (unnamed)',
    ].join('\n'),
  );
});
