import { execFileSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { storyDirectory, type Comparison, type Side, type StoryEntry } from '@variance-authority/sense/story';
import {
  encodeAsSetExecutionIndex,
  testCoverageFile,
  writeTestCoverage,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import { parseArgs } from '../bin.js';
import { formatStory, story } from './story.js';

let written: StoryEntry[] = [];
let compared: [Side, Side] | undefined;

// The store and the comparison are cut at the reader: what the run wrote is
// `written`, and a comparison is the two sides it was handed. What the case
// said and the axes it is read on are the record's and the config's, read for real.
vi.mock('@variance-authority/sense/story', async (original) => ({
  ...(await original<typeof import('@variance-authority/sense/story')>()),
  listStories: () => written,
  compareReadings: (_root: string, a: Side, b: Side): Comparison => {
    compared = [a, b];
    const side = (one: Side) => ({ name: one.name, readings: one.readings.length, stopped: 0 });
    return {
      file: 'src/pay.test.ts', name: a.readings[0]!.name,
      sides: [side(a), side(b)],
      places: [{ side: a.name, items: [] }, { side: b.name, items: [] }],
      said: [{ side: a.name, items: [] }, { side: b.name, items: [] }],
      reversed: [], unsteady: { places: 0, said: 0, order: 0 }, single: true,
    };
  },
  readRoute: (_root: string, path: string) => {
    const entry = written.find((each) => each.path === path)!;
    return { file: entry.file, name: entry.name, before: [], route: [], files: [entry.file], unresolved: [], untaken: [], untaped: 0, interleaved: 0 };
  },
}));

const FILE = 'src/pay.test.ts';

function said(name: string, held: readonly (readonly [string, string])[], file = FILE): ExecutionTest {
  return { id: `${file} > ${name}`, file, name, said: JSON.stringify(held.map(([key, value]) => [key, value, `${file}:3`, 1])) };
}

/**
 * `charges` says the flag on, and `charges off` stands at its base beside it.
 * `as mike` stands at the base too, but said a user, so it is nobody's twin;
 * `elsewhere` stands at the base in another file, and `alone` says the flag on
 * in a file of its own.
 */
const TESTS = [
  said('charges', [['flag', 'on']]),
  said('charges off', [['flag', 'off']]),
  said('as mike', [['user', 'mike']]),
  said('elsewhere', [], 'src/other.test.ts'),
  said('alone', [['flag', 'on']], 'src/alone.test.ts'),
];

async function checkout(config: object = { names: { axes: [{ axis: 'flag', values: ['off', 'on'] }] } }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'variance-story-twin-'));
  execFileSync('git', ['init', '--quiet', root]);
  await writeFile(join(root, 'variance.config.json'), JSON.stringify({ cacheRoot: 'cache', ...config }));
  await writeTestCoverage(testCoverageFile(root), { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, {
    index: encodeAsSetExecutionIndex({ tests: TESTS, modules: [] }),
  });
  return root;
}

/** Readings of `name`, newest first, beside the record that holds what it said. */
function readings(root: string, name: string, count: number, file = FILE): StoryEntry[] {
  const directory = storyDirectory(testCoverageFile(root));
  return Array.from({ length: count }, (_, at) => ({ path: join(directory, `${name}.${at}.story`), file, name, visits: 2, written: 100 - at }));
}

const ask = async (root: string, name: string) =>
  story({ ...(parseArgs(['story', '--name', name, '--compare', 'twin', '--root', root]) as Parameters<typeof story>[0]) });

beforeEach(() => {
  written = [];
  compared = undefined;
});

describe('a case compared with its twin', () => {
  it('sets the case\'s readings, under what it said, against its twin\'s, under the value one step toward the base', async () => {
    const root = await checkout();
    written = [...readings(root, 'charges', 2), ...readings(root, 'charges off', 3)];

    const answer = await ask(root, 'charges');

    expect(compared?.map((side) => [side.name, side.readings.map((entry) => entry.name)])).toEqual([
      ['flag=on', ['charges', 'charges']],
      ['flag=off', ['charges off', 'charges off', 'charges off']],
    ]);
    expect(formatStory(answer, 'text').split('\n').slice(0, 3)).toEqual([
      'compare  src/pay.test.ts > charges',
      '  twin at flag=off: charges off',
      '  flag=on (2 readings) against flag=off (3 readings)',
    ]);
    expect(JSON.parse(formatStory(answer, 'json'))).toMatchObject({
      twin: { case: `${FILE} > charges`, axis: 'flag', from: 'on', to: 'off', twins: [`${FILE} > charges off`] },
    });
  });

  it('draws the case alone, and says how to write the twin\'s story, when the twin has none', async () => {
    const root = await checkout();
    written = readings(root, 'charges', 1);

    expect(await ask(root, 'charges')).toMatchObject({
      reading: { unmatched: 'nothing to compare it with: its twin at flag=off, charges off, has no story here; run it with VARIANCE_AUTHORITY_STORY=1' },
    });
    expect(compared).toBeUndefined();
  });

  it('reads the twin\'s readings beside the same record only, not another suite\'s', async () => {
    const root = await checkout();
    const elsewhere = readings(root, 'charges off', 1).map((entry) => ({ ...entry, path: join(root, 'other-suite', 'charges off.0.story') }));
    written = [...readings(root, 'charges', 1), ...elsewhere];

    expect(await ask(root, 'charges')).toMatchObject({
      reading: { unmatched: 'nothing to compare it with: its twin at flag=off, charges off, has no story here; run it with VARIANCE_AUTHORITY_STORY=1' },
    });
  });

  it('draws the case alone when no case of its file stands at the value below, though one in another file does', async () => {
    const root = await checkout();
    written = [...readings(root, 'alone', 1, 'src/alone.test.ts'), ...readings(root, 'elsewhere', 1, 'src/other.test.ts')];

    expect(await ask(root, 'alone')).toMatchObject({
      reading: { unmatched: 'nothing to compare it with: no case in its file is recorded at flag=off' },
    });
  });

  it('draws the case alone when it stands at the base of every declared axis', async () => {
    const root = await checkout();
    written = readings(root, 'as mike', 1);

    expect(await ask(root, 'as mike')).toMatchObject({
      reading: { unmatched: 'nothing to compare it with: it said no value off the base of any axis `names.axes` declares, so it has no twin' },
    });
  });

  it('draws the case alone when no axis is declared', async () => {
    const root = await checkout({});
    written = readings(root, 'charges', 1);

    expect(await ask(root, 'charges')).toMatchObject({
      reading: { unmatched: 'nothing to compare it with: the root variance.config.json declares no `names.axes`, so no case has a twin' },
    });
  });

  it('draws the case alone when the record beside its story never heard what it said', async () => {
    const root = await checkout();
    written = [{ ...readings(root, 'charges', 1)[0]!, name: 'unrecorded' }];

    expect(await ask(root, 'unrecorded')).toMatchObject({
      reading: { unmatched: 'nothing to compare it with: the record beside its story holds no preconditions for it, so it has no twin' },
    });
  });

  it('is asked for as --compare twin', () => {
    expect(parseArgs(['story', '--compare', 'twin'])).toMatchObject({ compare: 'twin' });
    expect(() => parseArgs(['story', '--compare', 'sibling'])).toThrow('--compare takes last, outcome, twin, or two labels as <a>,<b>, not `sibling`');
  });
});
