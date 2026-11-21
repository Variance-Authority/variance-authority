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
    <form aria-label="Billing">
      <label>Street <input name="street"></label>
      <label for="delivery">Delivery</label> <select id="delivery" name="delivery"><option value="standard">Standard</option><option value="express">Express</option></select>
      <label><input type="checkbox" name="gift"> Gift</label>
      <output data-testid="summary"></output>
      <button>Continue</button>
    </form>
    <form aria-label="Payment" hidden><p>Card number</p></form>
    <div role="dialog" aria-label="Sign in" hidden><p>Who are you?</p></div>
    <div role="dialog" aria-modal="true" aria-label="Help" hidden><p>Need help?</p></div>`;
  vi.stubGlobal('fetch', async (input: string) => {
    // A request the server never answers.
    if (input.endsWith('?hang')) await new Promise(() => undefined);
    // The server's latency, which the case is about: an answer that takes time.
    await new Promise((done) => setTimeout(done, after));
    return new Response(answer);
  });
  const billing = document.querySelector('form')!;
  const summarize = (): void => {
    const { street, delivery, gift } = billing.elements as unknown as Record<string, HTMLInputElement>;
    billing.querySelector('output')!.textContent = [street!.value, delivery!.value, gift!.checked ? 'gift' : '']
      .filter(Boolean)
      .join(' / ');
  };
  billing.addEventListener('input', summarize);
  billing.addEventListener('change', summarize);
  billing.addEventListener('submit', async (event) => {
    event.preventDefault();
    for (const said of (await (await fetch('/api/billing')).text()).split(',')) {
      const follow = (target?: string, to = '/checkout/elsewhere') => {
        const link = document.body.appendChild(document.createElement('a'));
        link.href = to;
        if (target) link.target = target;
        link.click();
      };
      if (said === 'alert') window.alert('Saved');
      if (said === 'link') follow();
      if (said === 'blank') follow('_blank');
      if (said === 'hash') follow('', '#billing');
      if (said === 'window') window.open('/checkout/elsewhere');
      if (said === 'hang') void fetch('/api/billing?hang');
      if (said === 'post') {
        const away = document.body.appendChild(document.createElement('form'));
        away.action = '/checkout/elsewhere';
        away.requestSubmit();
      }
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

  it('follows a request opened before the action and sent during it', () => {
    const request = new XMLHttpRequest();
    request.open('POST', '/api/billing');
    const quiet = surface(document).quiet(100);

    request.send();

    expect(quiet.held()).toBe('an XMLHttpRequest opened before the action still in flight');
    request.abort();
    quiet.stop();
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

  it('names a choice the field does not offer, and a query that matches more than the one part an act is for', async () => {
    checkout('nothing');
    const on = surface(document);

    await expect(on.select({ label: /Delivery/ }, 'overnight')).rejects.toThrow('{"label":"/Delivery/"} has no option overnight');
    await expect(on.click({ css: 'label' })).rejects.toThrow('{"css":"label"} matches 3 elements, and an act is for one');
  });

  it('acts on nothing that is not on the page or is disabled, once a person would have given up', async () => {
    checkout('nothing');
    document.querySelector('button')!.disabled = true;
    const on = surface(document);

    // Both waits run at once: each takes the whole wait to give up.
    await Promise.all([
      expect(on.click({ role: 'button', name: 'Continue' })).rejects.toThrow(
        '{"role":"button","name":"Continue"} is disabled after 5000 ms',
      ),
      expect(on.click({ text: 'Pay now' })).rejects.toThrow('{"text":"Pay now"} is not on the page after 5000 ms'),
    ]);
  }, 10_000);

  it('names where the app went at the timeout, when a request it left in flight kept the page from going quiet', async () => {
    checkout('link,hang');

    await expect((await Billing.on(surface(document))).submit()).rejects.toMatchObject({
      reason: 'elsewhere',
      message: 'billing.submit: reached none of payment, signIn, and a new document at /checkout/elsewhere, which no outcome declares',
    });
  });

  it('does not report staying while an XMLHttpRequest the action sent is in flight', async () => {
    checkout('nothing');
    /** A server reached by XMLHttpRequest that answers `payment` after three quiet periods. */
    class Request extends EventTarget {
      readonly OPENED = 1;
      readyState = 0;
      responseText = '';
      open(): void {
        this.readyState = this.OPENED;
      }
      send(): void {
        setTimeout(() => {
          this.readyState = 4;
          this.responseText = 'payment';
          this.dispatchEvent(new Event('load'));
          this.dispatchEvent(new Event('loadend'));
        }, 300);
      }
    }
    vi.stubGlobal('XMLHttpRequest', Request);
    const form = document.querySelector('form')!;
    form.replaceWith(form.cloneNode(true));
    document.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      const request = new XMLHttpRequest();
      request.open('POST', '/api/billing');
      request.addEventListener('load', () => {
        (document.querySelector('[aria-label=Payment]') as HTMLElement).hidden = request.responseText !== 'payment';
      });
      request.send();
    });
    const on = surface(document);
    const quiet = on.quiet(100);
    const reached = (await Billing.on(on)).submit();
    await new Promise((done) => setTimeout(done, 50));

    expect(quiet.held()).toBe('POST /api/billing still in flight');
    await expect(reached).resolves.toMatchObject({ outcome: 'payment' });
    quiet.stop();
  });

  it('does not follow a request sent without being opened, which the request refuses', () => {
    const quiet = surface(document).quiet(100);

    expect(() => new XMLHttpRequest().send()).toThrow(DOMException);

    expect(quiet.held()).toBeUndefined();
    quiet.stop();
  });

  it('hears the answer an app gives when its request failed', async () => {
    checkout('nothing');
    vi.stubGlobal('fetch', async () => {
      await new Promise((done) => setTimeout(done, 20));
      throw new TypeError('Failed to fetch');
    });
    const form = document.querySelector('form')!;
    form.replaceWith(form.cloneNode(true));
    document.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      fetch('/api/billing').catch(() => {
        (document.querySelector('[aria-label="Sign in"]') as HTMLElement).hidden = false;
      });
    });

    await expect((await Billing.on(surface(document))).submit()).resolves.toMatchObject({ outcome: 'signIn' });
  });

  it.each([
    ['no body', () => new Response(null)],
    ['a server-sent stream that never ends', () => new Response(new ReadableStream(), { headers: { 'content-type': 'text/event-stream' } })],
    [
      'a body that broke off',
      () =>
        new Response(
          new ReadableStream({
            pull(stream) {
              stream.error(new TypeError('network error'));
            },
          }),
        ),
    ],
  ])('hears the answer once a response with %s is in, without waiting on its body', async (_, response) => {
    checkout('nothing');
    vi.stubGlobal('fetch', async () => response());
    const form = document.querySelector('form')!;
    form.replaceWith(form.cloneNode(true));
    document.querySelector('form')!.addEventListener('submit', async (event) => {
      event.preventDefault();
      await fetch('/api/billing');
      (document.querySelector('[aria-label=Payment]') as HTMLElement).hidden = false;
    });

    await expect((await Billing.on(surface(document))).submit()).resolves.toMatchObject({ outcome: 'payment' });
  });

  it.each(['display: none', 'visibility: hidden'])('is not found where its probe is hidden by %s', async (style) => {
    document.body.innerHTML = `<div style="${style}"><p>Card number</p></div>`;

    await expect(broker('card', { probe: { text: 'Card number' } }).on(surface(document))).rejects.toMatchObject({
      reason: 'start',
      message: 'card: not on the page',
    });
  });

  it('refuses an action that declares no outcome: it could never be told it arrived', () => {
    expect(() => leads({}, async () => undefined)).toThrow('leads: declares no outcome');
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
