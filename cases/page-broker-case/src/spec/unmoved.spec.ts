// What is not an arrival: a probe showing without its parts, an owner that
// never left, and a history push while another document is still loading.
import { byRole, byTestId, fragment, leads, stay } from '../broker/broker.js';
import { expect, test } from '../fixture.js';
import { Billing } from '../shop.js';

const form = byRole('form', 'Billing details');

const Missing = fragment('missing', { probe: byTestId('missing') });
const Partial = fragment('partial', { probe: byTestId('partial'), uses: { missing: Missing } });
const Holder = fragment('holder', {
  probe: form,
  actions: { go: leads({ partial: Partial, invalid: stay }, (d) => d.click(byRole('button', 'Go'))) },
});

test('an outcome whose probe shows without its parts loses to the declared stay', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  await page.evaluate(() => {
    const go = Object.assign(document.createElement('button'), { textContent: 'Go', type: 'button' });
    go.onclick = () => {
      const partial = Object.assign(document.createElement('div'), { textContent: 'partial' });
      partial.dataset.testid = 'partial';
      document.body.append(partial);
    };
    document.querySelector('form[aria-label="Billing details"]')!.append(go);
  });
  const holder = await app.enter(Holder);
  expect((await holder.go()).outcome).toBe('invalid');
});

// The owner is declared after its part, so the part's outcomes name it once both exist.
const outcomes: Record<string, any> = { invalid: stay };
const Knob = fragment('knob', { probe: byTestId('knob'), actions: { poke: leads(outcomes, (d) => d.click(byRole('button', 'Poke'))) } });
const Owner = fragment('owner', { probe: form, uses: { knob: Knob } });
outcomes.home = Owner;

test('a lead to an owner that never left stays', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  await page.evaluate(() => {
    const knob = document.createElement('div');
    knob.dataset.testid = 'knob';
    knob.append(Object.assign(document.createElement('button'), { textContent: 'Poke', type: 'button' }));
    document.querySelector('form[aria-label="Billing details"]')!.append(knob);
  });
  const owner = await app.enter(Owner);
  expect((await owner.knob.poke()).outcome).toBe('invalid');
});

test('a history push while another document is loading keeps every handle', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const billing = await app.enter(Billing);
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/slow', async (route) => {
    await held;
    await route.fulfill({ status: 204 });
  });
  // The page cannot be asked anything while it loads another document, so it pushes on its own once the request is out.
  const pushed = page.waitForEvent('framenavigated', (frame) => frame.url().endsWith('#kept'));
  await page.evaluate(() => {
    location.href = '/slow';
    // Late enough for the request to be out; the push is witnessed by its own navigation, not by the clock.
    setTimeout(() => history.pushState({}, '', '/checkout?user=member#kept'), 200);
  });
  await pushed;
  const finished = page.waitForEvent('requestfinished', (request) => request.url().endsWith('/slow'));
  release();
  await finished;
  expect(await billing.errors()).toEqual([]);
});
