import { existsSync } from 'node:fs';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { by } from './action.js';
import { action, stay } from './index.js';
import { requests } from './quiet.js';

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
 * document, a new page and a modal dialog —
 * `?after=` how long the server takes, `?open=` what is on the page before
 * anybody acts, `?stream` has Continue open a server-sent stream that never ends
 * and ask for a picture that never loads, and `?then=` has the page ask again
 * that long after the answer, for `?second=`.
 */
const CHECKOUT = `<!doctype html>
<main>
  <form aria-label="Billing"><button type="button">Continue</button></form>
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
      if (part === 'help') document.body.appendChild(document.createElement('dialog')).showModal();
    }
  };
  show(query.get('open') ?? '');
  document.querySelector('button').addEventListener('click', async () => {
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

const outcomes = {
  payment: (on: Page) => on.getByRole('form', { name: 'Payment' }),
  signIn: (on: Page) => on.getByRole('dialog', { name: 'Sign in' }),
};
const click = async (on: Page): Promise<void> => {
  await on.getByRole('button', { name: 'Continue' }).click();
};
// The package's own means are 5000 ms and 500 ms; these keep the cases short.
const QUIET = 200;
const quick = by({ timeout: 2000, quiet: requests(QUIET) });
const brief = by({ timeout: 600, quiet: requests(100) });

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
    expect(() => action('submit', { same: stay, still: stay }, click)).toThrow(
      'submit: same and still both stay',
    );
  });

  it('refuses an action with no outcome', () => {
    expect(() => action('submit', {}, click)).toThrow('submit: declares no outcome');
  });
});

chromium_('an action over a page that announces nothing', () => {
  it('returns the outcome the app reached, by its declared name', async () => {
    const submit = action('submit', outcomes, click);
    await open('answer=signIn&after=50');

    const reached = await submit(page);

    expect(reached.outcome).toBe('signIn');
    await expect(reached.at?.getAttribute('aria-label')).resolves.toBe('Sign in');
  });

  it('fails a test that insisted on another outcome, naming the one reached', async () => {
    const submit = quick('submit', outcomes, click);
    await open('answer=payment');

    await expect(submit(page).to('signIn')).rejects.toThrow(
      'submit: expected signIn, reached payment',
    );
  });

  it('hands the insisted outcome back when it is the one reached', async () => {
    const submit = quick('submit', outcomes, click);
    await open('answer=payment');

    await expect(submit(page).to('payment')).resolves.toMatchObject({ outcome: 'payment' });
  });

  it('does not report staying while a slower declared outcome is on its way', async () => {
    const submit = quick('submit', { ...outcomes, refused: stay }, click);
    // The answer takes four quiet periods to come.
    await open('answer=payment&after=800');

    await expect(submit(page)).resolves.toMatchObject({ outcome: 'payment' });
  });

  it('reports staying once the page has gone quiet with nothing declared on it', async () => {
    const submit = quick('submit', { ...outcomes, refused: stay }, click);
    await open('answer=nothing&after=100');

    const started = Date.now();
    const reached = await submit(page);

    expect(reached).toEqual({ outcome: 'refused', at: undefined });
    expect(Date.now() - started).toBeGreaterThanOrEqual(100 + QUIET);
  });

  it('begins the quiet period again when the page asks once more inside it', async () => {
    const submit = quick('submit', { ...outcomes, refused: stay }, click);
    // The second request starts half a quiet period after the first answer.
    await open('answer=nothing&then=100&second=signIn');

    await expect(submit(page)).resolves.toMatchObject({ outcome: 'signIn' });
  });

  it('reports staying for an action whose only outcome is to stay', async () => {
    const submit = quick('submit', { refused: stay }, click);
    await open('answer=nothing&after=100');

    await expect(submit(page)).resolves.toEqual({ outcome: 'refused', at: undefined });
  });

  it.each([
    ['elsewhere', 'the page went to /checkout/elsewhere'],
    ['window', 'a new page opened'],
    ['help', 'a modal dialog opened'],
  ])('fails, and does not report staying, when the app answered with %s, which is not declared', async (answer, where) => {
    const submit = quick('submit', { ...outcomes, refused: stay }, click);
    await open(`answer=${answer}&after=50`);

    await expect(submit(page)).rejects.toThrow(
      `submit: reached none of payment, signIn, and ${where}, which no outcome declares`,
    );
  });

  it('reaches a declared outcome on another document', async () => {
    const submit = quick('submit', outcomes, click);
    await page.route(`${ORIGIN}/checkout/elsewhere`, (route) =>
      route.fulfill({ contentType: 'text/html', body: '<form aria-label="Payment">Card number</form>' }),
    );
    await open('answer=elsewhere');

    await expect(submit(page)).resolves.toMatchObject({ outcome: 'payment' });
  });

  it('reaches an outcome that stands after a hidden one in the page', async () => {
    // Recognisers that match their part while it is hidden, as a selector does.
    const submit = quick(
      'submit',
      {
        payment: (on: Page) => on.locator('[aria-label=Payment]'),
        signIn: (on: Page) => on.locator('dialog'),
      },
      click);
    await open('answer=signIn&after=50');

    await expect(submit(page)).resolves.toMatchObject({ outcome: 'signIn' });
  });

  it('does not report staying when the page asks again while the parts are looked at', async () => {
    let looks = 0;
    const submit = quick(
      'submit',
      {
        signIn: (on: Page) => {
          const dialog = on.getByRole('dialog', { name: 'Sign in' });
          return Object.assign(Object.create(dialog) as typeof dialog, {
            isVisible: async () => {
              looks += 1;
              // The second look is the one the quiet period woke.
              if (looks === 2) {
                // Started, not awaited: the answer is still on its way when the look ends.
                await on.evaluate(`void fetch('/api/again?answer=signIn').then((got) => got.text()).then(show)`);
              }
              return dialog.isVisible();
            },
          });
        },
        refused: stay,
      },
      click);
    await open('answer=nothing');

    await expect(submit(page)).resolves.toMatchObject({ outcome: 'signIn' });
  });

  it('fails with what Playwright said when the page is gone before an outcome', async () => {
    const leave = quick('leave', outcomes, (on: Page) => on.close());
    await open('answer=payment');

    await expect(leave(page)).rejects.toThrow(/closed/);
  });

  it('releases the page when the act fails, and fails with what the act threw', async () => {
    const submit = quick(
      'submit',
      outcomes,
      async () => {
        throw new Error('no such button');
      });
    await open('answer=payment');

    await expect(submit(page)).rejects.toThrow('no such button');
    expect(page.listenerCount('request')).toBe(0);
  });

  it('does not wait for a stream the server never ends, or a picture that never loads', async () => {
    const submit = quick('submit', { ...outcomes, refused: stay }, click);
    await open('answer=nothing&stream');

    const started = Date.now();
    const reached = await submit(page);

    expect(reached.outcome).toBe('refused');
    expect(Date.now() - started).toBeLessThan(2000);
  });

  it('fails, and does not report staying, when the page never went quiet in time', async () => {
    const submit = brief('submit', { ...outcomes, refused: stay }, click);
    // The answer is still in flight when the time is up.
    await open('answer=payment&after=1500');

    await expect(submit(page)).rejects.toThrow(
      'submit: reached none of payment, signIn and the page did not go quiet within 600 ms: GET /api/billing still in flight',
    );
  });

  it('fails an action whose only outcome is to stay when the page never went quiet in time', async () => {
    const submit = brief('submit', { refused: stay }, click);
    await open('answer=nothing&after=1500');

    await expect(submit(page)).rejects.toThrow(
      'submit: the page did not go quiet within 600 ms: GET /api/billing still in flight',
    );
  });

  it('fails at the timeout when no outcome is reached and none is to stay, naming the outcomes', async () => {
    const submit = brief('submit', outcomes, click);
    await open('answer=nothing');

    await expect(submit(page)).rejects.toThrow(
      'submit: reached none of payment, signIn within 600 ms',
    );
  });

  it('fails when two declared outcomes are on the page at once', async () => {
    const submit = quick('submit', outcomes, click);
    await open('answer=payment,signIn');

    await expect(submit(page)).rejects.toThrow('submit: reached payment and signIn at once');
  });

  it('refuses to act when a declared outcome is already on the page', async () => {
    let acted = false;
    const submit = quick(
      'submit',
      outcomes,
      async (on: Page) => {
        acted = true;
        await click(on);
      });
    await open('open=payment&answer=payment');

    await expect(submit(page)).rejects.toThrow(
      'submit: payment is on the page before the action',
    );
    expect(acted).toBe(false);
  });

  it('passes what the test gave it on to the act', async () => {
    const press = quick(
      'press',
      outcomes,
      async (on: Page, name: string) => {
        await on.getByRole('button', { name }).click();
      });
    await open('answer=signIn');

    await expect(press(page, 'Continue').to('signIn')).resolves.toMatchObject({
      outcome: 'signIn',
    });
  });
});
