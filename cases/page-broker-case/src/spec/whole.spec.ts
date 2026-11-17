// Parts agree with the whole: every arrival that keeps a fragment keeps it, and
// every fragment it keeps, with every part showing, or the page departs.
import { byRole, byTestId, fragment, leads, over, stay } from '../broker/broker.js';
import { expect, test } from '../fixture.js';
import { Billing } from '../shop.js';

const form = byRole('form', 'Billing details');
// A part that removes itself and declares it stays has left, though its owner shows.
const Vanisher = fragment('vanisher', {
  probe: byTestId('vanisher'),
  actions: { vanish: leads({ here: stay }, (d) => d.click(byRole('button', 'Vanish'))) },
  reads: { label: (r) => r.texts(byRole('button')) },
});
const Holding = fragment('billing-holding', { probe: form, uses: { vanisher: Vanisher } });

test('a part gone after a lead that stays departs, though its owner shows', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div data-testid="vanisher"><button>Vanish</button></div>');
    document.querySelector('[data-testid="vanisher"] button')!.addEventListener('click', () => document.querySelector('[data-testid="vanisher"]')!.remove());
  });
  const holding = await app.enter(Holding);
  expect(await holding.vanisher.label()).toEqual(['Vanish']);
  await expect(holding.vanisher.vanish()).rejects.toThrow('vanisher.vanish declares here');
  await expect(holding.vanisher.label()).rejects.toThrow('vanisher departed at vanisher.vanish');
});

// Parts agree with the whole: a part the page does not show fails the entry, before any handle exists.
const Ghost = fragment('ghost', { probe: byTestId('ghost'), reads: { lines: (r) => r.texts(byRole('listitem')) } });
const Haunted = fragment('billing-haunted', { probe: form, uses: { ghost: Ghost } });

test('a fragment whose part is missing is not entered', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  await expect(app.enter(Haunted)).rejects.toThrow('entered expecting billing-haunted, and its part ghost is missing');
});

// A cover is what the action opened: one already entered did not arrive, and a second handle would split its lifecycle.
const Banner = fragment('banner-cover', { probe: byRole('banner'), actions: { type: (d, q: string) => d.fill(byRole('searchbox', 'Search'), q) } });
const Opener = fragment('billing-opener', { probe: form, actions: { open: leads({ bar: over(Banner) }, async () => {}) } });

test('a cover already entered does not arrive again', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const banner = await app.enter(Banner);
  const opener = await app.enter(Opener);
  await expect(opener.open.to('bar')).rejects.toThrow('billing-opener.open reached banner-cover over billing-opener, and banner-cover was entered before it opened');
  await banner.type('socks');
  await opener.open.to('bar').catch(() => {});
  expect(await app.enter(Banner)).toBe(banner);
});

// A stay keeps the whole only with its parts: a part gone is the page changed, and the stay is refused.
const Keeper = fragment('form-keeper', {
  probe: form,
  uses: { vanisher: Vanisher },
  actions: { drop: leads({ here: stay }, (d) => d.click(byRole('button', 'Drop'))), quietly: (d) => d.click(byRole('button', 'Drop')) },
});

test('an outcome that stays while a part leaves is refused, and the page departs', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  await app.enter(Billing);
  await page.evaluate(() => {
    const part = Object.assign(document.createElement('div'), { textContent: 'v' });
    part.dataset.testid = 'vanisher';
    const drop = Object.assign(document.createElement('button'), { textContent: 'Drop', type: 'button' });
    drop.onclick = () => part.remove();
    document.querySelector('form[aria-label="Billing details"]')!.append(part, drop);
  });
  const keeper = await app.enter(Keeper);
  await expect(keeper.drop.to('here')).rejects.toThrow('form-keeper.drop stayed, and its part vanisher is missing');
  await expect(keeper.quietly() as unknown as Promise<unknown>).rejects.toThrow('departed');
});

// A cover is witnessed opening: one that showed before the action did not arrive by it.
test('a cover that showed before the action does not arrive by it', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const opener = await app.enter(Opener);
  await expect(opener.open.to('bar')).rejects.toThrow('billing-opener.open reached banner-cover over billing-opener, and banner-cover showed before it');
  await opener.open.to('bar').catch(() => {});
});

