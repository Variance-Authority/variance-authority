import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Place, Route } from '@variance-authority/sense/story';
import { parseArgs } from '../bin.js';
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

const HEAD = [
  'story  src/cart.test.ts > cart > removes the last item',
  '  goes through 5 files in 5 steps',
  "  another case's work ran in the middle of this one twice, and is left out",
];

describe('a story read as a route', () => {
  it('opens on the files the case went through and the declarations in each, with the steps it was there', () => {
    expect(formatStory({ route: ROUTE }, 'text')).toBe(
      [
        ...HEAD,
        '',
        '  src/cart.test.ts',
        '    3-8  beforeEach.arg0  step 1',
        '',
        '  src/cart.ts  loaded at step 2',
        '    12-30  Cart/removeItem  step 3',
        '',
        '  src/price.ts  loaded at step 2',
        '    6-8  applyTier  step 4, in a loop',
        '',
        '  src/format.ts  loaded at step 2',
        '    1  (top level)  step 5, in a loop',
        '',
        '  src/tax.ts  loaded at step 2',
        '',
        '  read the steps through one file with --in <file>, the steps near one with --around <step>,',
        '  or the whole route with --whole',
        '',
      ].join('\n'),
    );
  });

  it('numbers every step of the whole route, and draws a loop once', () => {
    expect(formatStory({ route: ROUTE, zoom: { whole: true } }, 'text')).toBe(
      [
        ...HEAD,
        '',
        '  before the case',
        '  1  src/cart.test.ts:3-8  beforeEach.arg0',
        '  the case',
        '  2  loaded 4 files: src/cart.ts, src/price.ts, src/format.ts, and 1 more',
        '  3  src/cart.ts:12-30  Cart/removeItem',
        '     repeats',
        '  4    src/price.ts:6-8  applyTier',
        '  5    src/format.ts:1  (top level)',
        '',
      ].join('\n'),
    );
  });

  it('reads the steps through one file with the step either side, and names the steps it leaves out', () => {
    expect(formatStory({ route: ROUTE, zoom: { in: 'cart.test' } }, 'text')).toBe(
      [
        ...HEAD,
        '',
        '  before the case',
        '  1  src/cart.test.ts:3-8  beforeEach.arg0',
        '  the case',
        '  2  loaded 4 files: src/cart.ts, src/price.ts, src/format.ts, and 1 more',
        '     … steps 3-5',
        '',
      ].join('\n'),
    );
    expect(formatStory({ route: ROUTE, zoom: { in: 'basket' } }, 'text')).toBe(
      [...HEAD, '', '  the case goes through no file matching `basket`', ''].join('\n'),
    );
  });

  it('reads the steps around one, inside the loops they sit in', () => {
    expect(formatStory({ route: ROUTE, zoom: { around: 1 } }, 'text')).toBe(
      [
        ...HEAD,
        '',
        '  before the case',
        '  1  src/cart.test.ts:3-8  beforeEach.arg0',
        '  the case',
        '  2  loaded 4 files: src/cart.ts, src/price.ts, src/format.ts, and 1 more',
        '  3  src/cart.ts:12-30  Cart/removeItem',
        '     repeats',
        '  4    src/price.ts:6-8  applyTier',
        '     … step 5',
        '',
      ].join('\n'),
    );
    expect(() => formatStory({ route: ROUTE, zoom: { around: 6 } }, 'text')).toThrow(
      '--around 6 is past the end: this route has 5 steps',
    );
  });

  it('gives the overview and the numbered steps as json', () => {
    const { before: _before, route: _route, ...head } = ROUTE;
    expect(JSON.parse(formatStory({ route: ROUTE }, 'json'))).toMatchObject({
      ...head,
      steps: 5,
      visits: [
        { file: 'src/cart.test.ts', declarations: [{ name: 'beforeEach.arg0', steps: [1], looped: false }] },
        { file: 'src/cart.ts', loadedAt: 2 },
        { file: 'src/price.ts', loadedAt: 2, declarations: [{ name: 'applyTier', steps: [4], looped: true }] },
        { file: 'src/format.ts', loadedAt: 2 },
        { file: 'src/tax.ts', loadedAt: 2, declarations: [] },
      ],
    });
    expect(JSON.parse(formatStory({ route: ROUTE, zoom: { around: 5 } }, 'json')).lines).toEqual([
      { gap: [1, 1] },
      { step: 2, depth: 0, before: false, loaded: ['src/cart.ts', 'src/price.ts', 'src/format.ts', 'src/tax.ts'] },
      { step: 3, depth: 0, before: false, place: ROUTE.route[1]!.token!.place },
      { repeats: true, depth: 0, before: false },
      { step: 4, depth: 1, before: false, place: { file: 'src/price.ts', name: 'applyTier', kind: 'function', startLine: 6, endLine: 8 } },
      { step: 5, depth: 1, before: false, place: { file: 'src/format.ts', name: '', kind: 'module', startLine: 1, endLine: 1 } },
    ]);
  });

  it('takes one of --in, --around and --whole', () => {
    expect(parseArgs(['story', '--around', '4'])).toMatchObject({ command: 'story', zoom: { around: 4 } });
    expect(() => parseArgs(['story', '--in', 'cart', '--whole'])).toThrow(
      '--in and --whole each choose how much of the route to read; name one',
    );
    expect(() => parseArgs(['story', '--around', 'first'])).toThrow('--around takes a step number from the route, not `first`');
  });

  it('refuses a checkout with no story by naming the variable that writes one', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-story-'));
    await writeFile(join(root, 'variance.config.json'), JSON.stringify({ cacheRoot: 'cache' }));
    expect(() => story({ command: 'story', root, format: 'text' })).toThrow(/VARIANCE_AUTHORITY_STORY=1/);
  });
});
