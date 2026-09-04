import { describe, expect, it } from 'vitest';
import type { SemanticNode } from '../format/snapshot.js';
import { nodeClosures, sharedClosures, type NodeClosure } from './closure.js';

/**
 * A closure is content-addressed and position-free, and the two grains keep
 * shape apart from content. Every test below is a way one of those could be
 * false, and the pair that matters most is the one asserting that a generated
 * id neither joins two different widgets nor parts two identical ones.
 */

interface Spec {
  readonly tag: string;
  readonly alias?: string;
  readonly role?: string;
  readonly name?: string;
  readonly text?: string;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly style?: Readonly<Record<string, string>>;
  readonly children?: readonly Spec[];
}

function tree(spec: Spec, path = '0'): SemanticNode {
  return {
    path,
    tag: spec.tag,
    ...(spec.alias === undefined ? {} : { alias: spec.alias }),
    ...(spec.role === undefined ? {} : { role: spec.role }),
    ...(spec.name === undefined ? {} : { name: spec.name }),
    ...(spec.text === undefined ? {} : { text: spec.text }),
    attributes: spec.attributes ?? {},
    style: spec.style ?? {},
    children: (spec.children ?? []).map((child, index) => tree(child, `${path}/${index}`)),
  };
}

const rootOf = (spec: Spec, path?: string): NodeClosure => nodeClosures(tree(spec, path))[0]!;

const field = (alias: string, reference: string): Spec => ({
  tag: 'div',
  children: [
    { tag: 'label', attributes: { for: reference }, text: 'Name' },
    { tag: 'input', alias, attributes: { type: 'text' } },
  ],
});

describe('nodeClosures', () => {
  it('lists one closure per node in document order, counting the nodes beneath', () => {
    const closures = nodeClosures(tree({ tag: 'ul', children: [{ tag: 'li' }, { tag: 'li', children: [{ tag: 'b' }] }] }));
    expect(closures.map((closure) => [closure.path, closure.tag, closure.nodes])).toEqual([
      ['0', 'ul', 4],
      ['0/0', 'li', 1],
      ['0/1', 'li', 2],
      ['0/1/0', 'b', 1],
    ]);
  });

  it('is position-free: the same subtree at another path in another document is one key', () => {
    const here = rootOf({ tag: 'p', text: 'hi' }, '0/3/1');
    const there = rootOf({ tag: 'p', text: 'hi' }, '2');
    expect(there.structure).toBe(here.structure);
    expect(there.semantics).toBe(here.semantics);
  });

  it('keeps shape apart from content: attributes and text part the semantics closure only', () => {
    const plain = rootOf({ tag: 'button', text: 'Save' });
    const named = rootOf({ tag: 'button', text: 'Delete', attributes: { type: 'submit' } });
    expect(named.structure).toBe(plain.structure);
    expect(named.semantics).not.toBe(plain.semantics);
  });

  it('moves the structure closure of every ancestor when a leaf changes tag', () => {
    const before = nodeClosures(tree({ tag: 'div', children: [{ tag: 'p', children: [{ tag: 'b' }] }] }));
    const after = nodeClosures(tree({ tag: 'div', children: [{ tag: 'p', children: [{ tag: 'i' }] }] }));
    expect(after.map((closure) => closure.structure === before[0]!.structure)).toEqual([false, false, false]);
    expect(after[1]!.structure).not.toBe(before[1]!.structure);
  });

  it('reads a generated id as presence, and a reference as the pair it binds', () => {
    const first = rootOf(field('#a0', '#a0'));
    const later = rootOf(field('#a7', '#a7'));
    expect(later.semantics).toBe(first.semantics);

    const elsewhere = rootOf(field('#a0', '#a4'));
    expect(elsewhere.structure).toBe(first.structure);
    expect(elsewhere.semantics).not.toBe(first.semantics);

    const unlabelled = rootOf({ tag: 'div', children: [{ tag: 'label', text: 'Name' }, { tag: 'input', attributes: { type: 'text' } }] });
    expect(unlabelled.semantics).not.toBe(first.semantics);
  });

  it('binds a reference where the closure first holds both ends, and leaves the label itself alone', () => {
    const pair = (reference: string): Spec => ({
      tag: 'div',
      children: [
        { tag: 'label', attributes: { for: reference }, text: 'Name' },
        { tag: 'input', alias: '#a0' },
        { tag: 'input', alias: '#a1' },
      ],
    });
    const [toFirst, labelOfFirst] = nodeClosures(tree(pair('#a0')));
    const [toSecond, labelOfSecond] = nodeClosures(tree(pair('#a1')));
    expect(toSecond!.semantics).not.toBe(toFirst!.semantics);
    expect(labelOfSecond!.semantics).toBe(labelOfFirst!.semantics);
  });

  it('carries an unbound reference up to the root, where it stays a different fact from a bound one', () => {
    const bound = rootOf({ tag: 'main', children: [field('#a0', '#a0')] });
    const dangling = rootOf({ tag: 'main', children: [field('#a0', '#a9')] });
    expect(dangling.semantics).not.toBe(bound.semantics);
  });

  it('qualifies each member of a reference list on its own', () => {
    const both = rootOf({
      tag: 'section',
      attributes: { 'aria-labelledby': '#a0 #a1' },
      children: [{ tag: 'h2', alias: '#a0' }, { tag: 'p', alias: '#a1' }],
    });
    const one = rootOf({
      tag: 'section',
      attributes: { 'aria-labelledby': '#a0 #a9' },
      children: [{ tag: 'h2', alias: '#a0' }, { tag: 'p', alias: '#a1' }],
    });
    expect(one.semantics).not.toBe(both.semantics);
  });

  it('lets style into neither closure', () => {
    const plain = rootOf({ tag: 'p', text: 'x' });
    const styled = rootOf({ tag: 'p', text: 'x', style: { color: 'red' } });
    expect(styled.structure).toBe(plain.structure);
    expect(styled.semantics).toBe(plain.semantics);
  });
});

