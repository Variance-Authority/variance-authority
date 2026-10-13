import { describe, expect, it } from 'vitest';
import type { SemanticNode } from '../../format/snapshot.js';
import { matchTrees } from './match.js';

/**
 * A component that swaps its own output.
 *
 * todomvc's broken toggle: `Toggle` renders a `<div>` where it rendered an
 * `<input type="checkbox">`. The two share no identity key — one is a named
 * checkbox, the other a bare `div` — so neither content nor identity pairs them.
 * What does is the record of who wrote them: one element left and one arrived
 * under the same parent, and the same component created both.
 */

function element(
  path: string,
  tag: string,
  createdBy: string | undefined,
  extra: Partial<SemanticNode> = {},
): SemanticNode {
  return {
    path,
    tag,
    attributes: {},
    style: {},
    children: [],
    provenance: {
      owners: [{ name: 'TodoItem', propsDigest: 'v1:a' }],
      ...(createdBy !== undefined ? { createdBy } : {}),
    },
    ...extra,
  };
}

function row(...children: SemanticNode[]): SemanticNode {
  return { ...element('0', 'li', 'TodoItem'), children };
}

const checkbox = (path: string, createdBy = 'Toggle') =>
  element(path, 'input', createdBy, { role: 'checkbox', name: 'Done' });
const box = (path: string, createdBy = 'Toggle') => element(path, 'div', createdBy);
const label = (path: string) => element(path, 'span', 'TodoItem', { text: 'Milk' });

describe('an element its author replaced', () => {
  it('pairs the one element that left with the one its author rendered instead', () => {
    const before = row(checkbox('0/0'), label('0/1'));
    const after = row(box('0/0'), label('0/1'));

    const matching = matchTrees(before, after);

    expect(matching.pairs.get(before.children[0]!)).toBe(after.children[0]);
    expect(matching.added).toEqual([]);
    expect(matching.removed).toEqual([]);
  });

  it('leaves two replacements by one author unpaired, since either could be either', () => {
    const before = row(checkbox('0/0'), checkbox('0/1'), label('0/2'));
    const after = row(box('0/0'), box('0/1'), label('0/2'));

    const matching = matchTrees(before, after);

    expect(matching.removed).toEqual(before.children.slice(0, 2));
    expect(matching.added).toEqual(after.children.slice(0, 2));
  });

  it('does not pair an element with one a different component wrote', () => {
    const before = row(checkbox('0/0'), label('0/1'));
    const after = row(box('0/0', 'Badge'), label('0/1'));

    const matching = matchTrees(before, after);

    expect(matching.removed).toEqual([before.children[0]]);
    expect(matching.added).toEqual([after.children[0]]);
  });

  it('does not pair two elements whose own names say they are different ones', () => {
    // Every `<Button>` is created by `Button`. A toolbar that drops its Save
    // button for an Export one did not rename a button: pass 2 already read
    // both names and found two elements.
    const save = element('0/0', 'button', 'Button', { role: 'button', name: 'Save' });
    const exportLink = element('0/0', 'a', 'Button', { role: 'link', name: 'Export' });
    const before = row(save, label('0/1'));
    const after = row(exportLink, label('0/1'));

    const matching = matchTrees(before, after);

    expect(matching.removed).toEqual([save]);
    expect(matching.added).toEqual([exportLink]);
  });

  it('does not pair elements whose author was not recorded', () => {
    const before = row(element('0/0', 'input', undefined, { role: 'checkbox', name: 'Done' }), label('0/1'));
    const after = row(element('0/0', 'div', undefined), label('0/1'));

    const matching = matchTrees(before, after);

    expect(matching.removed).toEqual([before.children[0]]);
    expect(matching.added).toEqual([after.children[0]]);
  });

  it('walks into the pair, so what the replacement holds is compared too', () => {
    const before = row({ ...checkbox('0/0'), children: [label('0/0/0')] });
    const after = row({ ...box('0/0'), children: [label('0/0/0')] });

    const matching = matchTrees(before, after);

    expect(matching.pairs.get(before.children[0]!.children[0]!)).toBe(after.children[0]!.children[0]);
  });
});
