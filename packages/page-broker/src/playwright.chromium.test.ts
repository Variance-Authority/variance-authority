import { existsSync } from 'node:fs';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { by } from './broker.js';
import { broker, stay, Unreached, type Members } from './index.js';
import { surface, type PageSurface } from './playwright.js';
import { cases } from './surfaces.cases.js';
import type { Query, Surface } from './surface.js';

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const ORIGIN = 'https://shop.test';

/**
 * A checkout that announces nothing. `?answer=` picks where Continue ends —
 * `elsewhere`, `window` and `help` are places no case declares: another
 * document, a new page and a modal dialog, `gone` the billing form hidden, `helpShown` a modal dialog on the
 * page hidden until then, `frame` is a frame inside the
 * page going to one, and `next` a new address for the same document —
 * `?after=` how long the server takes, `?open=` what is on the page before
 * anybody acts, `?stream` has Continue open a server-sent stream that never ends
 * and ask for a picture that never loads, and `?then=` has the page ask again
 * that long after the answer, for `?second=`.
 */
const CHECKOUT = `<!doctype html>
<main>
  <form aria-label="Billing"><label>Street <input name="street"></label><button>Continue</button></form>
  <form aria-label="Payment" hidden><p>Card number</p></form>
  <dialog aria-label="Sign in"><p>Who are you?</p></dialog>
  <div role="dialog" aria-modal="true" aria-label="Help" hidden><p>Need help?</p></div>
</main>
<script>
  const query = new URLSearchParams(location.search);
  const show = (answer) => {
    for (const part of answer.split(',')) {
      if (part === 'payment') document.querySelector('[aria-label=Payment]').hidden = false;
      if (part === 'signIn') document.querySelector('dialog').show();
      if (part === 'elsewhere') location.assign('/checkout/elsewhere');
      if (part === 'gone') document.querySelector('[aria-label=Billing]').hidden = true;
      if (part === 'next') history.pushState(null, '', '/checkout/next');
      if (part === 'window') window.open('about:blank');
      if (part === 'slowWindow') window.open('/slow');
      if (part === 'frame') document.body.appendChild(document.createElement('iframe')).src = '/checkout/frame';
      if (part === 'helpShown') document.querySelector('[aria-label=Help]').hidden = false;
      if (part === 'help') document.body.appendChild(document.createElement('dialog')).showModal();
      if (part === 'overlay') {
        const overlay = document.body.appendChild(document.createElement('div'));
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.textContent = 'Need help?';
      }
    }
  };
  show(query.get('open') ?? '');
  document.querySelector('form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (query.has('stream')) {
      new EventSource('/api/stream');
      new Image().src = '/api/picture';
    }
    const answer = await (await fetch('/api/billing' + location.search)).text();
    show(answer);
    if (query.has('then')) {
      await new Promise((done) => setTimeout(done, Number(query.get('then'))));
      show(await (await fetch('/api/again?answer=' + query.get('second'))).text());
    }
  });
</script>`;

let browser: Browser | undefined;
let page: Page;

const Payment = broker('payment', { probe: { role: 'form', name: 'Payment' } });
const SignIn = broker('signIn', { probe: { role: 'dialog', name: 'Sign in' } });
const outcomes = { payment: Payment, signIn: SignIn };
const click = (on: Surface): Promise<void> => on.click({ role: 'button', name: 'Continue' });
// The package's own means are 5000 ms and 500 ms; these keep the cases short.
const QUIET = 200;
const quick = by({ timeout: 2000, quiet: QUIET });
const brief = by({ timeout: 600, quiet: 100 });

/** The billing form with the members a case declares, found on `on`, the page's own surface unless given. */
function billing<const M extends Members>(actions: M, on: PageSurface = surface(page)) {
  return broker('billing', { probe: { role: 'form', name: 'Billing' }, actions }).on(on);
}

/** The page's surface, with one query's look replaced, to count the looks or answer one of them falsely. */
function looking(query: Query, look: (visible: () => Promise<unknown>) => Promise<unknown>): PageSurface {
  const base = surface(page);
  return {
    ...base,
    find: (asked) => {
      const found = base.find(asked);
      if (asked !== query) return found;
      return Object.assign(Object.create(found) as typeof found, {
        visible: () => look(() => found.visible()),
      });
    },
  };
}

