import { describe, expect, it } from 'vitest';
import { NOTHING, WHOLE, carried, idOf, relationsOf, type CarriedStep, type Relations } from './index.js';

const file = (name: string) => ({ kind: 'file', name }) as const;
const imports = (from: string, to: string) => ({ from: file(from), to: file(to), kind: 'imports' }) as const;

/** `b.ts` imports `a.ts`. */
const relations: Relations = relationsOf({ relations: [imports('b.ts', 'a.ts')] });
const a = idOf(relations, 'file', 'a.ts')!;
const b = idOf(relations, 'file', 'b.ts')!;

/** Enters an importer only when what the file it imports holds includes `name`. */
const holding = (name: string): CarriedStep<string> => ({
  arrive: (_importer, _from, _kind, _carried, held) => (held === WHOLE || held.has(name) ? WHOLE : NOTHING),
});

const reached = (seeds: Parameters<typeof carried<string>>[1], name: string, seedsHold?: boolean) =>
  carried(relations.dependents, seeds, holding(name), { seedsHold }).entered;

describe('what a seed holds as it is expanded', () => {
  it('is the whole file when the seed carries the whole file, though it starts holding nothing', () => {
    expect(reached([[a, WHOLE]], 'total', false)).toEqual([a, b]);
  });

  it('includes the names the seed carries, though it starts holding nothing', () => {
    expect(reached([[a, new Map([['total', 'total']])]], 'total', false)).toEqual([a, b]);
  });

  it('includes every name a seed listed twice carries', () => {
    const seeds = [
      [a, new Map([['total', 'total']])],
      [a, new Map([['sum', 'sum']])],
    ] as const;

    expect(reached(seeds, 'sum')).toEqual([a, b]);
  });

  it('is the whole file when a seed listed twice carries it once', () => {
    expect(reached([[a, new Map([['total', 'total']])], [a, WHOLE]], 'sum')).toEqual([a, b]);
  });
});

describe('what a hand answers in a walk that carries the whole file', () => {
  /** `b.ts` and `d.ts` import `a.ts`; `c.ts` imports `b.ts` and `d.ts`. */
  const diamond = relationsOf({
    relations: [imports('b.ts', 'a.ts'), imports('d.ts', 'a.ts'), imports('c.ts', 'b.ts'), imports('c.ts', 'd.ts')],
  });
  const id = (name: string) => idOf(diamond, 'file', name)!;

  it('travels on by name, and the whole file still reaches an importer that holds only names', () => {
    const handed: Array<readonly [string, readonly string[] | 'whole']> = [];
    const step: CarriedStep<string> = {
      hand: (importer, arrived) => {
        handed.push([diamond.names[importer]!, arrived === WHOLE ? 'whole' : [...arrived.keys()]]);
        return importer === id('b.ts') ? new Map([['total', 'total']]) : arrived;
      },
    };

    carried(diamond.dependents, [[id('a.ts'), WHOLE]], step);

    expect(handed).toEqual([
      ['b.ts', 'whole'],
      ['d.ts', 'whole'],
      ['c.ts', ['total']],
      ['c.ts', 'whole'],
    ]);
  });
});
