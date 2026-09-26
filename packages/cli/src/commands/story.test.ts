import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Place, Route } from '@variance-authority/sense/story';
import { formatStory, story } from './story.js';

const place = (file: string, name: string, startLine: number, endLine: number, kind: Place['kind'] = 'function') =>
  ({ token: { place: { file, name, kind, startLine, endLine } } });

const ROUTE: Route = {
  file: 'src/cart.test.ts',
  name: 'cart > removes the last item',
  before: [place('src/cart.test.ts', 'beforeEach.arg0', 3, 8)],
  route: [
    { token: { loaded: ['src/cart.ts', 'src/price.ts', 'src/format.ts', 'src/tax.ts'] } },
    place('src/cart.ts', 'Cart/removeItem', 12, 30),
    { repeat: [place('src/price.ts', 'applyTier', 6, 8), place('src/format.ts', '', 1, 1, 'module')] },
  ],
  files: ['src/cart.test.ts', 'src/cart.ts', 'src/format.ts', 'src/price.ts', 'src/tax.ts'],
  unresolved: [],
  untaped: 0,
  interleaved: 2,
};

describe('a story read as a route', () => {
  it('names each declaration by where it is, draws a loop once, and says what the route leaves out', () => {
    expect(formatStory({ route: ROUTE }, 'text')).toBe(
      [
        'story  src/cart.test.ts > cart > removes the last item',
        '  goes through 5 files',
        "  another case's work ran in the middle of this one twice, and is left out",
        '',
        '  before the case',
        '    src/cart.test.ts:3-8  beforeEach.arg0',
        '  the case',
        '    loaded 4 files: src/cart.ts, src/price.ts, src/format.ts, and 1 more',
        '    src/cart.ts:12-30  Cart/removeItem',
        '    repeats',
        '      src/price.ts:6-8  applyTier',
        '      src/format.ts:1  (top level)',
        '',
      ].join('\n'),
    );
  });

  it('gives the route itself as json', () => {
    expect(JSON.parse(formatStory({ route: ROUTE }, 'json'))).toEqual(ROUTE);
  });

  it('refuses a checkout with no story by naming the variable that writes one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-story-'));
    await writeFile(join(root, 'variance.config.json'), JSON.stringify({ cacheRoot: 'cache' }));
    expect(() => story({ command: 'story', root, format: 'text' })).toThrow(/VARIANCE_AUTHORITY_STORY=1/);
  });
});
