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

  it('numbers a second region at one name and path from 2, in the order the module holds them', () => {
    expect(coordinatesOf('src/price.js', [
      { name: 'total', path: 'entry' },
      { name: 'total', path: 'if#0/then' },
      { name: 'total', path: 'entry' },
      { name: 'total', path: 'if#0/then' },
    ])).toEqual([
      'src/price.js#total/entry',
      'src/price.js#total/if#0/then',
      'src/price.js#total/entry~2',
      'src/price.js#total/if#0/then~2',
    ]);
  });
});
