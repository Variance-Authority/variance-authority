import { describe, expect, it } from 'vitest';
import type { NativeOrientPackageLayer } from './native-orient.js';
import { tierMoves } from './tier-moves.js';

const tiers = [200000, 50000, 20000, 5000, 2000, 1000];

interface Entry {
  readonly takes?: readonly string[];
  readonly own: number;
  readonly unsizedFiles?: number;
}

/** A map from each package's own lines and what it takes; a closure is its own lines and every package below it. */
function sized(entries: Record<string, Entry>): NativeOrientPackageLayer[] {
  const closure = (name: string, seen = new Set<string>()): string[] => {
    if (seen.has(name)) return [];
    seen.add(name);
    return [name, ...(entries[name]!.takes ?? []).flatMap((taken) => closure(taken, seen))];
  };
  return Object.keys(entries)
    .sort()
    .map((name) => ({
      package: name,
      directory: `packages/${name}`,
      layer: 1,
      takes: [...(entries[name]!.takes ?? [])].sort(),
      own: entries[name]!.own,
      lines: closure(name).reduce((sum, member) => sum + entries[member]!.own, 0),
      files: closure(name).length,
      unsizedFiles: entries[name]!.unsizedFiles ?? 0,
    }));
}

describe('tierMoves', () => {
  it('says nothing when no tier moved, however much a closure grew', () => {
    const base = sized({ util: { own: 100 }, app: { own: 30000, takes: ['util'] } });
    const head = sized({ util: { own: 200 }, app: { own: 30000, takes: ['util'] } });
    expect(tierMoves(base, head, tiers)).toEqual({ causes: [], carried: 0 });
  });

  it('tells a utility that took an engine as the cause, and the packages its growth carried', () => {
    const base = sized({ engine: { own: 28000 }, util: { own: 40 }, form: { own: 500, takes: ['util'] }, card: { own: 300, takes: ['util'] } });
    const head = sized({
      engine: { own: 28000 },
      util: { own: 40, takes: ['engine'] },
      form: { own: 500, takes: ['util'] },
      card: { own: 300, takes: ['util'] },
    });
    const moves = tierMoves(base, head, tiers);
    expect(moves.causes.map((cause) => [cause.package, cause.from.tier, cause.to.tier, cause.added, cause.carried])).toEqual([
      ['util', 5, 1, ['engine'], ['card', 'form']],
    ]);
    expect(moves.carried).toBe(2);
  });

  it('names a package whose own lines grew as its own cause', () => {
    const moves = tierMoves(sized({ util: { own: 900 } }), sized({ util: { own: 1500 } }), tiers);
    expect(moves.causes.map((cause) => [cause.package, cause.ownFrom, cause.ownTo, cause.from.tier, cause.to.tier])).toEqual([
      ['util', 900, 1500, 5, 4],
    ]);
  });

  it('does not read a known tier turning into a lower bound of the same number as a move', () => {
    const moves = tierMoves(sized({ util: { own: 900 } }), sized({ util: { own: 900, unsizedFiles: 1 } }), tiers);
    expect(moves.causes).toEqual([]);
  });
});
