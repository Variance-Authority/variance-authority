// Arriving again: a new document, a cover reloading under itself, and a part that was on the page before its cover.
import { back, byLabel, byRole, byTestId, fragment, leads, over, stay, stays } from '../broker/broker.js';
import { expect, test } from '../fixture.js';
import { Header, Payment } from '../shop.js';

// Rule 1: on a new document the acting fragment has left, even when the new page shows one like it.
test('a header entered alone leads to results on a new document', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const header = await app.enter(Header);
  const results = await header.search.to('results', 'socks');
  expect(await results.items()).toEqual(['socks — wool', 'socks — cotton']);
});

const selfLead: Record<string, any> = {};
const Bar = fragment('re-bar', { probe: byRole('banner'), actions: { reload: leads(selfLead, (d) => d.click(byRole('button', 'Reload'))) } });
selfLead.again = Bar;
const BarOwner = fragment('re-bar-owner', { probe: byRole('form', 'Billing details'), uses: { bar: Bar } });

test('a part arrives again on a new document', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  await page.evaluate(() => {
    const b = Object.assign(document.createElement('button'), { textContent: 'Reload', type: 'button' });
    b.onclick = () => location.reload();
    document.querySelector('header')!.append(b);
  });
  const owner = await app.enter(BarOwner);
  const again = await owner.bar.reload.to('again');
  expect(again).not.toBe(owner.bar);
});

// Rule 3 + linear handles: a stay that loads a new document departs every other handle; `back` must not revive them.
const doc = `<!doctype html><meta charset="utf-8">
<form aria-label="Covered form"><label>Name <input name="n"></label><button type="button" id="open">Open</button></form>
<div id="c" data-testid="re-cover" hidden><button type="button" id="reload">Reload</button><button type="button" id="close">Close</button></div>
<script>
const c = document.getElementById('c');
if (sessionStorage.reopen) c.hidden = false;
document.getElementById('open').onclick = () => { sessionStorage.reopen = '1'; c.hidden = false; };
document.getElementById('reload').onclick = () => location.reload();
document.getElementById('close').onclick = () => { delete sessionStorage.reopen; c.hidden = true; };
</script>`;
const Cover = fragment('re-cover', {
  probe: byTestId('re-cover'),
  actions: { reload: stays((d) => d.click(byRole('button', 'Reload'))), close: leads({ form: back }, (d) => d.click(byRole('button', 'Close'))) },
});
const CoveredForm = fragment('re-form', {
  probe: byRole('form', 'Covered form'),
  actions: { open: leads({ cover: over(Cover) }, (d) => d.click(byRole('button', 'Open'))) },
  reads: { name: (r) => r.value(byLabel('Name')) },
});

test('going back after the cover reloaded the document does not revive the departed page', async ({ page, app }) => {
  await page.route('**/redoc', (route) => route.fulfill({ contentType: 'text/html', body: doc }));
  await page.goto('/redoc');
  const form = await app.enter(CoveredForm);
  const cover = await form.open.to('cover');
  await cover.reload();
  await expect(form.name()).rejects.toThrow('departed');
  await cover.close.to('form');
  await expect(form.name()).rejects.toThrow('departed');
});

// "a cover ... leaves every handle on the page readable but refuses their actions ... back uncovers exactly what that cover covered".
const Leaf = fragment('re-leaf', {
  probe: byRole('search'),
  actions: { type: (d, q: string) => d.fill(byRole('searchbox', 'Search'), q) },
  reads: { query: (r) => r.value(byRole('searchbox', 'Search')) },
});
const Leafy = fragment('re-leafy', {
  probe: byRole('dialog', 'Sign in'),
  uses: { leaf: Leaf },
  actions: { cancel: leads({ billing: back }, (d) => d.click(byRole('button', 'Cancel'))) },
});
const LeafBilling = fragment('re-billing', {
  probe: byRole('form', 'Billing details'),
  actions: {
    submit: leads({ payment: Payment, signIn: over(Leafy) }, async (d) => {
      await d.select(byLabel('Country'), 'NL');
      await d.fill(byLabel('Street'), 'Damrak 1');
      await d.click(byRole('button', 'Continue'));
    }),
  },
});

test('a part on the page before a cover that uses it is covered by it', async ({ page, app }) => {
  await page.goto('/checkout?user=guest', { waitUntil: 'commit' });
  const leaf = await app.enter(Leaf);
  const billing = await app.enter(LeafBilling);
  const cover = await billing.submit.to('signIn');
  expect(cover.leaf).toBe(leaf);
  await expect(leaf.type('x') as unknown as Promise<unknown>).rejects.toThrow('re-leaf is covered');
});

test('a part on the page before a cover that uses it is uncovered by back', async ({ page, app }) => {
  await page.goto('/checkout?user=guest', { waitUntil: 'commit' });
  const leaf = await app.enter(Leaf);
  const billing = await app.enter(LeafBilling);
  const cover = await billing.submit.to('signIn');
  await cover.cancel.to('billing');
  await leaf.type('socks');
  expect(await leaf.query()).toBe('socks');
});

// Rule 2: declaration ambiguity is by where outcomes land; a fragment named "stay" does not land where `stay` does.
const Named = fragment('stay', { probe: byTestId('re-never') });
test('a fragment named stay is not taken for the stay outcome', () => {
  expect(() => leads({ here: stay, there: Named }, async () => {})).not.toThrow();
});
