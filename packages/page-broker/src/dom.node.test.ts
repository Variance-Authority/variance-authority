// @vitest-environment node
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { broker, leads, stay } from './index.js';
import { surface } from './dom.js';

/**
 * A document a test opens itself with `new JSDOM`, in a Node test: its window
 * is not the global one, and Node's global has no `alert` or `open`.
 */
describe('page-broker over a document the test opened itself', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reaches an outcome when only the document’s own window can open a dialog', async () => {
    const { window } = new JSDOM(`
      <form aria-label="Billing"><button>Continue</button></form>
      <div role="dialog" aria-label="Sign in" hidden><p>Who are you?</p></div>`);
    const document = window.document;
    document.querySelector('form')!.addEventListener('submit', (event) => {
      event.preventDefault();
      (document.querySelector('[role=dialog]') as HTMLElement).hidden = false;
    });
    const signIn = broker('signIn', { probe: { role: 'dialog', name: 'Sign in' } });
    const billing = broker('billing', {
      probe: { role: 'form', name: 'Billing' },
      actions: { submit: leads({ signIn, stay }, (on) => on.click({ role: 'button', name: 'Continue' })) },
    });

    await expect((await billing.on(surface(document))).submit()).resolves.toMatchObject({ outcome: 'signIn' });
  });

  it('names a request as the app wrote it, where the document has no address to resolve it against', () => {
    vi.stubGlobal('fetch', () => new Promise(() => undefined));
    const { window } = new JSDOM('');
    const quiet = surface(window.document).quiet(100);

    void fetch('/api/billing');

    expect(quiet.held()).toBe('GET /api/billing still in flight');
    quiet.stop();
  });
});
