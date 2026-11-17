// Arriving again: a new document, a cover reloading under itself, and a part that was on the page before its cover.
import { back, byLabel, byRole, byTestId, fragment, leads, over, stay, stays } from '../broker/broker.js';
import { expect, test } from '../fixture.js';
import { Header, Payment } from '../shop.js';

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

const Named = fragment('stay', { probe: byTestId('re-never') });
test('a fragment named stay is not taken for the stay outcome', () => {
  expect(() => leads({ here: stay, there: Named }, async () => {})).not.toThrow();
});

// A page reloaded under an action, and a step that fails.

// A form whose Open button opens the cover by loading a new document, and a cover that can reload under itself.
const reloading = `<!doctype html><meta charset="utf-8">
<form aria-label="Reloading form"><label>Name <input name="n"></label><button type="button" id="open">Open</button><button type="button" id="openload">Open by reload</button><button type="button" id="leave">Leave</button></form>
<div id="c" data-testid="rx-cover" hidden><button type="button" id="reload">Reload</button><button type="button" id="close">Close</button></div>
<script>
const c = document.getElementById('c');
if (sessionStorage.rxopen) c.hidden = false;
document.getElementById('open').onclick = () => { sessionStorage.rxopen = '1'; c.hidden = false; };
document.getElementById('openload').onclick = () => { sessionStorage.rxopen = '1'; location.reload(); };
document.getElementById('leave').onclick = () => document.querySelector('form').remove();
document.getElementById('reload').onclick = () => location.reload();
document.getElementById('close').onclick = () => { delete sessionStorage.rxopen; c.hidden = true; };
</script>`;

const Extra = fragment('rx-extra', { probe: byTestId('rx-extra'), reads: { text: (r) => r.texts(byRole('listitem')) } });
const ReloadCover = fragment('rx-cover', {
  probe: byTestId('rx-cover'),
  actions: { reload: stays((d) => d.click(byRole('button', 'Reload'))), close: leads({ form: back }, (d) => d.click(byRole('button', 'Close'))) },
});
const ReloadForm = fragment('rx-form', {
  probe: byRole('form', 'Reloading form'),
  actions: {
    open: leads({ cover: over(ReloadCover) }, (d) => d.click(byRole('button', 'Open'))),
    openByReload: leads({ cover: over(ReloadCover) }, (d) => d.click(byRole('button', 'Open by reload'))),
    leave: leads({ extra: Extra }, (d) => d.click(byRole('button', 'Leave'))),
  },
  reads: { name: (r) => r.value(byLabel('Name')) },
});

const open = async (page: import('@playwright/test').Page) => {
  await page.route('**/rxdoc', (route) => route.fulfill({ contentType: 'text/html', body: reloading }));
  await page.goto('/rxdoc');
};
const addExtra = (page: import('@playwright/test').Page) =>
  page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div data-testid="rx-extra"><ul><li>x</li></ul></div>'));

test('a cover that arrives on a new document has no owner beneath it, and is refused', async ({ page, app }) => {
  await open(page);
  const form = await app.enter(ReloadForm);
  await expect(form.openByReload.to('cover')).rejects.toThrow('rx-form.openByReload reached rx-cover over rx-form, and rx-form is gone');
});

// The handles that left with the old document are not "what that cover covered" any more.
test('back after the page left while covered arrives anew, whatever else stood on the old page', async ({ page, app }) => {
  await open(page);
  const form = await app.enter(ReloadForm);
  await addExtra(page);
  await app.enter(Extra);
  const cover = await form.open.to('cover');
  await cover.reload();
  const again = await cover.close.to('form');
  expect(again).not.toBe(form);
});

const Absent = fragment('rx-missing', { probe: byTestId('rx-missing') });
const Partial = fragment('rx-partial', { probe: byTestId('rx-partial'), uses: { missing: Absent } });
const Holder = fragment('rx-holder', {
  probe: byRole('form', 'Reloading form'),
  actions: { go: leads({ partial: Partial }, (d) => d.click(byRole('button', 'Open'))) },
  reads: { name: (r) => r.value(byLabel('Name')) },
});

test('an outcome showing without its parts is not reached, and the fragment that never left keeps its handle', async ({ page, app }) => {
  await open(page);
  await page.evaluate(() => {
    document.getElementById('open')!.addEventListener('click', () => document.body.insertAdjacentHTML('beforeend', '<div data-testid="rx-partial">p</div>'));
  });
  const holder = await app.enter(Holder);
  const failed = await holder.go().then(() => 'resolved', (error: Error) => error.message);
  expect(failed).not.toContain('reached r3-partial');
  expect(await holder.name()).toBe('');
});

test('a lead to a fragment already entered and still showing hands back its one handle', async ({ page, app }) => {
  await open(page);
  await addExtra(page);
  const extra = await app.enter(Extra);
  const form = await app.enter(ReloadForm);
  const arrived = await form.leave.to('extra');
  expect(arrived).toBe(extra);
  expect(await extra.text()).toEqual(['x']);
});