// A part that stays keeps every owner whole: a sibling part gone is the page changed.
const Remover = fragment('remover', {
  probe: byTestId('remover'),
  actions: { drop: (d) => d.click(byRole('button', 'Drop')), dropTo: leads({ here: stay }, (d) => d.click(byRole('button', 'Drop'))) },
});
const Pair = fragment('form-pair', { probe: form, uses: { vanisher: Vanisher, remover: Remover } });

for (const how of ['drop', 'dropTo'] as const) {
  test(`a part that stays while its sibling leaves is refused (${how})`, async ({ page, app }) => {
    await page.goto('/checkout?user=member', { waitUntil: 'commit' });
    await app.enter(Billing);
    await page.evaluate(() => {
      const form = document.querySelector('form[aria-label="Billing details"]')!;
      form.insertAdjacentHTML('beforeend', '<div data-testid="vanisher">v</div><div data-testid="remover"><button type="button">Drop</button></div>');
      form.querySelector('[data-testid="remover"] button')!.addEventListener('click', () => form.querySelector('[data-testid="vanisher"]')!.remove());
    });
    const pair = await app.enter(Pair);
    const act = how === 'drop' ? pair.remover.drop() : pair.remover.dropTo.to('here');
    await expect(act as unknown as Promise<unknown>).rejects.toThrow("and form-pair's part vanisher is missing");
    await expect(pair.remover.drop() as unknown as Promise<unknown>).rejects.toThrow('departed');
  });
}

// Every arrival that keeps a fragment keeps it whole, going back and opening a cover alike.
test('going back to a fragment whose part left with the cover departs the page, the cover included', async ({ page, app }) => {
  await page.goto('/checkout?user=guest', { waitUntil: 'commit' });
  const form = await app.enter(Billing);
  const signIn = await form.country('NL').street('Damrak 1').submit.to('signIn');
  await page.evaluate(() => {
    const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!;
    cancel.addEventListener('click', () => document.querySelector('header')!.remove());
  });
  await expect(signIn.cancel.to('billing')).rejects.toThrow('sign-in.cancel reached billing, and its part header is missing');
  await expect(signIn.email('a@b.c') as unknown as Promise<unknown>).rejects.toThrow('departed');
  await expect(form.address()).rejects.toThrow('departed');
});

test('opening a cover over a fragment whose part left departs the page', async ({ page, app }) => {
  await page.goto('/checkout?user=guest', { waitUntil: 'commit' });
  const form = await app.enter(Billing);
  await page.evaluate(() => {
    const go = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Continue')!;
    go.addEventListener('click', () => document.querySelector('header')!.remove());
  });
  await expect(form.country('NL').street('Damrak 1').submit.to('signIn')).rejects.toThrow('billing.submit opened sign-in, and its part header is missing');
  await expect(form.address()).rejects.toThrow('departed');
});

// Going back restores the whole page beneath the cover, every fragment entered there, not only the one it covered.
const Watched = fragment('banner-watched', { probe: byRole('banner'), uses: { ghost: Ghost } });

test('going back while another restored fragment lost its part departs the page', async ({ page, app }) => {
  await page.goto('/checkout?user=guest', { waitUntil: 'commit' });
  const form = await app.enter(Billing);
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div data-testid="ghost"><ul><li>boo</li></ul></div>'));
  const watched = await app.enter(Watched);
  const signIn = await form.country('NL').street('Damrak 1').submit.to('signIn');
  await page.evaluate(() => {
    const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!;
    cancel.addEventListener('click', () => document.querySelector('[data-testid="ghost"]')!.remove());
  });
  await expect(signIn.cancel.to('billing')).rejects.toThrow("sign-in.cancel went back to billing, and banner-watched's part ghost is missing");
  await expect(watched.ghost.lines()).rejects.toThrow('departed');
  await expect(form.address()).rejects.toThrow('departed');
});

const Watcher = fragment('watcher', { probe: byTestId('watcher'), reads: { text: (r) => r.texts(byRole('listitem')) } });

