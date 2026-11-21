import { checked } from '@variance-authority/sense/checked';
import { submit } from '../src/form';

// Stands for a check the case body reaches through a helper of this file.
function verify(sent: { readonly title: string }): void {
  checked('create-event/helper-title', () => expect(sent.title).toBe('Launch')); // helper check
}

describe('create-event', () => {
  it('submits the form', () => { // bypassing case
    const sent = submit({ title: 'Launch ', draft: true });
    if (sent.draft) return;
    checked('create-event/submitted-title', () => expect(sent.title).toBe('Launch')); // bypassed check
  });

  it('publishes the form', () => { // entering case
    const sent = submit({ title: 'Launch ', draft: false });
    if (sent.draft) return;
    checked('create-event/published-title', () => expect(sent.title).toBe('Launch')); // entered check
  });

  it('verifies through a helper', () => { // helper case
    const sent = submit({ title: 'Launch ', draft: true });
    if (sent.draft) return;
    verify(sent); // helper call
  });
});
