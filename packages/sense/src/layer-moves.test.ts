import { describe, expect, it } from 'vitest';
import { layerMoves } from './layer-moves.js';

type Takes = Record<string, readonly string[]>;

/** A map from who takes whom; layers follow the rule: one more than the highest package taken. */
function layered(takes: Takes): { package: string; directory: string; layer: number; takes: string[] }[] {
  const layer = (name: string): number => 1 + Math.max(0, ...(takes[name] ?? []).map(layer));
  return Object.keys(takes)
    .sort()
    .map((name) => ({ package: name, directory: name, layer: layer(name), takes: [...(takes[name] ?? [])].sort() }));
}

/** A chain a1 -> a2 -> ... each taking the next, the last taking `bottom`. */
function chain(length: number, bottom: string): Takes {
  const takes: Record<string, string[]> = {};
  for (let at = 1; at <= length; at += 1) takes[`a${String(at).padStart(3, '0')}`] = [at === length ? bottom : `a${String(at + 1).padStart(3, '0')}`];
  return takes;
}

describe('layerMoves', () => {
  it('says nothing when no layer moved', () => {
    const map = layered({ core: [], ui: ['core'] });
    expect(layerMoves(map, map)).toEqual({ causes: [], carried: 0, appeared: [], vanished: [] });
  });

  it('tells one edit that lifted a hundred packages as one cause and the count it carried', () => {
    const base = layered({ x: [], y: ['x'], ...chain(100, 'x') });
    const head = layered({ x: [], y: ['x'], z: ['y'], ...chain(100, 'z') });
    const moves = layerMoves(base, head);
    // Only a100 changed its own imports (x -> z); the other 99 moved because it did.
    expect(moves.causes.map((cause) => [cause.package, cause.from, cause.to, cause.added, cause.removed, cause.carried.length])).toEqual([
      ['a100', 2, 4, ['z'], ['x'], 99],
    ]);
    expect(moves.carried).toBe(99);
    expect(moves.appeared).toEqual(['z']);
  });

  it('counts a package that moved once, under the nearer of two causes', () => {
    const base = layered({ p: [], q: [], top: ['p', 'q'] });
    const head = layered({ p: ['r'], r: [], q: ['s'], s: ['t'], t: [], top: ['p', 'q'] });
    const { causes } = layerMoves(base, head);
    expect(causes.map((cause) => [cause.package, cause.carried])).toEqual([['q', ['top']], ['p', []]]);
  });

  it('follows the dependency that sat just below a package when it falls', () => {
    const base = layered({ low: [], mid: ['low'], deep: ['mid'], user: ['deep', 'low'] });
    const head = layered({ low: [], mid: ['low'], deep: [], user: ['deep', 'low'] });
    const { causes } = layerMoves(base, head);
    expect(causes.map((cause) => [cause.package, cause.from, cause.to, cause.carried])).toEqual([['deep', 3, 1, ['user']]]);
  });

  it('lists a package that came or went apart from the movers', () => {
    const moves = layerMoves(layered({ a: [], gone: [] }), layered({ a: [], fresh: ['a'] }));
    expect(moves).toEqual({ causes: [], carried: 0, appeared: ['fresh'], vanished: ['gone'] });
  });
});
