import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import Sequencer from './jest-sequencer.cjs';
import filter from './jest-filter.cjs';
import { PLACING_SEQUENCER, placingSequencer } from './jest-placing.js';
import { selectingFilter } from './jest-selection.js';

const root = resolve('/checkout');
/** A directory that resolves the Jest this repository tests against. */
const rootDir = fileURLToPath(new URL('.', import.meta.url));
const test = (file: string) => ({ path: resolve(root, file), context: { config: { rootDir: root } } });
const paths = (tests: readonly { path: string }[]) => tests.map((one) => one.path.slice(root.length + 1));
const files = ['a.test.ts', 'b.test.ts', 'c.test.ts', 'd.test.ts'];
const times = async () => ({
  recording: '/cache/unit.bin',
  commit: 'e'.repeat(40),
  times: new Map([['a.test.ts', 9000], ['b.test.ts', 4000], ['c.test.ts', 3000], ['d.test.ts', 2000]]),
});
const sequencer = () => new Sequencer({ contexts: [], globalConfig: {} } as never);
const temporary: string[] = [];
/** Where a selecting configuration leaves its filter, which one test must not hand the next. */
const HANDED = Symbol.for('variance-authority:jest-selection');

afterEach(async () => {
  delete (globalThis as { [HANDED]?: unknown })[HANDED];
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('the Jest sequencer when a selected run has no file to run', () => {
  const UNFOUND = 'variance-authority: Jest found no test file';
  const selecting = (config: { readonly [key: string]: unknown } = {}, argv: readonly string[] = ['jest']) => {
    const skip = new Set(['a.test.ts']);
    const configured = selectingFilter(config, { root, rootDir, selection: async () => ({ whole: skip, skip, notes: [] }), argv, say: () => {} });
    placingSequencer(config, { root, rootDir, times, say: () => {}, argv });
    return configured;
  };
  const sorted = async (globalConfig: { readonly [key: string]: unknown } = {}, tests: readonly unknown[] = []) =>
    new Sequencer({ contexts: [], globalConfig } as never).sort(tests as never);

  it('refuses a run no project found a file for', async () => {
    selecting();
    await filter([]);
    await filter([]);

    await expect(sorted()).rejects.toThrow(UNFOUND);
  });

  it('refuses a run whose filter Jest never called, as a configuration\'s skipFilter leaves it', async () => {
    selecting();

    await expect(sorted()).rejects.toThrow(UNFOUND);
  });

  it('passes a run whose selection kept none of what one project found', async () => {
    selecting();
    await filter([]);
    await filter([resolve(root, 'a.test.ts')]);

    await expect(sorted()).resolves.toEqual([]);
  });

  it('leaves a run alone that has a file to run, whatever the filter saw', async () => {
    selecting();

    await expect(sorted({}, [test('a.test.ts')])).resolves.toHaveLength(1);
  });

  it.each([
    ['--onlyChanged', { onlyChanged: true }],
    ['--lastCommit', { lastCommit: true }],
    ['--listTests', { listTests: true }],
    ['--collectTests', { collectTests: true }],
  ])('leaves the exit to Jest under %s, which does not fail a run with no file', async (_flag, globalConfig) => {
    selecting();
    await filter([]);

    await expect(sorted(globalConfig)).resolves.toEqual([]);
  });

  it.each([
    ['the configuration', { passWithNoTests: true }, ['jest']],
    ['--passWithNoTests', {}, ['jest', '--passWithNoTests']],
    ['--pass-with-no-tests', {}, ['jest', '--pass-with-no-tests']],
  ])('leaves a run with no file passing when %s says so', async (_who, config, argv) => {
    selecting(config, argv);
    await filter([]);

    await expect(sorted()).resolves.toEqual([]);
  });

  it('still refuses when the configuration\'s false stands', async () => {
    selecting({ passWithNoTests: false });
    await filter([]);

    await expect(sorted()).rejects.toThrow(UNFOUND);
  });

  it('has nothing to say on a run the selection did not wrap', async () => {
    expect(selecting({}, ['jest', '--watch'])).toEqual({});

    await expect(sorted()).resolves.toEqual([]);
  });
});

describe('the Jest sequencer under --shard', () => {
  it('places files by the times recorded, and says what the shard takes', async () => {
    const lines: string[] = [];
    expect(placingSequencer({}, { root, rootDir, times, say: (line) => lines.push(line), argv: ['jest', '--shard=1/2'] }))
      .toEqual({ testSequencer: PLACING_SEQUENCER, passWithNoTests: true });

    const first = await sequencer().shard(files.map(test), { shardIndex: 1, shardCount: 2 });
    const second = await sequencer().shard(files.map(test), { shardIndex: 2, shardCount: 2 });

    expect(paths(first)).toEqual(['a.test.ts']);
    expect(paths(second)).toEqual(['b.test.ts', 'c.test.ts', 'd.test.ts']);
    expect(lines).toEqual(['variance-authority: shard 1/2 by the times recorded at eeeeeeeeeeee: 1 of 4 files, 9.0 s (shards 9.0 s to 9.0 s)']);
  });

  it('places whole files by count when nothing is timed, and says why', async () => {
    const lines: string[] = [];
    placingSequencer({}, { root, rootDir, times: async () => ({ unread: 'nothing is recorded there' }), say: (line) => lines.push(line) });

    const first = await sequencer().shard(files.map(test), { shardIndex: 1, shardCount: 2 });
    const second = await sequencer().shard(files.map(test), { shardIndex: 2, shardCount: 2 });

    expect(paths(first)).toEqual(['a.test.ts', 'c.test.ts']);
    expect(paths(second)).toEqual(['b.test.ts', 'd.test.ts']);
    expect(lines[0]).toBe('variance-authority: shard 1/2 by file count: 2 of 4 files; no times at the record: nothing is recorded there');
  });

  it('keeps the project\'s own passWithNoTests', () => {
    expect(placingSequencer({ passWithNoTests: false }, { root, rootDir, times, say: () => {}, argv: ['jest', '--shard', '1/2'] }))
      .toEqual({ testSequencer: PLACING_SEQUENCER });
  });

  it('lets a shard left no file pass, in either spelling of --shard, and an unsharded run that finds none fail', () => {
    const asked = (argv: string[]) => placingSequencer({}, { root, rootDir, times, say: () => {}, argv }).passWithNoTests;

    expect(asked(['jest', '--shard', '2/3'])).toBe(true);
    expect(asked(['jest', '--shard=2/3'])).toBe(true);
    expect(asked(['jest'])).toBeUndefined();
    expect(asked(['jest', '--', 'shard.test.ts'])).toBeUndefined();
  });

  it('chains the project\'s own sequencer for everything but the shard', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-jest-sequencer-'));
    temporary.push(directory);
    await writeFile(resolve(directory, 'reversing.cjs'), [
      'module.exports = class Reversing {',
      '  sort(tests) { return [...tests].reverse(); }',
      '  shard(tests) { return tests.slice(0, 1); }',
      '};',
    ].join('\n'));
    placingSequencer({ testSequencer: '<rootDir>/reversing.cjs' }, { root, rootDir: directory, times, say: () => {} });

    const sorted = await sequencer().sort(files.map(test));

    expect(paths(sorted)).toEqual(['d.test.ts', 'c.test.ts', 'b.test.ts', 'a.test.ts']);
  });

  it('finds Jest\'s own sequencer through Jest when the project cannot resolve it, as under pnpm', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-jest-unhoisted-'));
    temporary.push(directory);
    const chain = ['jest', '@jest/core', 'jest-config', '@jest/test-sequencer'];
    let at = directory;
    for (const name of chain) {
      at = resolve(at, 'node_modules', name);
      await mkdir(at, { recursive: true });
      await writeFile(resolve(at, 'package.json'), JSON.stringify({ name, main: 'index.js' }));
      await writeFile(resolve(at, 'index.js'), name === '@jest/test-sequencer'
        ? 'module.exports = class Nested { sort(tests) { return [...tests].reverse(); } };'
        : 'module.exports = {};');
    }
    placingSequencer({}, { root, rootDir: directory, times, say: () => {} });

    const sorted = await sequencer().sort(files.map(test));

    expect(paths(sorted)).toEqual(['d.test.ts', 'c.test.ts', 'b.test.ts', 'a.test.ts']);
  });

  it('names Jest\'s own sequencer when neither it nor Jest can be found', async () => {
    const directory = await mkdtemp(resolve(tmpdir(), 'variance-jest-absent-'));
    temporary.push(directory);
    placingSequencer({}, { root, rootDir: directory, times, say: () => {} });

    await expect(async () => sequencer().sort(files.map(test))).rejects.toThrow(/@jest\/test-sequencer/);
  });

  it('wraps a configuration once', () => {
    expect(placingSequencer({ testSequencer: PLACING_SEQUENCER }, { root, rootDir, times, say: () => {} })).toEqual({});
  });
});
