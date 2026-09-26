import { describe, expect, it } from 'vitest';
import type { Step } from './fold.js';
import type { Region, Stop } from './read.js';

/**
 * The reader as it ships: built, because the story format it reads `require`s
 * its neighbours by the names the build gives them.
 */
const { drawRoute } = (await import('../../dist/story/read.js')) as typeof import('./read.js');
const { EVALUATING } = (await import('../../dist/story/format.cjs')).default as typeof import('./format.cjs');

const ROOT = '/checkout';

/** `cart.ts`: a module with a function holding a loop, and a helper. */
const CART: Region[] = [
  { kind: 'module', name: '', path: 'module', startLine: 1, endLine: 40 },
  { kind: 'function', name: 'removeItem', path: 'entry', startLine: 12, endLine: 30 },
  { kind: 'loop', name: 'removeItem', path: 'for#0/body', startLine: 18, endLine: 20 },
  { kind: 'branch', name: 'removeItem', path: 'for#0/body/if#0/then', startLine: 19, endLine: 19 },
  { kind: 'function', name: 'price', path: 'entry', startLine: 32, endLine: 36 },
];

/** A story over `cart.ts` (rows 0–4) and `format.ts` (rows 5–6), from visits spelled as ordinals. */
function story(visits: number[], before: number[] = []) {
  return {
    file: '/checkout/src/cart.test.ts',
    name: 'cart > removes the last item',
    rows: [['src/cart.ts', 5], [7, 2]] as [string | number, number][],
    before: Int32Array.from(before),
    visits: Int32Array.from(visits),
    untaped: 0,
    interleaved: 0,
  };
}

/** A route in one line: a declaration by name, `loaded[...]`, and `(…)` for a loop. */
function drawn(steps: readonly Step<Stop>[]): string {
  return steps
    .map((step) => {
      if ('repeat' in step) return `(${drawn(step.repeat)})`;
      const stop = step.token;
      return 'loaded' in stop ? `loaded[${stop.loaded.join(',')}]` : stop.place.name || `${stop.place.file}:top`;
    })
    .join(' ');
}

describe('a route', () => {
  it('goes through declarations, with a loop drawn once and the arms inside it left on the tape', () => {
    const route = drawRoute(ROOT, story([1, 2, 3, 4, 2, 4, 2, 3, 4]), ['src/cart.ts', 'src/format.ts'], [CART, undefined]);
    expect(drawn(route.route)).toBe('(removeItem price)');
    expect(route.route[0]).toMatchObject({ repeat: [{ token: { place: { name: 'removeItem', startLine: 12 } } }, {}] });
  });

  it('draws modules evaluated one inside another as one stop naming each file once', () => {
    const E = EVALUATING;
    const route = drawRoute(ROOT, story([0 | E, 5 | E, 0 | E, 1]), ['src/cart.ts', 'src/format.ts'], [CART, undefined]);
    expect(drawn(route.route)).toBe('loaded[src/cart.ts,src/format.ts] removeItem');
  });

  it('draws a module the recording holds no regions for as its file, and says so', () => {
    const route = drawRoute(ROOT, story([1, 6, 1]), ['src/cart.ts', 'src/format.ts'], [CART, undefined]);
    expect(drawn(route.route)).toBe('removeItem src/format.ts:top removeItem');
    expect(route.unresolved).toEqual(['src/format.ts']);
    expect(route.files).toEqual(['src/cart.ts', 'src/format.ts']);
  });

  it('keeps what ran before the case apart from the case, and names the test file inside the checkout', () => {
    const route = drawRoute(ROOT, story([1], [4]), ['src/cart.ts', 'src/format.ts'], [CART, undefined]);
    expect([drawn(route.before), drawn(route.route), route.file]).toEqual(['price', 'removeItem', 'src/cart.test.ts']);
  });

  it('is a route with nowhere on it when the case reached nothing', () => {
    const route = drawRoute(ROOT, story([]), ['src/cart.ts', 'src/format.ts'], [CART, undefined]);
    expect([route.route, route.files]).toEqual([[], []]);
  });
});