test('going back while another restored fragment left departs the page', async ({ page, app }) => {
  await page.goto('/checkout?user=guest', { waitUntil: 'commit' });
  const form = await app.enter(Billing);
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div data-testid="watcher"><ul><li>here</li></ul></div>'));
  const watcher = await app.enter(Watcher);
  const signIn = await form.country('NL').street('Damrak 1').submit.to('signIn');
  await page.evaluate(() => {
    const cancel = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Cancel')!;
    cancel.addEventListener('click', () => document.querySelector('[data-testid="watcher"]')!.remove());
  });
  await expect(signIn.cancel.to('billing')).rejects.toThrow('sign-in.cancel went back to billing, and watcher is gone');
  await expect(watcher.text()).rejects.toThrow('departed');
});

// Only `back` uncovers: a plain lead to what a cover covers is a new arrival, and every handle beneath departs.
const homeward: Record<string, ReturnType<typeof fragment>> = {};
const Exit = fragment('exit-cover', { probe: byTestId('exit'), actions: { leave: leads(homeward, (d) => d.click(byRole('button', 'Leave'))) } });
const Door = fragment('billing-door', { probe: form, actions: { open: leads({ exit: over(Exit) }, (d) => d.click(byRole('button', 'Open exit'))) } });
homeward.door = Door;

test('a plain lead to what a cover covers revokes the handles beneath, and hands a fresh one', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  const door = await app.enter(Door);
  await page.evaluate(() => {
    document.body.insertAdjacentHTML('beforeend', '<div data-testid="watcher"><ul><li>here</li></ul></div>');
    const form = document.querySelector('form[aria-label="Billing details"]')!;
    form.insertAdjacentHTML('beforeend', '<button type="button" data-open-exit>Open exit</button>');
    form.querySelector('[data-open-exit]')!.addEventListener('click', () => {
      document.body.insertAdjacentHTML('beforeend', '<div data-testid="exit"><button type="button">Leave</button></div>');
      document.querySelector('[data-testid="exit"] button')!.addEventListener('click', () => {
        document.querySelector('[data-testid="exit"]')!.remove();
        document.querySelector('[data-testid="watcher"]')!.remove();
      });
    });
  });
  const watcher = await app.enter(Watcher);
  const exit = await door.open.to('exit');
  const again = await exit.leave.to('door');
  expect(again).not.toBe(door);
  await expect(watcher.text()).rejects.toThrow('departed at exit-cover.leave');
});

// Two outcomes showing are two only when both are whole: a probe with a part missing is not that fragment.
const LaneA = fragment('lane-a', { probe: byTestId('lane-a') });
const LaneB = fragment('lane-b', { probe: byTestId('lane-b'), uses: { ghost: Ghost } });
const Fork = fragment('billing-fork', { probe: form, actions: { go: leads({ a: LaneA, b: LaneB }, (d) => d.click(byRole('button', 'Go'))) } });

test('an outcome whose probe shows without its parts does not make the arrival ambiguous', async ({ page, app }) => {
  await page.goto('/checkout?user=member', { waitUntil: 'commit' });
  await page.evaluate(() => {
    const form = document.querySelector('form[aria-label="Billing details"]')!;
    form.insertAdjacentHTML('beforeend', '<button type="button" data-go>Go</button>');
    form.querySelector('[data-go]')!.addEventListener('click', () => {
      form.remove();
      document.body.insertAdjacentHTML('beforeend', '<div data-testid="lane-a">a</div><div data-testid="lane-b">b</div>');
    });
  });
  const fork = await app.enter(Fork);
  expect(await fork.go.to('a')).toBeDefined();
});

test('opening a cover while another fragment beneath lost its part departs the page', async ({ page, app }) => {
  await page.goto('/checkout?user=guest', { waitUntil: 'commit' });
  const form = await app.enter(Billing);
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div data-testid="ghost"><ul><li>boo</li></ul></div>'));
  const watched = await app.enter(Watched);
  await page.evaluate(() => {
    const go = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Continue')!;
    go.addEventListener('click', () => document.querySelector('[data-testid="ghost"]')!.remove());
  });
  await expect(form.country('NL').street('Damrak 1').submit.to('signIn')).rejects.toThrow("billing.submit opened sign-in, and banner-watched's part ghost is missing");
  await expect(watched.ghost.lines()).rejects.toThrow('departed');
  await expect(form.address()).rejects.toThrow('departed');
});
