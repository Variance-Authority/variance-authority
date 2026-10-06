import { describe, expect, it } from 'vitest';
import { dominatorsOf } from './index.js';

/** A graph from a table of edges, as the successors function a caller hands over. */
function graph(edges: Readonly<Record<string, readonly string[]>>): (node: string) => readonly string[] {
  return (node) => edges[node] ?? [];
}

describe('dominatorsOf', () => {
  it('names each node\'s immediate dominator along a chain', () => {
    const idom = dominatorsOf('test', graph({ test: ['a'], a: ['b'], b: ['c'] }));

    expect([...idom]).toEqual([['a', 'test'], ['b', 'a'], ['c', 'b']]);
  });

  it('gives a node two paths reach the place where the paths part, never either path', () => {
    const idom = dominatorsOf('test', graph({ test: ['a', 'b'], a: ['shared'], b: ['shared'], shared: ['deep'] }));

    expect(idom.get('shared')).toBe('test');
    expect(idom.get('deep')).toBe('shared');
  });

  it('holds on a cycle, where the node a path enters by dominates the rest of it', () => {
    const idom = dominatorsOf('test', graph({ test: ['a'], a: ['b'], b: ['c'], c: ['a', 'd'] }));

    expect(idom.get('a')).toBe('test');
    expect(idom.get('b')).toBe('a');
    expect(idom.get('c')).toBe('b');
    expect(idom.get('d')).toBe('c');
  });

  it('leaves out the root and every node it cannot reach', () => {
    const idom = dominatorsOf('test', graph({ test: ['a'], island: ['a'] }));

    expect(idom.has('test')).toBe(false);
    expect(idom.has('island')).toBe(false);
    expect(idom.get('a')).toBe('test');
  });
});
