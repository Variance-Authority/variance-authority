import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Arm, Place, Route } from '@variance-authority/sense/story';
import { parseArgs } from '../bin.js';
import { formatStory, story } from './story.js';

const place = (file: string, name: string, startLine: number, endLine: number, kind: Place['kind'] = 'function') =>
  ({ token: { place: { file, name, kind, at: `${file}#${name === '' ? 'module' : `${name}/entry`}`, startLine, endLine }, entered: 1, arms: [] as Arm[] } });

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
  untaken: [],
  untaped: 0,
  interleaved: 2,
};

const HEAD = [
  'story  src/cart.test.ts > cart > removes the last item',
  '  goes through 5 files in 5 steps',
  "  another test's work ran in the middle of this one twice, and is left out",
];

const KEY = [
  '  key  step   one function, method or callback, from the test going in or coming back until it goes to another',
  '       ×N     beside a function, how many times the test called it at this step; beside a branch or a loop, how',
  '              many times it ran there; under `steps a-b ran N times`, every pass of them is added',
  '       ✗      a branch the test never took, or a loop whose body never ran',
  '       ↑      a branch or a loop body the test went into at an earlier step; this step runs inside it',
  '       in 255 then:  inside the `then` branch of the `if` on line 255',
];

const FILES = ['', '  in src: cart.test.ts, cart.ts, price.ts, format.ts, tax.ts', ''];

/** A route through `count` declarations in `file`, each once. */
const through = (file: string, count: number, from = 0) =>
  Array.from({ length: count }, (_, at) => place(file, `part${from + at}`, from + at + 1, from + at + 1));

/** A long route of an application that goes through a design system beside it. */
const APP: Route = {
  ...ROUTE,
  before: [],
  route: [place('src/app.ts', 'render', 1, 9), ...through('ui/src/button.ts', 300), place('src/app.ts', 'onClick', 10, 12)],
  files: ['src/app.ts', 'ui/src/button.ts'],
  interleaved: 0,
};
const PACKAGES = { 'src/cart.test.ts': 'app', 'src/app.ts': 'app', 'ui/src/button.ts': '@acme/ui' };