test('a step that fails still lands in the journal', async ({ page, app }) => {
  await open(page);
  const form = await app.enter(ReloadForm);
  await page.evaluate(() => (document.getElementById('open')!.onclick = null));
  await form.open.to('cover').catch(() => {});
  expect(app.journal.at(-1)).toMatchObject({ from: 'rx-form', action: 'open', failed: expect.stringContaining('rx-form.open declares cover') });
});

// A lead to a fragment already live keeps it whole: the part it shares with what left answers to it alone.
const Shared = fragment('sx-shared', { probe: byTestId('sx-shared'), actions: { ping: (d) => d.click(byRole('button', 'Ping')) } });
const Kept = fragment('sx-kept', { probe: byTestId('sx-kept'), uses: { shared: Shared } });
const Leaving = fragment('sx-leaving', {
  probe: byTestId('sx-leaving'),
  uses: { shared: Shared },
  actions: { go: leads({ kept: Kept }, (d) => d.click(byRole('button', 'Go'))) },
});
const sharing = async (page: import('@playwright/test').Page) => {
  await open(page);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div data-testid="sx-leaving"><button type="button">Go</button></div><div data-testid="sx-kept">k</div><div data-testid="sx-shared"><button type="button">Ping</button></div>',
    );
    document.querySelector('[data-testid="sx-leaving"] button')!.addEventListener('click', () => document.querySelector('[data-testid="sx-leaving"]')!.remove());
  });
};

for (const first of ['leaving', 'kept'] as const) {
  test(`a lead to a fragment already live keeps its shared part, the one that left entered ${first === 'leaving' ? 'first' : 'second'}`, async ({ page, app }) => {
    await sharing(page);
    const before = first === 'leaving' ? await app.enter(Leaving) : undefined;
    const kept = await app.enter(Kept);
    const leaving = before ?? (await app.enter(Leaving));
    const arrived = await leaving.go.to('kept');
    expect(arrived).toBe(kept);
    await expect(kept.shared.ping()).resolves.toBeDefined();
  });
}

test('an action refused on a departed handle still lands in the journal', async ({ page, app }) => {
  await sharing(page);
  const leaving = await app.enter(Leaving);
  await leaving.go.to('kept');
  await expect(leaving.go()).rejects.toThrow('sx-leaving departed at sx-leaving.go');
  expect(app.journal.at(-1)).toMatchObject({ from: 'sx-leaving', action: 'go', failed: expect.stringContaining('has nothing to act on') });
});

const Solo = fragment('sx-solo', {
  probe: byTestId('sx-leaving'),
  uses: { shared: Shared },
  actions: { go: leads({ shared: Shared }, (d) => d.click(byRole('button', 'Go'))) },
  reads: { label: (r) => r.texts(byRole('button')) },
});

test('a lead from an owner to its own part, the owner gone, keeps the part and departs the owner', async ({ page, app }) => {
  await sharing(page);
  const solo = await app.enter(Solo);
  const arrived = await solo.go.to('shared');
  expect(arrived).toBe(solo.shared);
  await expect(solo.label()).rejects.toThrow('sx-solo departed at sx-solo.go');
  await expect(arrived.ping()).resolves.toBeDefined();
});

const Broken = fragment('sx-broken', {
  probe: byTestId('sx-leaving'),
  actions: {
    snap: async (d) => {
      await d.click(byRole('button', 'Go'));
      await d.click(byRole('button', 'Nowhere'));
    },
  },
  reads: { label: (r) => r.texts(byRole('button')) },
});

test('an action that fails after its fragment left still departs it', async ({ page, app }) => {
  await sharing(page);
  const broken = await app.enter(Broken);
  await expect(broken.snap()).rejects.toThrow();
  await expect(broken.label()).rejects.toThrow('sx-broken departed at sx-broken.snap');
});

// A failed action that took a part with it leaves its fragment unwhole: the handle departs, even though the fragment still shows.
const Piece = fragment('sx-piece', { probe: byTestId('sx-piece') });
const Cut = fragment('sx-cut', {
  probe: byTestId('sx-cut'),
  uses: { piece: Piece },
  actions: {
    cut: async (d) => {
      await d.click(byRole('button', 'Cut'));
      await d.click(byRole('button', 'Nowhere'));
    },
  },
  reads: { label: (r) => r.texts(byRole('button')) },
});

test('an action that fails after taking a part departs its fragment', async ({ page, app }) => {
  await open(page);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div data-testid="sx-cut"><button type="button">Cut</button><div data-testid="sx-piece">p</div></div>');
    document.querySelector('[data-testid="sx-cut"] button')!.addEventListener('click', () => document.querySelector('[data-testid="sx-piece"]')!.remove());
  });
  const cut = await app.enter(Cut);
  await expect(cut.cut()).rejects.toThrow();
  await expect(cut.label()).rejects.toThrow('sx-cut departed at sx-cut.cut');
});
