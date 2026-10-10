import { idOf, relationsOf, type Relations } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { walkImporters, type Carried } from './importer-walk.js';

const file = (name: string) => ({ kind: 'file', name }) as const;
const imports = (from: string, to: string) => ({ from: file(from), to: file(to), kind: 'imports' }) as const;

/** Each visit as `importer: names`, in the order the walk asked them. */
function walk(relations: Relations, from: string, moved: Carried, hands: (importer: string, moved: Carried) => Carried) {
  const asked: string[] = [];
  walkImporters(relations, idOf(relations, 'file', from)!, moved, (importer, names) => {
    asked.push(`${importer}: ${[...names.keys()].join(', ')}`);
    return hands(importer, names);
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

  it('ends on a cycle, never asking the declaring file about its own names', () => {
    const relations = relationsOf({ relations: [imports('b.ts', 'a.ts'), imports('a.ts', 'b.ts')] });

    expect(walk(relations, 'a.ts', total, onward)).toEqual(['b.ts: total']);
  });

  it('stops behind an importer that hands nothing on', () => {
    const relations = relationsOf({ relations: [imports('b.ts', 'a.ts'), imports('c.ts', 'b.ts')] });

    expect(walk(relations, 'a.ts', total, () => new Map())).toEqual(['b.ts: total']);
  });

  it('asks only files, never another kind of node that depends on one', () => {
    const relations = relationsOf({
      relations: [{ from: { kind: 'package', name: 'cart' }, to: file('a.ts'), kind: 'imports' }, imports('b.ts', 'a.ts')],
    });

    expect(walk(relations, 'a.ts', total, onward)).toEqual(['b.ts: total']);
  });
});