async function open(query: string): Promise<void> {
  await page.goto(`${ORIGIN}/checkout?${query}`);
}

beforeAll(async () => {
  if (!BROWSER_AVAILABLE) return;
  browser = await chromium.launch({ headless: true });
});

// A page per case, on Playwright alone: the package stands on nothing else
// here, the harness's page pool included.
beforeEach(async () => {
  if (browser === undefined) return;
  page = await browser.newPage();
  await page.route(`${ORIGIN}/checkout**`, (route) =>
    route.fulfill({ contentType: 'text/html', body: CHECKOUT }),
  );
  // Another document, with no billing form on it.
  await page.route(`${ORIGIN}/checkout/elsewhere`, (route) =>
    route.fulfill({ contentType: 'text/html', body: '<main>Elsewhere</main>' }),
  );
  // Never answered: the stream stays in flight for as long as the page lives.
  await page.route(`${ORIGIN}/api/stream`, () => undefined);
  await page.route(`${ORIGIN}/api/picture`, () => undefined);
  await page.route(`${ORIGIN}/api/again**`, (route) =>
    // Slower than a quiet period: the deadline the first answer armed runs out with this in flight.
    setTimeout(() => {
      void route.fulfill({
        contentType: 'text/plain',
        body: new URL(route.request().url()).searchParams.get('answer') ?? '',
      });
    }, 2 * QUIET),
  );
  await page.route(`${ORIGIN}/api/billing**`, async (route) => {
    const query = new URL(route.request().url()).searchParams;
    await new Promise((done) => setTimeout(done, Number(query.get('after') ?? 0)));
    await route.fulfill({ contentType: 'text/plain', body: query.get('answer') ?? '' });
  });
});

afterEach(async () => {
  if (browser !== undefined) await page.close();
});

afterAll(async () => {
  await browser?.close();
});

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/page-broker: skipped.' + '\n  no browser — npx playwright install chromium\n',
  );
}

