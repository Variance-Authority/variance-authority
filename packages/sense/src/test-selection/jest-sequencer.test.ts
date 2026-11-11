import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Sequencer from './jest-sequencer.cjs';
import filter from './jest-filter.cjs';
import { CACHE_VARIABLE } from './cache-layers.js';
import { PLACING_SEQUENCER, placingSequencer } from './jest-placing.js';
import { placingPaths, selectingFilter } from './jest-selection.js';
import { withTestSelection } from './jest.js';
import { writeFetchedMainline } from './mainline-layer.js';

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
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  delete (globalThis as { [HANDED]?: unknown })[HANDED];
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('the Jest sequencer when a selected run has no file to run', () => {
  const UNFOUND = 'variance-authority: Jest left no test file to select from';
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

  it('places the waves of one shard as one selection, so its waves together take one part', async () => {
    const part = async (index: number, skip: readonly string[]) => {
      const wave = { whole: new Set(files), skip: new Set(skip), placing: { skip: new Set<string>() }, notes: [] };
      selectingFilter({}, { root, rootDir, selection: async () => wave, argv: ['jest'], say: () => {} });
      placingSequencer({}, { root, rootDir, times, placing: placingPaths, say: () => {}, argv: ['jest', '--shard=1/2'] });
      const { filtered } = await filter(files.map((file) => resolve(root, file)));
      return paths(await sequencer().shard(filtered.map((path) => test(path.slice(root.length + 1))), { shardIndex: index, shardCount: 2 }));
    };
    const near = ['c.test.ts', 'd.test.ts'];
    const far = ['a.test.ts', 'b.test.ts'];

    expect([await part(1, near), await part(1, far)]).toEqual([['a.test.ts'], []]);
    expect([await part(2, near), await part(2, far)]).toEqual([['b.test.ts'], ['c.test.ts', 'd.test.ts']]);
  });

  it('places what a later run in the same process hands it when that run selects nothing', async () => {
    const wave = { whole: new Set(files), skip: new Set<string>(), placing: { skip: new Set<string>() }, notes: [] };
    selectingFilter({}, { root, rootDir, selection: async () => wave, argv: ['jest'], say: () => {} });
    await filter(['a.test.ts', 'b.test.ts'].map((file) => resolve(root, file)));

    placingSequencer({}, { root, rootDir, times, say: () => {}, argv: ['jest', '--shard=1/2'] });
    const first = await sequencer().shard(files.map(test), { shardIndex: 1, shardCount: 2 });
    const second = await sequencer().shard(files.map(test), { shardIndex: 2, shardCount: 2 });

    expect([...paths(first), ...paths(second)].sort()).toEqual(files);
  });

  // `runCLI` hands Jest a shard no command line spells: it is still one shard,
  // so handed a read it records alone and reads that read, as `--shard` does,
  // and handed none it lands over its own record and reads that.
  it.each([
    ['reads the record it was handed', true],
    ['reads its own record, handed none,', false],
  ])('%s when Jest was given a shard the command line does not spell', async (_, handed) => {
    const checkout = await mkdtemp(resolve(tmpdir(), 'variance-jest-shard-'));
    temporary.push(checkout);
    const cache = resolve(checkout, 'cache');
    vi.stubEnv(CACHE_VARIABLE, cache);
    if (handed) await writeFetchedMainline(cache, 'unit', { mainline: 'main', commit: 'a'.repeat(40), fetched: new Date().toISOString(), handed: true });
    await writeFile(resolve(checkout, 'variance.config.json'), JSON.stringify({ suites: { unit: { kind: 'unit' } } }));
    const cli = resolve(checkout, 'node_modules', '@variance-authority', 'cli');
    await mkdir(cli, { recursive: true });
    await writeFile(resolve(cli, 'package.json'), JSON.stringify({ name: '@variance-authority/cli', type: 'module', main: 'index.js' }));
    await writeFile(
      resolve(cli, 'index.js'),
      'export async function selectSuite(request) { globalThis.__beneath.push(["selection", request.beneath ?? false]); return { whole: new Set(), skip: new Set(), notes: [] }; }\n' +
        'export async function suiteTimes(request) { globalThis.__beneath.push(["times", request.beneath ?? false]); return { unread: "a fixture" }; }\n',
    );
    await writeFile(resolve(checkout, 'own.cjs'), 'module.exports = class { sort(tests) { return tests; } };\n');
    // The checkout's Jest is the one this package tests against.
    await symlink(dirname(createRequire(import.meta.url).resolve('jest/package.json')), resolve(checkout, 'node_modules', 'jest'));
    const asked: [string, boolean][] = [];
    (globalThis as { __beneath?: typeof asked }).__beneath = asked;
    vi.stubEnv('VARIANCE_AUTHORITY_SINCE', '');
    vi.spyOn(process, 'argv', 'get').mockReturnValue(['node', 'jest']);
    vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    withTestSelection({ testSequencer: '<rootDir>/own.cjs' }, { root: checkout, suite: 'unit' });
    const shard = { shardIndex: 1, shardCount: 2 };

    // Jest makes its sequencer with the global configuration before any filter runs.
    const made = new Sequencer({ contexts: [], globalConfig: { shard } } as never);
    const { filtered } = await filter([resolve(checkout, 'a.test.ts')]);
    await made.shard(filtered.map((path) => ({ path, context: { config: { rootDir: checkout } } })), shard);

    expect(asked).toEqual([['selection', handed], ['times', handed]]);
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
