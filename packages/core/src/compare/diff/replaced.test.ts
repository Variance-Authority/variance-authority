import { describe, expect, it } from 'vitest';
import { normalize } from '../../rules/normalize/index.js';
import { capture, node } from '../../rules/normalize/fixture.js';
import { diffSnapshots } from './index.js';
import type { RawCapture } from '../../format/capture.js';

const diff = (before: RawCapture, after: RawCapture) => diffSnapshots(normalize(before), normalize(after));

/**
 * A pair across two tags.
 *
 * Whatever paired them — the one replacement its author recorded, a declared
 * alias, or one role and name — the element changed, and the diff says so first.
 */
describe('an element whose tag changed', () => {
  it('reports an element its author replaced as one node, saying what it became', () => {
    // todomvc's broken toggle: `Toggle` renders a `<div>` where it rendered a
    // checkbox. Reported as one removal and one addition, the replacement is two
    // unrelated nodes; reported as a changed pair that says only its box moved,
    // it reads as a small edit. It is neither: the tag and the role changed.
    const row = (control: ReturnType<typeof node>) =>
      capture({
        root: node({
          tag: 'li',
          owners: [{ name: 'TodoItem' }],
          createdBy: 'TodoItem',
          children: [control, node({ tag: 'span', text: 'Milk', owners: [{ name: 'TodoItem' }], createdBy: 'TodoItem' })],
        }),
      });
    const toggle = { owners: [{ name: 'Toggle' }, { name: 'TodoItem' }], createdBy: 'Toggle' };

    const result = diff(
      row(node({ tag: 'input', role: 'checkbox', name: 'Done', ...toggle })),
      row(node({ tag: 'div', rules: [{ selector: '.toggle', declare: { border: '1px solid' } }], ...toggle })),
    );

    expect(result.deltas.filter((delta) => delta.kind === 'node-added' || delta.kind === 'node-removed')).toEqual([]);
    expect(result.deltas.find((delta) => delta.kind === 'tag-changed')).toMatchObject({
      path: '0/0',
      from: 'input',
      to: 'div',
      band: 'geometry',
      createdBy: 'Toggle',
    });
    expect(result.deltas.find((delta) => delta.kind === 'role-changed')).toMatchObject({ from: 'checkbox', to: undefined });
    expect(result.roots.map((root) => root.label)).toEqual(['Toggle']);
  });

  it('says the tag changed on a pair its role and name joined', () => {
    // `matchKey` pairs one role and name across tags, so a native button and a
    // `div` with the button role are one node. Its box and its name did not move;
    // the element did, and without the tag the pair would report nothing.
    const toolbar = (control: ReturnType<typeof node>) =>
      capture({ root: node({ tag: 'nav', owners: [{ name: 'Toolbar' }], children: [control] }) });

    const result = diff(
      toolbar(node({ tag: 'button', role: 'button', name: 'Save', owners: [{ name: 'Toolbar' }] })),
      toolbar(node({ tag: 'div', role: 'button', name: 'Save', owners: [{ name: 'Toolbar' }] })),
    );

    expect(result.deltas.map((delta) => delta.kind)).toEqual(['tag-changed']);
    expect(result.deltas[0]).toMatchObject({ path: '0/0', from: 'button', to: 'div' });
  });
});
