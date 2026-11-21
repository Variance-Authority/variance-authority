// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surface } from './dom.js';
import { action, region, stay, Unreached } from './index.js';
import { by } from './model.js';
import { cases } from './surfaces.cases.js';

/**
 * A checkout drawn in the test's own document, announcing nothing. `answer` is
 * what the server says Continue leads to, and `after` how long it takes.
 */
function checkout(answer: string, after = 20): void {
  document.body.innerHTML = `
    <form aria-label="Billing"><label>Street <input name="street"></label><button>Continue</button></form>
    <form aria-label="Payment" hidden><p>Card number</p></form>
    <div role="dialog" aria-label="Sign in" hidden><p>Who are you?</p></div>`;
  vi.stubGlobal('fetch', async () => {
    // The server's latency, which the case is about: an answer that takes time.
    await new Promise((done) => setTimeout(done, after));
    return new Response(answer);
  });
  document.querySelector('form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    const said = await (await fetch('/api/billing')).text();
    if (said === 'payment') (document.querySelector('[aria-label=Payment]') as HTMLElement).hidden = false;
    if (said === 'signIn') (document.querySelector('[role=dialog]') as HTMLElement).hidden = false;
    if (said === 'help') {
      const help = document.body.appendChild(document.createElement('div'));
      help.setAttribute('role', 'dialog');
      help.setAttribute('aria-modal', 'true');
    }
    if (said === 'elsewhere') history.pushState(null, '', '/help');
  });
}

const billing = region('billing', { role: 'form', name: 'Billing' });
const payment = region('payment', { role: 'form', name: 'Payment' });
const signIn = region('signIn', { role: 'dialog', name: 'Sign in' });

const quick = by({ timeout: 1000, quiet: 100 });
const submit = quick(
  'submit',
  { from: billing, to: { payment, signIn, invalid: stay } },
  (s) => s.click({ role: 'button', name: 'Continue' }),
);

describe('page-broker over a document', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/checkout');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands back the element of the outcome reached', async () => {
    checkout('payment');

    const reached = await submit(surface(document));

    expect(reached.outcome).toBe('payment');
    expect(reached.at).toBe(document.querySelector('[aria-label=Payment]'));
  });

  it('fails an app that went somewhere no outcome declares, with the failure value', async () => {
    checkout('elsewhere');

    const failed = await submit(surface(document)).catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(Unreached);
    expect(failed).toMatchObject({ action: 'submit', reason: 'elsewhere', went: 'the page went to /help' });
  });

  it('refuses to start where its starting region is not', async () => {
    checkout('payment');
    (document.querySelector('[aria-label=Billing]') as HTMLElement).hidden = true;

    await expect(submit(surface(document))).rejects.toMatchObject({ reason: 'start' });
  });

  it('reports an outcome already on the page as reached once quiet, when it is still there', async () => {
    checkout('nothing');
    const typing = quick('type', { to: { billing } }, (s, words: string) => s.fill({ label: 'Street' }, words));

    await expect(typing(surface(document), 'Damrak 1')).resolves.toMatchObject({ outcome: 'billing' });
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('Damrak 1');
  });

  it('refuses an outcome already on the page beside staying: the two could not be told apart', async () => {
    checkout('nothing');
    const typing = quick('type', { to: { billing, idle: stay } }, (s) => s.fill({ label: 'Street' }, 'x'));

    await expect(typing(surface(document))).rejects.toThrow('type: billing is on the page before the action, and idle stays');
  });

  it('puts back every global it followed, however many actions overlap on the document', async () => {
    const { open, send } = XMLHttpRequest.prototype;
    const { fetch: fetching } = globalThis;
    const opening = window.open;
    const on = surface(document);

    const first = [on.quiet(100), await on.elsewhere()];
    const second = [on.quiet(100), await on.elsewhere()];
    for (const each of first) each.stop();
    for (const each of second) each.stop();

    expect(XMLHttpRequest.prototype.open).toBe(open);
    expect(XMLHttpRequest.prototype.send).toBe(send);
    expect(globalThis.fetch).toBe(fetching);
    expect(window.open).toBe(opening);
  });

  it('follows a request on behalf of every action overlapping it', async () => {
    checkout('payment', 50);
    const on = surface(document);
    const first = on.quiet(100);
    const second = on.quiet(100);

    void fetch('/api/billing');

    expect(first.held()).toBe('GET /api/billing still in flight');
    expect(second.held()).toBe('GET /api/billing still in flight');
    first.stop();
    second.stop();
  });

  it('declares through the default means too', () => {
    expect(action('noop', { to: { idle: stay } }, async () => undefined).declared.outcomes).toEqual(['idle']);
  });
});

describe('the shared cases, over a document', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/checkout');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  cases(async (answer, after) => {
    checkout(answer, after);
    return surface(document);
  });
});