describe('sharedClosures', () => {
  const row = (label: string): Spec => ({ tag: 'tr', children: [{ tag: 'td', text: label }, { tag: 'td', text: 'x' }] });
  const table = (...labels: readonly string[]): Spec => ({ tag: 'table', children: [{ tag: 'tbody', children: labels.map(row) }] });

  it('reports a whole page rendered twice once, at the root', () => {
    const shared = sharedClosures([
      { subject: 'a', root: tree(table('1', '2')) },
      { subject: 'b', root: tree(table('1', '2')) },
    ]);
    expect(shared.map((entry) => [entry.tag, entry.nodes, entry.semantics])).toEqual([['table', 8, 'held']]);
    expect(shared[0]!.sites).toEqual([{ subject: 'a', path: '0' }, { subject: 'b', path: '0' }]);
  });

  it('reports a subtree at the widest node that recurs, under different parents', () => {
    const shared = sharedClosures([
      { subject: 'a', root: tree({ tag: 'main', children: [table('1', '2')] }) },
      { subject: 'b', root: tree({ tag: 'aside', children: [{ tag: 'h2', text: 'Rows' }, table('1', '2')] }) },
    ]);
    expect(shared.map((entry) => entry.tag)).toEqual(['table']);
    expect(shared[0]!.sites).toEqual([{ subject: 'a', path: '0/0' }, { subject: 'b', path: '0/1' }]);
  });

  it('keeps a subtree that recurs in more places than its parent does', () => {
    const shared = sharedClosures([
      { subject: 'a', root: tree(table('1', '2')) },
      { subject: 'b', root: tree(table('1', '2')) },
      { subject: 'c', root: tree({ tag: 'div', children: [row('1')] }) },
    ]);
    expect(shared.map((entry) => [entry.tag, entry.sites.length]).sort()).toEqual([['table', 2], ['tr', 5]]);
  });

  it('says nothing about a subtree repeated inside one subject only', () => {
    expect(sharedClosures([{ subject: 'a', root: tree(table('1', '1', '1')) }])).toEqual([]);
  });

  it('joins on structure and reports whether the content held', () => {
    const shared = sharedClosures([
      { subject: 'a', root: tree(table('1', '2')) },
      { subject: 'b', root: tree(table('1', '3')) },
    ]);
    expect(shared.map((entry) => [entry.tag, entry.semantics])).toEqual([['table', 'parted']]);
  });

  it('floors on size', () => {
    const shared = sharedClosures(
      [
        { subject: 'a', root: tree({ tag: 'div', children: [{ tag: 'b', text: '!' }, table('1')] }) },
        { subject: 'b', root: tree({ tag: 'p', children: [{ tag: 'b', text: '!' }, table('1')] }) },
      ],
      { floor: 3 },
    );
    expect(shared.map((entry) => entry.tag)).toEqual(['table']);
  });
});
