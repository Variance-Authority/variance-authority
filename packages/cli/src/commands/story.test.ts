import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Arm, Place, Route } from '@variance-authority/sense/story';
import { parseArgs } from '../bin.js';
import { formatStory, story } from './story.js';

const place = (file: string, name: string, startLine: number, endLine: number, kind: Place['kind'] = 'function') =>
  ({ token: { place: { file, name, kind, startLine, endLine }, entered: 1, arms: [] as Arm[] } });

const ROUTE: Route = {
  file: 'src/cart.test.ts',
  name: 'cart > removes the last item',
  before: [place('src/cart.test.ts', 'beforeEach.arg0', 3, 8)],
  route: [
    { token: { loaded: ['src/cart.ts', 'src/price.ts', 'src/format.ts', 'src/tax.ts'] } },
    {
      token: {
        ...place('src/cart.ts', 'Cart/removeItem', 12, 30).token,
        arms: [{ path: 'if#0/then', startLine: 14, endLine: 16, times: 1 }, { path: 'for#0/body', startLine: 18, endLine: 22, times: 40 }],
      },
    },
    {
      repeat: [{ token: { ...place('src/price.ts', 'applyTier', 6, 8).token, entered: 40 } }, place('src/format.ts', '', 1, 1, 'module')],
      times: 40,
    },
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

/** A route through `count` declarations in `file`, each once. */
const through = (file: string, count: number, from = 0) =>
  Array.from({ length: count }, (_, at) => place(file, `part${from + at}`, from + at + 1, from + at + 1));

/** A long route of an application that goes through a design system beside it. */
const APP: Route = {
  ...ROUTE,
  before: [],
  route: [place('src/app.ts', 'render', 1, 9), ...through('ui/src/button.ts', 70), place('src/app.ts', 'onClick', 10, 12)],
  files: ['src/app.ts', 'ui/src/button.ts'],
  interleaved: 0,
};
const PACKAGES = { 'src/cart.test.ts': 'app', 'src/app.ts': 'app', 'ui/src/button.ts': '@acme/ui' };

describe('a story read as a route', () => {
  it('reads a short route step by step, with the arms each stop went into and how many times a loop went round', () => {
    expect(formatStory({ route: ROUTE }, 'text')).toBe(
      [
        ...HEAD,
        '',
        '  before the case',
        '  1  src/cart.test.ts:3-8  beforeEach.arg0',
        '  the case',
        '  2  loaded 4 files: src/cart.ts, src/price.ts, src/format.ts, and 1 more',
        '  3  src/cart.ts:12-30  Cart/removeItem  if#0/then 14-16, for#0/body 18-22 ×40',
        '     repeats ×40',
        '  4    src/price.ts:6-8  applyTier ×40',
        '  5    src/format.ts:1  (top level)',
        '',
      ].join('\n'),
    );
  });

  it('draws a long route at the finest level that fits, and names the level below and how to reach it', () => {
    const long: Route = { ...ROUTE, before: [], route: [...through('src/a.ts', 40), ...through('src/b.ts', 40, 40)], interleaved: 0 };
    expect(formatStory({ route: long }, 'text')).toBe(
      [
        'story  src/cart.test.ts > cart > removes the last item',
        '  goes through 5 files in 80 steps',
        '  drawn by files: by declarations it is 84 lines, over the 60 a reading is held to;',
        '  narrow it with --in <package or file> or --around <step>, or read every step with --whole',
        '',
        '  src/a.ts  steps 1-40',
        '  src/b.ts  steps 41-80',
        '',
      ].join('\n'),
    );
    expect(formatStory({ route: long, zoom: { whole: true } }, 'text').split('\n')).toHaveLength(2 + 1 + 80 + 1);
  });

  it('passes through the steps in another package of the workspace as one line, and a step back in the test\'s own ends it', () => {
    expect(formatStory({ route: APP, packages: PACKAGES }, 'text')).toBe(
      [
        'story  src/cart.test.ts > cart > removes the last item',
        '  goes through 2 files in 72 steps',
        '  drawn by steps: by every step it is 73 lines, over the 60 a reading is held to;',
        '  narrow it with --in <package or file> or --around <step>, or read every step with --whole',
        '  passed through @acme/ui, a line for each run of steps; open one with --in <package>',
        '',
        '   1  src/app.ts:1-9  render',
        '   2  through @acme/ui, steps 2-71: part0, part1, part2, and 67 more',
        '  72  src/app.ts:10-12  onClick',
        '',
      ].join('\n'),
    );
  });

  it('opens a package with --in, and picks the level again inside what it opened', () => {
    const opened = JSON.parse(formatStory({ route: APP, packages: PACKAGES, zoom: { in: '@acme/ui' } }, 'json'));
    expect(opened).toMatchObject({ package: 'app', reading: { level: 'files' }, finer: { level: 'declarations' } });
    expect(opened.reading.files.map((file: { package: string }) => file.package)).toEqual(['app', '@acme/ui']);
    // Back and forth into seventy files of the design system fits no level finer than its packages.
    const wide: Route = {
      ...APP,
      route: Array.from({ length: 70 }, (_, at) => [place('src/app.ts', 'render', 1, 9), place(`ui/src/part${at}.ts`, 'part', 1, 1)]).flat(),
    };
    const packageOf = { ...PACKAGES, ...Object.fromEntries(Array.from({ length: 70 }, (_, at) => [`ui/src/part${at}.ts`, '@acme/ui'])) };
    expect(JSON.parse(formatStory({ route: wide, packages: packageOf }, 'json')).reading).toEqual({
      level: 'packages',
      packages: [
        { package: 'app', own: true, files: 1, steps: Array.from({ length: 70 }, (_, at) => 1 + 2 * at) },
        { package: '@acme/ui', own: false, files: 70, steps: Array.from({ length: 70 }, (_, at) => 2 + 2 * at) },
      ],
    });
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
      [...HEAD, '', '  the case goes through no package or file matching `basket`', ''].join('\n'),
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
        '  3  src/cart.ts:12-30  Cart/removeItem  if#0/then 14-16, for#0/body 18-22 ×40',
        '     repeats ×40',
        '  4    src/price.ts:6-8  applyTier ×40',
        '     … step 5',
        '',
      ].join('\n'),
    );
    expect(() => formatStory({ route: ROUTE, zoom: { around: 6 } }, 'text')).toThrow(
      '--around 6 is past the end: this route has 5 steps',
    );
  });

  it('gives the reading, its level and the numbered steps as json', () => {
    const { before: _before, route: _route, ...head } = ROUTE;
    expect(JSON.parse(formatStory({ route: ROUTE, zoom: { around: 5 } }, 'json'))).toEqual({
      ...head,
      steps: 5,
      reading: {
        level: 'every step',
        lines: [
          { gap: [1, 1] },
          { step: 2, depth: 0, before: false, loaded: ['src/cart.ts', 'src/price.ts', 'src/format.ts', 'src/tax.ts'] },
          { step: 3, depth: 0, before: false, ...ROUTE.route[1]!.token },
          { repeats: 40, depth: 0, before: false },
          { step: 4, depth: 1, before: false, ...ROUTE.route[2]!.repeat![0]!.token },
          { step: 5, depth: 1, before: false, ...ROUTE.route[2]!.repeat![1]!.token },
        ],
      },
    });
    // Thirty declarations visited three times over is ninety steps, and thirty places.
    const long: Route = { ...ROUTE, before: [], route: [1, 2, 3].flatMap(() => through('src/a.ts', 30)) };
    expect(JSON.parse(formatStory({ route: long }, 'json'))).toMatchObject({
      reading: { level: 'declarations', visits: [{ file: 'src/a.ts' }] },
      finer: { level: 'every step', lines: 91 },
    });
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
