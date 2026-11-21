import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { action, region, stay, Unreached } from './index.js';
import { by } from './model.js';
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
 * document, a new page and a modal dialog, and `frame` is a frame inside the
 * page going to one —
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
</main>
<script>
  const query = new URLSearchParams(location.search);
  const show = (answer) => {
    for (const part of answer.split(',')) {
      if (part === 'payment') document.querySelector('[aria-label=Payment]').hidden = false;
      if (part === 'signIn') document.querySelector('dialog').show();
      if (part === 'elsewhere') location.assign('/checkout/elsewhere');
      if (part === 'window') window.open('about:blank');
      if (part === 'slowWindow') window.open('/slow');
      if (part === 'frame') document.body.appendChild(document.createElement('iframe')).src = '/checkout/frame';
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

const payment = region('payment', { role: 'form', name: 'Payment' });
const signIn = region('signIn', { role: 'dialog', name: 'Sign in' });
const outcomes = { payment, signIn };
const click = (on: Surface): Promise<void> => on.click({ role: 'button', name: 'Continue' });
// The package's own means are 5000 ms and 500 ms; these keep the cases short.
const QUIET = 200;
const quick = by({ timeout: 2000, quiet: QUIET });
const brief = by({ timeout: 600, quiet: 100 });

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

describe('declaring an action', () => {
  it('refuses two outcomes that both stay, since nothing tells them apart', () => {
    expect(() => action('submit', { to: { same: stay, still: stay } }, click)).toThrow(
      'submit: same and still both stay',
    );
  });

  it('refuses an action with no outcome', () => {
    expect(() => action('submit', { to: {} }, click)).toThrow('submit: declares no outcome');
  });
});

chromium_('an action over a page that announces nothing', () => {
  it('returns the outcome the app reached, by its declared name', async () => {
    const submit = action('submit', { to: outcomes }, click);
    await open('answer=signIn&after=50');

    const reached = await submit(surface(page));

    expect(reached.outcome).toBe('signIn');
    await expect(reached.at?.getAttribute('aria-label')).resolves.toBe('Sign in');
  });

  it('fails a test that insisted on another outcome, naming the one reached', async () => {
    const submit = quick('submit', { to: outcomes }, click);
    await open('answer=payment');

    await expect(submit(surface(page)).to('signIn')).rejects.toThrow(
      'submit: expected signIn, reached payment',
    );
  });

  it('hands the insisted outcome back when it is the one reached', async () => {
    const submit = quick('submit', { to: outcomes }, click);
    await open('answer=payment');

    await expect(submit(surface(page)).to('payment')).resolves.toMatchObject({ outcome: 'payment' });
  });

  it('does not report staying while a slower declared outcome is on its way', async () => {
    const submit = quick('submit', { to: { ...outcomes, refused: stay } }, click);
    // The answer takes four quiet periods to come.
    await open('answer=payment&after=800');

    await expect(submit(surface(page))).resolves.toMatchObject({ outcome: 'payment' });
  });

  it('reports staying once the page has gone quiet with nothing declared on it', async () => {
    const submit = quick('submit', { to: { ...outcomes, refused: stay } }, click);
    await open('answer=nothing&after=100');

    const started = Date.now();
    const reached = await submit(surface(page));

    expect(reached).toEqual({ outcome: 'refused', at: undefined });
    expect(Date.now() - started).toBeGreaterThanOrEqual(100 + QUIET);
  });

  it('begins the quiet period again when the page asks once more inside it', async () => {
    const submit = quick('submit', { to: { ...outcomes, refused: stay } }, click);
    // The second request starts half a quiet period after the first answer.
    await open('answer=nothing&then=100&second=signIn');

    await expect(submit(surface(page))).resolves.toMatchObject({ outcome: 'signIn' });
  });

  it('reports staying for an action whose only outcome is to stay', async () => {
    const submit = quick('submit', { to: { refused: stay } }, click);
    await open('answer=nothing&after=100');

    await expect(submit(surface(page))).resolves.toEqual({ outcome: 'refused', at: undefined });
  });

  it.each([
    ['elsewhere', 'the page went to /checkout/elsewhere'],
    ['window', 'a new page opened'],
    ['help', 'a modal dialog opened'],
    ['overlay', 'a modal dialog opened'],
  ])('fails, and does not report staying, when the app answered with %s, which is not declared', async (answer, where) => {
    const submit = quick('submit', { to: { ...outcomes, refused: stay } }, click);
    await open(`answer=${answer}&after=50`);

    await expect(submit(surface(page))).rejects.toThrow(
      `submit: reached none of payment, signIn, and ${where}, which no outcome declares`,
    );
  });

  it('reports staying when only a frame inside the page went somewhere', async () => {
    const submit = quick('submit', { to: { ...outcomes, refused: stay } }, click);
    await open('answer=frame&after=50');

    await expect(submit(surface(page))).resolves.toEqual({ outcome: 'refused', at: undefined });
    expect(page.frames().map((frame) => new URL(frame.url()).pathname)).toContain('/checkout/frame');
  });

  it('looks again when the part it woke for is not there at the look', async () => {
    let looks = 0;
    const submit = quick('submit', { to: { signIn } }, click);
    await open('answer=signIn');
    const on = looking(signIn.query, async (visible) => {
      looks += 1;
      // The first look is before the act; the second is the one the arrival woke.
      return looks === 2 ? undefined : visible();
    });

    await expect(submit(on)).resolves.toMatchObject({ outcome: 'signIn' });
    expect(looks).toBe(3);
  });

  it('fails, and does not report staying, when the page it opened has not answered yet', async () => {
    const submit = quick('submit', { to: { ...outcomes, refused: stay } }, click);
    // The new page's document takes three quiet periods to begin.
    await page.context().route(`${ORIGIN}/slow`, (route) =>
      // The case is over, and its context gone, before this answers.
      setTimeout(() => void route.fulfill({ contentType: 'text/html', body: 'slow' }).catch(() => undefined), 3 * QUIET),
    );
    await open('answer=slowWindow');

    await expect(submit(surface(page))).rejects.toThrow(
      'submit: reached none of payment, signIn, and a new page opened, which no outcome declares',
    );
  });

  it('reaches a declared outcome on another document', async () => {
    const submit = quick('submit', { to: outcomes }, click);
    await page.route(`${ORIGIN}/checkout/elsewhere`, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<form aria-label="Payment">Card number</form>' }),
    );
    await open('answer=elsewhere');

    await expect(submit(surface(page))).resolves.toMatchObject({ outcome: 'payment' });
  });

  it('reaches an outcome that stands after a hidden one in the page', async () => {
    // Queries that match their part while it is hidden, as a selector does.
    const submit = quick(
      'submit',
      {
        to: {
          payment: region('payment', { css: '[aria-label=Payment]' }),
          signIn: region('signIn', { css: 'dialog' }),
        },
      },
      click,
    );
    await open('answer=signIn&after=50');

    await expect(submit(surface(page))).resolves.toMatchObject({ outcome: 'signIn' });
  });

  it('does not report staying when the page asks again while the parts are looked at', async () => {
    let looks = 0;
    const submit = quick('submit', { to: { signIn, refused: stay } }, click);
    await open('answer=nothing');
    const on = looking(signIn.query, async (visible) => {
      looks += 1;
      // The second look is the one the quiet period woke.
      if (looks === 2) {
        // Started, not awaited: the answer is still on its way when the look ends.
        await page.evaluate(`void fetch('/api/again?answer=signIn').then((got) => got.text()).then(show)`);
      }
      return visible();
    });

    await expect(submit(on)).resolves.toMatchObject({ outcome: 'signIn' });
  });

  it('fails with what Playwright said when the page is gone before an outcome', async () => {
    const leave = quick('leave', { to: outcomes }, (on: PageSurface) => on.native.close());
    await open('answer=payment');

    await expect(leave(surface(page))).rejects.toThrow(/closed/);
  });

  it('releases the page when the act fails, and fails with what the act threw', async () => {
    const submit = quick('submit', { to: outcomes }, async () => {
      throw new Error('no such button');
    });
    await open('answer=payment');

    await expect(submit(surface(page))).rejects.toThrow('no such button');
    expect(page.listenerCount('request')).toBe(0);
  });

  it('does not wait for a stream the server never ends, or a picture that never loads', async () => {
    const submit = quick('submit', { to: { ...outcomes, refused: stay } }, click);
    await open('answer=nothing&stream');

    const started = Date.now();
    const reached = await submit(surface(page));

    expect(reached.outcome).toBe('refused');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('fails, and does not report staying, when the page never went quiet in time', async () => {
    const submit = brief('submit', { to: { ...outcomes, refused: stay } }, click);
    // The answer is still in flight when the time is up.
    await open('answer=payment&after=1500');

    await expect(submit(surface(page))).rejects.toThrow(
      'submit: reached none of payment, signIn and the page did not go quiet within 600 ms: GET /api/billing still in flight',
    );
  });

  it('fails an action whose only outcome is to stay when the page never went quiet in time', async () => {
    const submit = brief('submit', { to: { refused: stay } }, click);
    await open('answer=nothing&after=1500');

    await expect(submit(surface(page))).rejects.toThrow(
      'submit: the page did not go quiet within 600 ms: GET /api/billing still in flight',
    );
  });

  it('fails at the timeout when no outcome is reached and none is to stay, naming the outcomes', async () => {
    const submit = brief('submit', { to: outcomes }, click);
    await open('answer=nothing');

    await expect(submit(surface(page))).rejects.toThrow(
      'submit: reached none of payment, signIn within 600 ms',
    );
  });

  it('fails when two declared outcomes are on the page at once', async () => {
    const submit = quick('submit', { to: outcomes }, click);
    await open('answer=payment,signIn');

    await expect(submit(surface(page))).rejects.toThrow('submit: reached payment and signIn at once');
  });

  it('rests at a declared outcome already on the page once the page is quiet with it still there', async () => {
    let acted = false;
    const submit = quick('submit', { to: outcomes }, async (on: Surface) => {
      acted = true;
      await click(on);
    });
    await open('open=payment&answer=nothing');

    await expect(submit(surface(page))).resolves.toMatchObject({ outcome: 'payment' });
    expect(acted).toBe(true);
  });

  it('reaches the other outcome when the app answers away from the one it rested at', async () => {
    const submit = quick('submit', { to: outcomes }, click);
    await open('open=payment&answer=signIn');

    await expect(submit(surface(page))).resolves.toMatchObject({ outcome: 'signIn' });
  });

  it('refuses to act when a resting outcome and staying could not be told apart', async () => {
    let acted = false;
    const submit = quick('submit', { to: { ...outcomes, refused: stay } }, async (on: Surface) => {
      acted = true;
      await click(on);
    });
    await open('open=payment&answer=payment');

    await expect(submit(surface(page))).rejects.toThrow(
      'submit: payment is on the page before the action, and refused stays, so they could not be told apart',
    );
    expect(acted).toBe(false);
  });

  it('refuses to act when it does not start where it is declared to', async () => {
    const billing = region('billing', { role: 'form', name: 'Billing' });
    const pay = quick('pay', { from: payment, to: { billing } }, click);
    await open('answer=nothing');

    const failed = await pay(surface(page)).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(Unreached);
    expect(failed).toMatchObject({ reason: 'start', message: 'pay: starts from payment, and none is on the page' });
  });

  it('passes what the test gave it on to the act', async () => {
    const press = quick('press', { to: outcomes }, (on: Surface, name: string) =>
      on.click({ role: 'button', name }),
    );
    await open('answer=signIn');

    await expect(press(surface(page), 'Continue').to('signIn')).resolves.toMatchObject({
      outcome: 'signIn',
    });
  });
});

chromium_('the shared cases, over a browser page', () => {
  cases(async (answer, after) => {
    await open(`answer=${answer}&after=${after}`);
    return surface(page);
  });
});
