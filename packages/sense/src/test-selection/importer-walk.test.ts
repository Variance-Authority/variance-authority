import { WHOLE, idOf, relationsOf, type Relations } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { walkImporters, type Carried } from './importer-walk.js';

const file = (name: string) => ({ kind: 'file', name }) as const;
const imports = (from: string, to: string, kind: 'depends' | 'imports' | 'type' = 'imports') =>
  ({ from: file(from), to: file(to), kind }) as const;

/**
 * Each visit as `importer: names`, in the order the walk asked them; `*` is the
 * whole file, which an importer hands on whole.
 */
function walk(relations: Relations, from: string, moved: Carried, hands: (importer: string, moved: Carried) => Carried) {
  const asked: string[] = [];
  walkImporters(relations, idOf(relations, 'file', from)!, moved, (importer, names) => {
    asked.push(`${importer}: ${names === WHOLE ? '*' : [...names.keys()].join(', ')}`);
    return names === WHOLE ? WHOLE : hands(importer, names);
  });
  return asked;
}

const total = new Map([['total', 'total']]);
const onward = (_: string, moved: Carried) => moved;

describe('the walk against the arrows', () => {
  it('asks an importer reached again by a second path only about the names that path adds', () => {
    const relations = relationsOf({
      relations: [imports('b.ts', 'a.ts'), imports('c.ts', 'a.ts'), imports('d.ts', 'b.ts'), imports('d.ts', 'c.ts')],
    });

    const asked = walk(relations, 'a.ts', total, (importer, moved) =>
      importer === 'c.ts' ? new Map([...moved, ['sum', 'total']]) : moved);

    expect(asked).toEqual(['b.ts: total', 'c.ts: total', 'd.ts: total', 'd.ts: sum']);
  });

  it('does not ask an importer again when the second path carries nothing new', () => {
    const relations = relationsOf({
      relations: [imports('b.ts', 'a.ts'), imports('c.ts', 'a.ts'), imports('d.ts', 'b.ts'), imports('d.ts', 'c.ts')],
    });

    expect(walk(relations, 'a.ts', total, onward)).toEqual(['b.ts: total', 'c.ts: total', 'd.ts: total']);
  });

  it('asks the declaring file about its own names a cycle hands back, once, and ends', () => {
    const relations = relationsOf({ relations: [imports('b.ts', 'a.ts'), imports('a.ts', 'b.ts')] });

    expect(walk(relations, 'a.ts', total, onward)).toEqual(['b.ts: total', 'a.ts: total']);
  });

  it('asks the declaring file about every name a cycle hands back to it', () => {
    const relations = relationsOf({ relations: [imports('b.ts', 'a.ts'), imports('a.ts', 'b.ts')] });

    const asked = walk(relations, 'a.ts', total, (importer, moved) =>
      importer === 'b.ts' ? new Map([...moved, ['sum', 'total']]) : new Map());

    expect(asked).toEqual(['b.ts: total', 'a.ts: total, sum']);
  });

  it('asks a declaring file that imports itself about its own names, once, and ends', () => {
    const relations = relationsOf({ relations: [imports('a.ts', 'a.ts'), imports('b.ts', 'a.ts')] });

    expect(walk(relations, 'a.ts', total, onward)).toEqual(['a.ts: total', 'b.ts: total']);
  });

  it('asks an importer that imports itself about the new names it hands on, once, and ends', () => {
    const relations = relationsOf({
      relations: [imports('b.ts', 'a.ts'), imports('b.ts', 'b.ts'), imports('c.ts', 'b.ts')],
    });

    const asked = walk(relations, 'a.ts', total, (importer, moved) =>
      importer === 'b.ts' ? new Map([...moved, ['sum', 'total']]) : moved);

    expect(asked).toEqual(['b.ts: total', 'b.ts: sum', 'c.ts: total, sum']);
  });

  it('stops behind an importer that hands nothing on', () => {
    const relations = relationsOf({ relations: [imports('b.ts', 'a.ts'), imports('c.ts', 'b.ts')] });

    expect(walk(relations, 'a.ts', total, () => new Map())).toEqual(['b.ts: total']);
  });

  it('never asks a file that imports only types from it', () => {
    const relations = relationsOf({ relations: [imports('b.ts', 'a.ts', 'type'), imports('c.ts', 'a.ts')] });

    expect(walk(relations, 'a.ts', total, onward)).toEqual(['c.ts: total']);
  });

  it('asks a file that declares it reads the module about the whole file', () => {
    const relations = relationsOf({ relations: [imports('b.ts', 'a.ts', 'depends'), imports('c.ts', 'b.ts')] });

    expect(walk(relations, 'a.ts', total, onward)).toEqual(['b.ts: *', 'c.ts: *']);
  });

  it('asks only files, never another kind of node that depends on one', () => {
    const relations = relationsOf({
      relations: [{ from: { kind: 'package', name: 'cart' }, to: file('a.ts'), kind: 'imports' }, imports('b.ts', 'a.ts')],
    });

    expect(walk(relations, 'a.ts', total, onward)).toEqual(['b.ts: total']);
  });

  it('asks every importer again in the next walk over the same graph, after one that ended or threw', () => {
    const relations = relationsOf({ relations: [imports('b.ts', 'a.ts'), imports('c.ts', 'b.ts')] });
    const thrown = () => walk(relations, 'a.ts', total, () => {
      throw new Error('unreadable');
    });

    expect(walk(relations, 'a.ts', total, onward)).toEqual(['b.ts: total', 'c.ts: total']);
    expect(thrown).toThrow('unreadable');
    expect(walk(relations, 'a.ts', total, onward)).toEqual(['b.ts: total', 'c.ts: total']);
    expect(walk(relations, 'b.ts', total, onward)).toEqual(['c.ts: total']);
  });
});
