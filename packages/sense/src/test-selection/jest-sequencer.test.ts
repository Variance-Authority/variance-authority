import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import Sequencer from './jest-sequencer.cjs';
import { PLACING_SEQUENCER, placingSequencer } from './jest-placing.js';

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

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('the Jest sequencer under --shard', () => {
  it('places files by the times recorded, and says what the shard takes', async () => {
    const lines: string[] = [];
    expect(placingSequencer({}, { root, rootDir, times, say: (line) => lines.push(line) })).toEqual({ testSequencer: PLACING_SEQUENCER });

    const first = await sequencer().shard(files.map(test), { shardIndex: 1, shardCount: 2 });
    const second = await sequencer().shard(files.map(test), { shardIndex: 2, shardCount: 2 });

    expect(paths(first)).toEqual(['a.test.ts']);
    expect(paths(second)).toEqual(['b.test.ts', 'c.test.ts', 'd.test.ts']);
    expect(lines).toEqual(['variance-authority: shard 1/2 by the times recorded at eeeeeeeeeeee: 1 of 4 files, 9.0 s (shards 9.0 s to 9.0 s)']);
  });

  it('hands the shard to Jest\'s own split when nothing is timed, and says so', async () => {
    const lines: string[] = [];
    placingSequencer({}, { root, rootDir, times: async () => ({ unread: 'nothing is recorded there' }), say: (line) => lines.push(line) });

    const first = await sequencer().shard(files.map(test), { shardIndex: 1, shardCount: 2 });
    const second = await sequencer().shard(files.map(test), { shardIndex: 2, shardCount: 2 });

    expect([...paths(first), ...paths(second)].sort()).toEqual(files);
    expect(lines[0]).toBe('variance-authority: shard 1/2 split by the runner, by count: no times at the record: nothing is recorded there');
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

  it('wraps a configuration once', () => {
    expect(placingSequencer({ testSequencer: PLACING_SEQUENCER }, { root, rootDir, times, say: () => {} })).toEqual({});
  });
});