describe('a story read as a route', () => {
  it('names the files it drew as the file alone, and what it lacks for them, with nothing to run', () => {
    const text = formatStory({ route: { ...ROUTE, unresolved: ['src/tax.ts'] } }, 'text');

    expect(text).toContain('\n  1 file is drawn as the file alone: the recording holds no regions for it at this text\n');
    expect(text).not.toMatch(/next run|run of the suite/);
  });

  it('reads a short route step by step, with the arms each stop went into drawn as the code nests them and how many times a loop went round', () => {
    expect(formatStory({ route: ROUTE }, 'text')).toBe(
      [
        ...HEAD,
        ...KEY,
        ...FILES,
        '  before the test',
        '  1  beforeEach.arg0  cart.test.ts:3-8',
        '  the test',
        '  2  loaded 4 files: cart.ts, price.ts, format.ts, and 1 more',
        '  3  Cart/removeItem  cart.ts:12-30',
        '       if 14  then ×1',
        '       for 18 ×40',
        '     steps 4-5 ran 40 times in all:',
        '  4    applyTier  price.ts:6-8 ×40',
        '  5    (top level)  format.ts:1',
        '',
      ].join('\n'),
    );
  });

  it('draws what a declaration never went into beside the arms it took, at every step, and only at the levels that draw steps', () => {
    const removeItem = ROUTE.route[1]!;
    const never = [{ path: 'if#0/else', startLine: 17, endLine: 17 }, { path: 'for#0/after', startLine: 24, endLine: 29 }];
    const again: Route = {
      ...ROUTE,
      route: [...ROUTE.route, removeItem],
      untaken: [{ place: { file: 'src/cart.ts', name: 'Cart/removeItem', kind: 'function', at: 'src/cart.ts#Cart/removeItem/entry', startLine: 12, endLine: 30 }, arms: never }],
    };
    const text = formatStory({ route: again }, 'text').split('\n');
    // The code after the loop is not drawn: going on past a construct is what it does.
    expect(text.slice(text.indexOf('  6  Cart/removeItem  cart.ts:12-30'))).toEqual([
      '  6  Cart/removeItem  cart.ts:12-30',
      '       if 14  then ×1  else ✗',
      '       for 18 ×40',
      '',
    ]);
    expect(text).toContain('       if 14  then ×1  else ✗');
    expect(JSON.parse(formatStory({ route: again }, 'json')).untaken).toEqual(again.untaken);

    const long: Route = { ...again, route: [removeItem, ...through('src/a.ts', 150), ...through('src/b.ts', 150, 150)] };
    expect(formatStory({ route: long }, 'text')).not.toContain('✗');
    expect(JSON.parse(formatStory({ route: long }, 'json')).untaken).toBeUndefined();
  });

  it('names an `if` by the line its `then` starts on at a step that draws only its implicit `else`', () => {
    // `checkout` awaits before its `if`, so step 1 goes no further than the
    // await and step 3 comes back to take the `then`; the `else` it never takes
    // is the region an absent `else` is given, on the line the `if` ends.
    const checkout = (arms: Arm[], entered: number) => ({ token: { ...place('src/checkout.ts', 'checkout', 10, 16).token, arms, entered } });
    const route: Route = {
      ...ROUTE,
      before: [],
      route: [checkout([], 1), place('src/save.ts', 'save', 1, 3), checkout([{ path: 'if#0/then', startLine: 13, endLine: 15, times: 1 }], 0)],
      files: ['src/checkout.ts', 'src/save.ts'],
      untaken: [{ place: { file: 'src/checkout.ts', name: 'checkout', kind: 'function', at: 'src/checkout.ts#checkout/entry', startLine: 10, endLine: 16 }, arms: [{ path: 'if#0/else', startLine: 15, endLine: 15 }] }],
      interleaved: 0,
    };
    const text = formatStory({ route }, 'text').split('\n');
    expect(text.slice(text.indexOf('  1  checkout  checkout.ts:10-16'))).toEqual([
      '  1  checkout  checkout.ts:10-16',
      '       if 13  else ✗',
      '  2  save  save.ts:1-3',
      '  3  checkout  checkout.ts:10-16',
      '       if 13  then ×1  else ✗',
      '',
    ]);
  });

  it('draws two declarations of one name in a file each with the arms it never went into', () => {
    const handle = (at: string, startLine: number, endLine: number) =>
      ({ token: { place: { file: 'src/route.ts', name: 'handle', kind: 'function' as const, at, startLine, endLine }, entered: 1, arms: [] as Arm[] } });
    const route: Route = {
      ...ROUTE,
      before: [],
      route: [handle('src/route.ts#handle/entry', 1, 5), handle('src/route.ts#handle~2/entry', 7, 11)],
      files: ['src/route.ts'],
      untaken: [
        { place: handle('src/route.ts#handle/entry', 1, 5).token.place, arms: [{ path: 'if#0/then', startLine: 2, endLine: 3 }] },
        { place: handle('src/route.ts#handle~2/entry', 7, 11).token.place, arms: [{ path: 'if#0/then', startLine: 9, endLine: 10 }] },
      ],
      interleaved: 0,
    };
    const text = formatStory({ route }, 'text').split('\n');
    expect(text.slice(text.indexOf('  1  handle  route.ts:1-5'))).toEqual([
      '  1  handle  route.ts:1-5',
      '       if 2  then ✗',
      '  2  handle  route.ts:7-11',
      '       if 9  then ✗',
      '',
    ]);
  });

  it('draws a long route at the finest level that fits, and names the level below and how to reach it', () => {
    const long: Route = { ...ROUTE, before: [], route: [...through('src/a.ts', 150), ...through('src/b.ts', 150, 150)], interleaved: 0 };
    expect(formatStory({ route: long }, 'text')).toBe(
      [
        'story  src/cart.test.ts > cart > removes the last item',
        '  goes through 5 files in 300 steps',
        '  drawn by files: by declarations it would be 7798 characters, and a story is kept under 5000;',
        '  narrow it with --in <file>, --package <name> or --around <step>, or read every step with --whole',
        '',
        '  src/a.ts  steps 1-150',
        '  src/b.ts  steps 151-300',
        '',
      ].join('\n'),
    );
    expect(formatStory({ route: long, zoom: { whole: true } }, 'text').split('\n')).toHaveLength(2 + KEY.length + 3 + 300 + 1);
  });

  it('passes through the steps in another package of the workspace as one line, and a step back in the test\'s own ends it', () => {
    expect(formatStory({ route: APP, packages: PACKAGES }, 'text')).toBe(
      [
        'story  src/cart.test.ts > cart > removes the last item',
        '  goes through 2 files in 302 steps',
        '  drawn by steps: by every step it would be 8882 characters, and a story is kept under 5000;',
        '  narrow it with --in <file>, --package <name> or --around <step>, or read every step with --whole',
        '  passed through @acme/ui, one line for each series of steps in a row there; open one with --package <name>',
        ...KEY,
        '',
        '  in src: app.ts',
        '',
        '    1  render  app.ts:1-9',
        '    2  through @acme/ui, steps 2-301: part0, part1, part2, and 297 more',
        '  302  onClick  app.ts:10-12',
        '',
      ].join('\n'),
    );
  });

  it('opens a package with --package, and picks the level again inside what it opened', () => {
    const opened = JSON.parse(formatStory({ route: APP, packages: PACKAGES, zoom: { package: '@acme/ui' } }, 'json'));
    expect(opened).toMatchObject({ package: 'app', reading: { level: 'files' }, finer: { level: 'declarations' } });
    expect(opened.reading.files.map((file: { package: string }) => file.package)).toEqual(['app', '@acme/ui']);
    // Back and forth into three hundred files of the design system fits no level finer than its packages.
    const wide: Route = {
      ...APP,
      route: Array.from({ length: 300 }, (_, at) => [place('src/app.ts', 'render', 1, 9), place(`ui/src/part${at}.ts`, 'part', 1, 1)]).flat(),
    };
    const packageOf = { ...PACKAGES, ...Object.fromEntries(Array.from({ length: 300 }, (_, at) => [`ui/src/part${at}.ts`, '@acme/ui'])) };
    expect(JSON.parse(formatStory({ route: wide, packages: packageOf }, 'json')).reading).toEqual({
      level: 'packages',
      packages: [
        { package: 'app', own: true, files: 1, steps: Array.from({ length: 300 }, (_, at) => 1 + 2 * at) },
        { package: '@acme/ui', own: false, files: 300, steps: Array.from({ length: 300 }, (_, at) => 2 + 2 * at) },
      ],
    });
  });

  it('reads the steps through one file with the step either side, and names the steps it leaves out', () => {
    expect(formatStory({ route: ROUTE, zoom: { in: 'src/cart.test.ts' } }, 'text')).toBe(
      [
        ...HEAD,
        '  the steps through the file `src/cart.test.ts`, and the step either side of each run of them',
        ...KEY,
        ...FILES,
        '  before the test',
        '  1  beforeEach.arg0  cart.test.ts:3-8',
        '  the test',
        '  2  loaded 4 files: cart.ts, price.ts, format.ts, and 1 more',
        '     … steps 3-5 left out',
        '',
      ].join('\n'),
    );
    // A file is its whole path: one whose path holds what was asked is another file.
    expect(formatStory({ route: ROUTE, zoom: { in: 'cart.test' } }, 'text')).toBe(
      [...HEAD, '', '  the test does not go through the file `cart.test`', ''].join('\n'),
    );
  });

  it('reads a package only from --package, by its name', () => {
    expect(formatStory({ route: APP, packages: PACKAGES, zoom: { in: '@acme/ui' } }, 'text')).toContain(
      '  the test does not go through the file `@acme/ui`',
    );
    expect(formatStory({ route: APP, packages: PACKAGES, zoom: { package: '@acme' } }, 'text')).toContain(
      '  the test does not go through the package `@acme`',
    );
  });

  it('reads the steps around one, inside the loops they sit in', () => {
    expect(formatStory({ route: ROUTE, zoom: { around: 1 } }, 'text')).toBe(
      [
        ...HEAD,
        '  the 3 steps either side of step 1, and the loops they sit in',
        ...KEY,
        ...FILES,
        '  before the test',
        '  1  beforeEach.arg0  cart.test.ts:3-8',
        '  the test',
        '  2  loaded 4 files: cart.ts, price.ts, format.ts, and 1 more',
        '  3  Cart/removeItem  cart.ts:12-30',
        '       if 14  then ×1',
        '       for 18 ×40',
        '     steps 4-5 ran 40 times in all:',
        '  4    applyTier  price.ts:6-8 ×40',
        '       … step 5 left out',
        '',
      ].join('\n'),
    );
    expect(() => formatStory({ route: ROUTE, zoom: { around: 6 } }, 'text')).toThrow(
      '--around 6 is past the end: this route has 5 steps',
    );
  });

  it('prints what was said beside the step it was said at, and what was said before the first step', () => {
    const said: Route = {
      ...ROUTE,
      before: [],
      route: [{
        token: {
          ...place('src/cart.ts', 'Cart/removeItem', 12, 30).token,
          said: ['console.log removing A1', ...Array.from({ length: 6 }, (_, row) => `eyes commit Row${row}`)],
        },
      }],
      opening: { route: ['eyes arrange'] },
      files: ['src/cart.ts'],
      interleaved: 0,
    };
    const text = formatStory({ route: said, reading: { of: 3, label: 'slow', written: Date.UTC(2026, 8, 27, 12) } }, 'text').split('\n');
    expect(text.slice(0, 5)).toEqual([
      'story  src/cart.test.ts > cart > removes the last item',
      '  goes through 1 file in 1 step',
      '  the newest of 3 readings, labelled slow, written 2026-09-27T12:00:00.000Z; set them against each other with --compare',
      '  said as the test began, before its first step:',
      '    » eyes arrange',
    ]);
    expect(text.slice(-8)).toEqual([
      '  1  Cart/removeItem  cart.ts:12-30',
      '       » console.log removing A1',
      '       » eyes commit Row0',
      '       » eyes commit Row1',
      '       » eyes commit Row2',
      '       » eyes commit Row3',
      '       » and 2 more lines',
      '',
    ]);
  });

  it('keeps what the code printed at a step when a loop handed the function more than the lines a step shows', () => {
    const handed = Array.from({ length: 6 }, (_, row) => `handed row=${row}`);
    const said: Route = {
      ...ROUTE,
      before: [],
      route: [{ token: { ...place('src/cart.ts', 'Cart/removeItem', 12, 30).token, said: [...handed, 'console.log removing A1'] } }],
      files: ['src/cart.ts'],
      interleaved: 0,
    };
    const text = formatStory({ route: said, reading: { of: 1, written: Date.UTC(2026, 8, 27, 12) } }, 'text').split('\n');
    expect(text.slice(-9)).toEqual([
      '  1  Cart/removeItem  cart.ts:12-30',
      '       » handed row=0',
      '       » handed row=1',
      '       » handed row=2',
      '       » handed row=3',
      '       » handed row=4',
      '       » console.log removing A1',
      '       » and 1 more line',
      '',
    ]);
  });

  it('says, in place of the --compare hint, which side a reading drawn alone has nothing to compare with', () => {
    const unmatched = 'nothing to compare it with: every one of the 2 readings kept passed, and none threw';
    const text = formatStory({ route: ROUTE, reading: { of: 2, unmatched } }, 'text').split('\n');
    expect(text.slice(0, 4)).toEqual([...HEAD.slice(0, 2), '  the newest of 2 readings', `  ${unmatched}`]);
    expect(JSON.parse(formatStory({ route: ROUTE, reading: { of: 2, unmatched } }, 'json'))).toMatchObject({ readings: 2, unmatched });
  });

  it('names the project the case ran under, a page gone before it was read, and the page documents it ran in', () => {
    const route: Route = { ...ROUTE, project: 'webkit', lost: true, documents: 2 };
    expect(formatStory({ route }, 'text').split('\n').slice(0, 6)).toEqual([
      HEAD[0], '  under the project webkit', HEAD[1],
      '  a page the test ran in was gone before what it ran there was read, so the route is missing that',
      HEAD[2],
      '  ran in 2 page documents, each said where the route moves into it; a ref is its own document\'s,'
        + ' and what two of them did within one test line is in the order it reached the runner, not the order it ran',
    ]);
    expect(JSON.parse(formatStory({ route }, 'json'))).toMatchObject({ project: 'webkit', lost: true, documents: 2 });
  });

  it('gives the reading, its level and the numbered steps as json', () => {
    const { before: _before, route: _route, untaken: _untaken, ...head } = ROUTE;
    expect(JSON.parse(formatStory({ route: ROUTE, zoom: { around: 5 } }, 'json'))).toEqual({
      ...head,
      steps: 5,
      reading: {
        level: 'every step',
        lines: [
          { gap: [1, 1], depth: 0 },
          { step: 2, depth: 0, before: false, loaded: ['src/cart.ts', 'src/price.ts', 'src/format.ts', 'src/tax.ts'] },
          { step: 3, depth: 0, before: false, ...ROUTE.route[1]!.token },
          { repeats: 40, steps: [4, 5], depth: 0, before: false },
          { step: 4, depth: 1, before: false, ...ROUTE.route[2]!.repeat![0]!.token },
          { step: 5, depth: 1, before: false, ...ROUTE.route[2]!.repeat![1]!.token },
        ],
      },
    });
    // A hundred declarations visited three times over is three hundred steps, and a hundred places.
    const long: Route = { ...ROUTE, before: [], route: [1, 2, 3].flatMap(() => through('src/a.ts', 100)) };
    expect(JSON.parse(formatStory({ route: long }, 'json'))).toMatchObject({
      reading: { level: 'declarations', visits: [{ file: 'src/a.ts' }] },
      finer: { level: 'every step', characters: 6863 },
    });
  });

  it('takes one of --in, --package, --around and --whole', () => {
    expect(parseArgs(['story', '--around', '4'])).toMatchObject({ command: 'story', zoom: { around: 4 } });
    expect(parseArgs(['story', '--package', '@acme/ui'])).toMatchObject({ command: 'story', zoom: { package: '@acme/ui' } });
    expect(() => parseArgs(['story', '--in', 'src/cart.ts', '--package', '@acme/ui'])).toThrow(
      '--in and --package each choose how much of the route to read; name one',
    );
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
