import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Placement } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';

/** The held text an edit wrote three lines into, above `total`; none when the case leaves it unset. */
let held: Placement | undefined;

vi.mock('./covering-frame.js', async (original) => {
  const frame = await original<typeof import('./covering-frame.js')>();
  return { ...frame, placementFor: async (...asked: Parameters<typeof frame.placementFor>) => held ?? frame.placementFor(...asked) };
});

const THREE_DOWN: Placement = {
  frame: 'mapped',
  place: (range) => ({ lines: { startLine: range.startLine + 3, endLine: range.endLine + 3 }, moved: true }),
  recordedLine: (line) => (line <= 3 ? undefined : line - 3),
};

/** `total` spans lines 4-8, and nobody took the one-line branch on line 6. */
const INDEX = {
  tests: [{ id: 'a.test.ts > adds', file: 'a.test.ts', name: 'adds', stopped: false }],
  modules: [{
    file: 'src/cart.ts',
    blocks: [
      { kind: 'function', name: 'total', path: 'entry', startLine: 4, endLine: 8, source: true, crossings: [{ test: 0, distance: 0 }] },
      { kind: 'branch', name: 'total', path: 'if#0/then', startLine: 6, endLine: 6, source: true, crossings: [] },
    ],
  }],
};

async function ask(...flags: readonly string[]) {
  const dir = await mkdtemp(join(tmpdir(), 'variance-covering-hidden-'));
  const execution = join(dir, 'cases.json');
  await writeFile(execution, JSON.stringify(INDEX));
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: 'cart' }));
  return covering(parseCoveringArgs(readFlags(
    ['--file', 'src/cart.ts', '--execution', execution, '--root', dir, ...flags],
    'covering', flagsFor('covering'), synopsisFor('covering'),
  )));
}

describe('the whole-file answer over a range that only ran while its module loaded', () => {
  it('says it is loaded once, and never calls it a hole beneath that', async () => {
    const answer = await ask();
    const stopped = [{ id: 'b.test.ts > throws', file: 'b.test.ts', name: 'throws', stopped: true }];
    const ranges = [{ startLine: 1, endLine: 2, state: 'loaded' as const, loaded: true as const, tests: [], stopped }];

    const text = formatCovering({ ...answer, ranges }, 'text');

    expect(text).toContain('lines 1-2 — loaded\n');
    expect(text).not.toContain('a hole');
  });
});

describe('the whole-file answer over a one-line region no case entered', () => {
  it('gives the region its own range and says nobody entered it', async () => {
    const answer = await ask();

    expect(formatCovering(answer, 'text')).toBe([
      'src/cart.ts — 3 recorded ranges, 1 named test',
      'lines 4-5 — alone',
      '  a.test.ts',
      '    adds',
      'line 6 — alone',
      '  the same named test as lines 4-5',
      '  no case entered the branch on line 6, and every case that could have reached it finished: unwalked.',
      'lines 7-8 — alone',
      '  the same named test as lines 4-5',
      '',
    ].join('\n'));
  });

  it('names under the region the stopped cases that could have reached it', async () => {
    const answer = await ask();
    const stopped = [{ id: 'b.test.ts > throws', file: 'b.test.ts', name: 'throws', stopped: true }];
    const ranges = answer.ranges!.map((range) => range.unentered === undefined ? range : { ...range, unentered: range.unentered.map((region) => ({ ...region, stopped })) });

    expect(formatCovering({ ...answer, ranges }, 'text')).toContain([
      'line 6 — alone',
      '  the same named test as lines 4-5',
      '  no case entered the branch on line 6 — a hole: a case that could have reached it stopped first, so the record cannot see it.',
      '    stopped: b.test.ts > throws',
      '',
    ].join('\n'));
  });

  it('says it in the refs an agent reads', async () => {
    expect(formatCovering(await ask(), 'refs')).toContain('6 alone: 1; unentered branch 6 unwalked\n');
  });

  it('keeps the region apart in an answer a flag narrowed', async () => {
    const answer = await ask('--in-package');

    expect(answer.ranges?.map((range) => [range.startLine, range.endLine])).toEqual([[4, 5], [6, 6], [7, 8]]);
    expect(formatCovering(answer, 'text')).toContain('  no case entered the branch on line 6, and every case that could have reached it finished: unwalked.\n');
  });
});

describe('the whole-file answer over a file edited since the run', () => {
  afterEach(() => { held = undefined; });

  it('names the region no case entered where its line stands now', async () => {
    held = THREE_DOWN;
    const answer = await ask();

    expect(answer.ranges?.find((range) => range.startLine === 9)?.unentered).toMatchObject([{ startLine: 9, endLine: 9 }]);
    expect(formatCovering(answer, 'text')).toContain('  no case entered the branch on line 9, and every case that could have reached it finished: unwalked.\n');
    expect(formatCovering(answer, 'refs')).toContain('unentered branch 9 unwalked');
  });
});