chromium_('a broker over a page that announces nothing', () => {
  it('returns the outcome the app reached, by its declared name, as that broker', async () => {
    await open('answer=signIn&after=50');
    const { submit } = await billing({ submit: quick(outcomes, click) });

    const reached = await submit();

    expect(reached.outcome).toBe('signIn');
    await expect((reached.at.root as Locator).getAttribute('aria-label')).resolves.toBe('Sign in');
  });

  it('fails a test that insisted on another outcome, naming the one reached', async () => {
    await open('answer=payment');
    const { submit } = await billing({ submit: quick(outcomes, click) });

    await expect(submit().to('signIn')).rejects.toThrow('billing.submit: expected signIn, reached payment');
  });

  it('hands the insisted broker back when it is the one reached', async () => {
    await open('answer=payment');
    const { submit } = await billing({ submit: quick(outcomes, click) });

    const payment = await submit().to('payment');

    await expect(payment.root.getAttribute('aria-label')).resolves.toBe('Payment');
  });

  it('does not report staying while a slower declared outcome is on its way', async () => {
    // The answer takes four quiet periods to come.
    await open('answer=payment&after=800');
    const { submit } = await billing({ submit: quick({ ...outcomes, refused: stay }, click) });

    await expect(submit()).resolves.toMatchObject({ outcome: 'payment' });
  });

  it('reports staying once the page has gone quiet with the broker still on it', async () => {
    await open('answer=nothing&after=100');
    const { submit } = await billing({ submit: quick({ ...outcomes, refused: stay }, click) });

    const started = Date.now();
    const reached = await submit();

    expect(reached.outcome).toBe('refused');
    await expect((reached.at.root as Locator).getAttribute('aria-label')).resolves.toBe('Billing');
    expect(Date.now() - started).toBeGreaterThanOrEqual(100 + QUIET);
  });

  it('begins the quiet period again when the page asks once more inside it', async () => {
    // The second request starts half a quiet period after the first answer.
    await open('answer=nothing&then=100&second=signIn');
    const { submit } = await billing({ submit: quick({ ...outcomes, refused: stay }, click) });

    await expect(submit()).resolves.toMatchObject({ outcome: 'signIn' });
  });

  it('reports staying for an action whose only outcome is to stay', async () => {
    await open('answer=nothing&after=100');
    const { submit } = await billing({ submit: quick({ refused: stay }, click) });

    await expect(submit()).resolves.toMatchObject({ outcome: 'refused' });
  });

  it('does not report staying when the broker left the page and nothing declared took its place', async () => {
    await open('answer=gone&after=50');
    const { submit } = await billing({ submit: brief({ refused: stay }, click) });

    await expect(submit()).rejects.toThrow(
      'billing.submit: billing left the page, and nothing declared took its place within 600 ms',
    );
  });

  it.each([
    ['elsewhere', 'the page went to /checkout/elsewhere'],
    ['window', 'a new page opened'],
    ['help', 'a modal dialog opened'],
    ['overlay', 'a modal dialog opened'],
  ])('fails, and does not report staying, when the app answered with %s, which is not declared', async (answer, where) => {
    await open(`answer=${answer}&after=50`);
    const { submit } = await billing({ submit: quick({ ...outcomes, refused: stay }, click) });

    const failed = await submit().catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(Unreached);
    expect(failed).toMatchObject({
      reason: 'elsewhere',
      action: 'billing.submit',
      message: `billing.submit: reached none of payment, signIn, and ${where}, which no outcome declares`,
    });
  });

  it('reports staying when the address changed and the broker is still on the page', async () => {
    await open('answer=next&after=50');
    const { submit } = await billing({ submit: quick({ ...outcomes, refused: stay }, click) });

    await expect(submit()).resolves.toMatchObject({ outcome: 'refused' });
    expect(new URL(page.url()).pathname).toBe('/checkout/next');
  });

  it('reports staying when only a frame inside the page went somewhere', async () => {
    await open('answer=frame&after=50');
    const { submit } = await billing({ submit: quick({ ...outcomes, refused: stay }, click) });

    await expect(submit()).resolves.toMatchObject({ outcome: 'refused' });
    expect(page.frames().map((frame) => new URL(frame.url()).pathname)).toContain('/checkout/frame');
  });

  it('looks again when the part it woke for is not there at the look', async () => {
    let looks = 0;
    await open('answer=signIn');
    const on = looking(SignIn.probe, async (visible) => {
      looks += 1;
      // The first look is before the act; the second is the one the arrival woke.
      return looks === 2 ? undefined : visible();
    });
    const { submit } = await billing({ submit: quick({ signIn: SignIn }, click) }, on);

    await expect(submit()).resolves.toMatchObject({ outcome: 'signIn' });
    expect(looks).toBe(3);
  });

  it('fails, and does not report staying, when the page it opened has not answered yet', async () => {
    // The new page's document takes three quiet periods to begin.
    await page.context().route(`${ORIGIN}/slow`, (route) =>
      // The case is over, and its context gone, before this answers.
      setTimeout(() => void route.fulfill({ contentType: 'text/html', body: 'slow' }).catch(() => undefined), 3 * QUIET),
    );
    await open('answer=slowWindow');
    const { submit } = await billing({ submit: quick({ ...outcomes, refused: stay }, click) });

    await expect(submit()).rejects.toThrow(
      'billing.submit: reached none of payment, signIn, and a new page opened, which no outcome declares',
    );
  });

  it('reaches a declared outcome on another document', async () => {
    await page.route(`${ORIGIN}/checkout/elsewhere`, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<form aria-label="Payment">Card number</form>' }),
    );
    await open('answer=elsewhere');
    const { submit } = await billing({ submit: quick(outcomes, click) });

    await expect(submit()).resolves.toMatchObject({ outcome: 'payment' });
  });

  it('reaches an outcome that stands after a hidden one in the page', async () => {
    // Probes that match their part while it is hidden, as a selector does.
    const payment = broker('payment', { probe: { css: '[aria-label=Payment]' } });
    const signIn = broker('signIn', { probe: { css: 'dialog' } });
    await open('answer=signIn&after=50');
    const { submit } = await billing({ submit: quick({ payment, signIn }, click) });

    await expect(submit()).resolves.toMatchObject({ outcome: 'signIn' });
  });

  it('does not report staying when the page asks again while the parts are looked at', async () => {
    let looks = 0;
    await open('answer=nothing');
    const on = looking(SignIn.probe, async (visible) => {
      looks += 1;
      // The second look is the one the quiet period woke.
      if (looks === 2) {
        // Started, not awaited: the answer is still on its way when the look ends.
        await page.evaluate(`void fetch('/api/again?answer=signIn').then((got) => got.text()).then(show)`);
      }
      return visible();
    });
    const { submit } = await billing({ submit: quick({ signIn: SignIn, refused: stay }, click) }, on);

    await expect(submit()).resolves.toMatchObject({ outcome: 'signIn' });
  });

  it('fails with what Playwright said when the page is gone before an outcome', async () => {
    await open('answer=payment');
    const { leave } = await billing({ leave: quick(outcomes, (on) => (on as PageSurface).native.close()) });

    await expect(leave()).rejects.toThrow(/closed/);
  });

  it('releases the page when the act fails, and fails with what the act threw', async () => {
    await open('answer=payment');
    const { submit } = await billing({
      submit: quick(outcomes, async () => {
        throw new Error('no such button');
      }),
    });

    await expect(submit()).rejects.toThrow('no such button');
    expect(page.listenerCount('request')).toBe(0);
  });

  it('does not wait for a stream the server never ends, or a picture that never loads', async () => {
    await open('answer=nothing&stream');
    const { submit } = await billing({ submit: quick({ ...outcomes, refused: stay }, click) });

    const started = Date.now();
    const reached = await submit();

    expect(reached.outcome).toBe('refused');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('fails, and does not report staying, when the page never went quiet in time', async () => {
    // The answer is still in flight when the time is up.
    await open('answer=payment&after=1500');
    const { submit } = await billing({ submit: brief({ ...outcomes, refused: stay }, click) });

    await expect(submit()).rejects.toThrow(
      'billing.submit: reached none of payment, signIn and the page did not go quiet within 600 ms: GET /api/billing still in flight',
    );
  });

  it('fails an action whose only outcome is to stay when the page never went quiet in time', async () => {
    await open('answer=nothing&after=1500');
    const { submit } = await billing({ submit: brief({ refused: stay }, click) });

    await expect(submit()).rejects.toThrow(
      'billing.submit: the page did not go quiet within 600 ms: GET /api/billing still in flight',
    );
  });

  it('fails at the timeout when no outcome is reached and none is to stay, naming the outcomes', async () => {
    await open('answer=nothing');
    const { submit } = await billing({ submit: brief(outcomes, click) });

    await expect(submit()).rejects.toThrow('billing.submit: reached none of payment, signIn within 600 ms');
  });

  it('fails when two declared outcomes are on the page at once', async () => {
    await open('answer=payment,signIn');
    const { submit } = await billing({ submit: quick(outcomes, click) });

    await expect(submit()).rejects.toThrow('billing.submit: reached payment and signIn at once');
  });

  it('refuses to act when a declared outcome is on the page before the action', async () => {
    let acted = false;
    await open('open=payment&answer=nothing');
    const { submit } = await billing({
      submit: quick(outcomes, async (on: Surface) => {
        acted = true;
        await click(on);
      }),
    });

    const failed = await submit().catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(Unreached);
    expect(failed).toMatchObject({
      reason: 'start',
      message: 'billing.submit: payment is on the page before the action, so it could not be arrived at',
    });
    expect(acted).toBe(false);
  });

  it('refuses to act when the broker has left the page since it was found', async () => {
    await open('answer=nothing');
    const { submit } = await billing({ submit: quick(outcomes, click) });
    await page.evaluate(`document.querySelector('[aria-label=Billing]').hidden = true`);

    await expect(submit()).rejects.toMatchObject({
      reason: 'start',
      message: 'billing.submit: starts from billing, and it is not on the page',
    });
  });

  it('passes what the test gave it on to the act', async () => {
    await open('answer=signIn');
    const { press } = await billing({
      press: quick(outcomes, (on: Surface, name: string) => on.click({ role: 'button', name })),
    });

    const signIn = await press('Continue').to('signIn');

    await expect(signIn.root.getAttribute('aria-label')).resolves.toBe('Sign in');
  });
});

chromium_('the shared cases, over a browser page', () => {
  cases(async (answer, after) => {
    await open(`answer=${answer}&after=${after}`);
    return surface(page);
  });
});
