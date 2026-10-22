import { describe, expect, it } from 'vitest';
import { coordinatesOf } from './region-coordinates.js';

describe('a region coordinate', () => {
  it('is the file, the declaration and the structure inside it', () => {
    expect(coordinatesOf('src/price.js', [
      { name: '', path: 'module' },
      { name: 'lineTotal', path: 'entry' },
      { name: 'lineTotal', path: 'if#0/else' },
      { name: 'Cart/removeItem', path: 'for#0/body' },
    ])).toEqual([
      'src/price.js#module',
      'src/price.js#lineTotal/entry',
      'src/price.js#lineTotal/if#0/else',
      'src/price.js#Cart/removeItem/for#0/body',
    ]);
  });

  it('numbers a second declaration of one name from 2, and every region inside it with it', () => {
    expect(coordinatesOf('src/price.js', [
      { name: 'total', path: 'entry' },
      { name: 'total', path: 'entry' },
      { name: 'total', path: 'if#0/then' },
    ])).toEqual([
      'src/price.js#total/entry',
      'src/price.js#total~2/entry',
      // The first `total` has no `if`, and this one is still the second's.
      'src/price.js#total~2/if#0/then',
    ]);
  });

  it('carries the number of a declaration into the declarations nested in it', () => {
    expect(coordinatesOf('src/route.js', [
      { name: 'handle', path: 'entry' },
      { name: 'handle', path: 'entry' },
      { name: 'handle/inner', path: 'entry' },
      { name: 'handle/inner', path: 'if#0/then' },
      { name: 'handle/inner', path: 'entry' },
    ])).toEqual([
      'src/route.js#handle/entry',
      'src/route.js#handle~2/entry',
      // The first `handle` has no `inner`, and this one is still the second's.
      'src/route.js#handle~2/inner/entry',
      'src/route.js#handle~2/inner/if#0/then',
      'src/route.js#handle~2/inner~2/entry',
    ]);
  });
});
