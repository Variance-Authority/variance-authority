// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { surface } from './dom.js';
import { by } from './broker.js';
import { broker, leads, stay, Unreached } from './index.js';
import { cases } from './surfaces.cases.js';

/**
 * A checkout drawn in the test's own document, announcing nothing. `answer` is
 * what the server says Continue leads to, and `after` how long it takes.
 */
function checkout(answer: string, after = 20): void {
  document.body.innerHTML = `
    <form aria-label="Billing"><label>Street <input name="street"></label><button>Continue</button></form>
    <form aria-label="Payment" hidden><p>Card number</p></form>
    <div role="dialog" aria-label="Sign in" hidden><p>Who are you?</p></div>
    <div role="dialog" aria-modal="true" aria-label="Help" hidden><p>Need help?</p></div>`;
  vi.stubGlobal('fetch', async () => {
    // The server's latency, which the case is about: an answer that takes time.
    await new Promise((done) => setTimeout(done, after));
    return new Response(answer);
  });
  document.querySelector('form')!.addEventListener('submit', async (event) => {
    event.preventDefault();
    for (const said of (await (await fetch('/api/billing')).text()).split(',')) {
      if (said === 'payment') (document.querySelector('[aria-label=Payment]') as HTMLElement).hidden = false;
      if (said === 'signIn') (document.querySelector('[role=dialog]') as HTMLElement).hidden = false;
      if (said === 'helpShown') (document.querySelector('[aria-label=Help]') as HTMLElement).hidden = false;
      if (said === 'help') {
        const help = document.body.appendChild(document.createElement('div'));
        help.setAttribute('role', 'dialog');
        help.setAttribute('aria-modal', 'true');
      }
      if (said === 'elsewhere' || said === 'gone') (document.querySelector('[aria-label=Billing]') as HTMLElement).hidden = true;
      if (said === 'elsewhere') history.pushState(null, '', '/help');
      if (said === 'next') history.pushState(null, '', '/checkout/next');
    }
  });
}

const quick = by({ timeout: 1000, quiet: 100 });
const Payment = broker('payment', { probe: { role: 'form', name: 'Payment' } });
const SignIn = broker('signIn', { probe: { role: 'dialog', name: 'Sign in' } });
const Billing = broker('billing', {
  probe: { role: 'form', name: 'Billing' },
  actions: {
    submit: quick({ payment: Payment, signIn: SignIn, invalid: stay }, (on) => on.click({ role: 'button', name: 'Continue' })),
  },
});

describe('page-broker over a document', () => {
  beforeEach(() => {
    history.replaceState(null, '', '/checkout');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('hands back the outcome reached as its broker, rooted at the element found', async () => {
    checkout('payment');

    const reached = await (await Billing.on(surface(document))).submit();

    expect(reached.outcome).toBe('payment');
    expect(reached.at.root).toBe(document.querySelector('[aria-label=Payment]'));
  });

  it('fails an app that went somewhere no outcome declares, with the failure value', async () => {
    checkout('elsewhere');

    const failed = await (await Billing.on(surface(document))).submit().catch((error: unknown) => error);

    expect(failed).toBeInstanceOf(Unreached);
    expect(failed).toMatchObject({ action: 'billing.submit', reason: 'elsewhere', went: 'the page went to /help' });
  });

  it('refuses to act once the broker it was found as has left the page', async () => {
    checkout('payment');
    const billing = await Billing.on(surface(document));
    (document.querySelector('[aria-label=Billing]') as HTMLElement).hidden = true;

    await expect(billing.submit()).rejects.toMatchObject({
      reason: 'start',
      message: 'billing.submit: starts from billing, and it is not on the page',
    });
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

  it("does not report staying while a fetch's body is still arriving after its headers", async () => {
    checkout('payment');
    vi.stubGlobal('fetch', async () => {
      const body = new ReadableStream<Uint8Array>({
        start(stream) {
          // Three quiet periods after the headers: the answer is in the body.
          setTimeout(() => {
            stream.enqueue(new TextEncoder().encode('payment'));
            stream.close();
          }, 300);
        },
      });
      return new Response(body);
    });

    await expect((await Billing.on(surface(document))).submit()).resolves.toMatchObject({ outcome: 'payment' });
  });

  it('leaves an ARIA checkbox that is already checked as it is', async () => {
    document.body.innerHTML = `<div role="checkbox" aria-checked="true" aria-label="Terms" tabindex="0"></div>`;
    const box = document.querySelector('[role=checkbox]')!;
    box.addEventListener('click', () => box.setAttribute('aria-checked', String(box.getAttribute('aria-checked') !== 'true')));

    await surface(document).check({ role: 'checkbox', name: 'Terms' });

    expect(box.getAttribute('aria-checked')).toBe('true');
  });

  it('looks for no outcome once the action has answered', async () => {
    checkout('nothing');
    const on = surface(document);
    let looks = 0;
    const counted = {
      ...on,
      find: (query: Parameters<typeof on.find>[0]) => {
        const target = on.find(query);
        return {
          ...target,
          visible: async () => {
            looks += 1;
            return target.visible();
          },
        };
      },
    };

    await expect((await Billing.on(counted)).submit()).resolves.toMatchObject({ outcome: 'invalid' });
    const answered = looks;
    // Nothing announces a look that does not happen: six polls' time is the window it would fall in.
    await new Promise((done) => setTimeout(done, 300));

    expect(looks).toBe(answered);
  });

  it('declares through the default means too', () => {
    expect(leads({ idle: stay }, async () => undefined).means).toEqual({ timeout: 5000, quiet: 500 });
  });

  it('refuses a member named root: root is what the surface found', () => {
    expect(() => broker('billing', { probe: { text: 'x' }, actions: { root: async () => undefined } })).toThrow(
      'billing: root is what the surface found, and names no member',
    );
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
