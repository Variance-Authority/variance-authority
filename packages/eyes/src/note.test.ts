import { afterEach, describe, expect, it } from 'vitest';
import { createEyesLog, type TargetSnapshot } from './access.js';
import { noteOf } from './note.js';

const NOTE = Symbol.for('variance-authority.story.note');
const scope = globalThis as { [NOTE]?: unknown };

const button = (owner?: string): TargetSnapshot => ({
  nodeName: 'BUTTON',
  id: 'save',
  name: 'Save',
  provenance: (owner === undefined
    ? { status: 'unavailable' }
    : { status: 'resolved', provenance: { owners: [{ name: owner }] } }) as unknown as TargetSnapshot['provenance'],
});

afterEach(() => {
  delete scope[NOTE];
});

describe('what Eyes says to a story', () => {
  it('names the query with its arguments and what it found, down to the component that drew it', () => {
    expect(noteOf({ kind: 'rtl-query', query: 'getByRole', arguments: ['button', { name: 'Save' }], outcome: 'resolved', targets: [button('SaveBar')] }))
      .toBe('eyes getByRole("button", {"name":"Save"}) → button#save "Save" in SaveBar');
    expect(noteOf({ kind: 'rtl-query', query: 'queryByText', arguments: [{ kind: 'regexp', source: 'total', flags: 'i' }], outcome: 'absent' }))
      .toBe('eyes queryByText(/total/i) → absent');
    expect(noteOf({ kind: 'rtl-query', query: 'getAllByRole', arguments: ['row'], outcome: 'resolved', targets: [] }))
      .toBe('eyes getAllByRole("row") → nothing');
  });

  it('names a locator chain, an event and whether it was synthetic, a commit and a phase', () => {
    expect(noteOf({
      kind: 'playwright-locator',
      operation: 'action',
      member: 'click',
      locator: [{ member: 'getByRole', arguments: ['button'] }, { member: 'first', arguments: [] }],
      outcome: 'resolved',
      after: [button()],
    })).toBe('eyes getByRole("button").first().click → button#save "Save"');
    expect(noteOf({ kind: 'document-event', event: 'click', trusted: false, target: button('SaveBar') }))
      .toBe('eyes click (synthetic) on button#save "Save" in SaveBar');
    expect(noteOf({ kind: 'eyes-phase', phase: 'act' })).toBe('eyes act');
  });

  it('is said to the recorder in the realm when one listens, and a recorder that throws reaches nobody', () => {
    const said: string[] = [];
    scope[NOTE] = (text: string) => said.push(text);
    const log = createEyesLog();
    log.phase('arrange');
    scope[NOTE] = () => {
      throw new Error('the recorder is broken');
    };
    expect(() => log.phase('act')).not.toThrow();
    expect([said, log.seen.length]).toEqual([['eyes arrange'], 2]);
  });
});
