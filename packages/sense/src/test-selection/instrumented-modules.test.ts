import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { digestString } from '@variance-authority/core/format';
import { afterEach, describe, expect, it } from 'vitest';
import {
  crossingsOf,
  defaultInclude,
  loadedOf,
  openRecords,
  readRecord,
  readRecords,
  idOrder,
  recordStore,
  writeRecord,
  type CapturedModule,
  type ReadJournal,
} from './instrumented-modules.js';
import { instrumentationId, type ModuleId } from '../instrument/index.js';
import { frameRecord, segmentHeader } from './record-format.js';

const cacheRoot = join(tmpdir(), `variance-records-${process.pid}`);
const storeOf = (label = 'build'): string => recordStore('/repo', label, cacheRoot);

const captured = (over: Partial<CapturedModule> = {}): CapturedModule => {
  const file = over.file ?? 'src/cart.js';
  return {
    file,
    id: file,
    sourceDigest: digestString('const total = () => 1;'),
    instrumented: true,
    blocks: [
      {
        ordinal: 0,
        kind: 'module',
        digest: digestString('whole'),
        name: '',
        path: 'module',
        startLine: 1,
        endLine: 4,
        source: true,
        testFiles: [],
      },
    ],
    ...over,
  };
};

afterEach(async () => {
  await rm(cacheRoot, { force: true, recursive: true });
});

describe('what the default include calls product source', () => {
  const root = resolve('/repo');

  it('takes an ordinary module', () => {
    expect(defaultInclude(resolve(root, 'src/cart.ts'))).toBe(true);
  });

  it('leaves a config file alone, because no setup shim runs where one is read', () => {
    // A config module is evaluated by the loader, in the Vitest process, before
    // any test environment exists. Instrumented, its first probe throws and the
    // run dies before a test file loads.
    for (const file of [
      'vite.config.ts',
      'vitest.config.ts',
      'vitest.config.mts',
      'vitest.checks.config.ts',
      'jest.config.js',
    ]) expect([file, defaultInclude(resolve(root, file))]).toEqual([file, false]);
  });

  it('still takes a module that only has `config` in its name', () => {
    expect(defaultInclude(resolve(root, 'src/config.ts'))).toBe(true);
    expect(defaultInclude(resolve(root, 'src/app-config.ts'))).toBe(true);
  });
});

describe('the id a module carries', () => {
  it('answers under the number the table gave it', async () => {
    writeRecord(openRecords(storeOf()), captured({ id: 41 }));

    expect((await readRecord(storeOf(), 41))?.file).toBe('src/cart.js');
    expect(await readRecord(storeOf(), 'src/cart.js')).toBeUndefined();
  });

  it('answers under its path until it has a number', async () => {
    writeRecord(openRecords(storeOf()), captured());

    expect((await readRecord(storeOf(), 'src/cart.js'))?.id).toBe('src/cart.js');
  });

  it('orders numbers before paths, so two folds of one run write one sequence', () => {
    const ids: ModuleId[] = ['src/b.js', 7, 'src/a.js', 2];

    expect(ids.sort(idOrder)).toEqual([2, 7, 'src/a.js', 'src/b.js']);
  });
});

describe('a store of module records', () => {
  it('answers for a module a writer appended', async () => {
    const module = captured();
    writeRecord(openRecords(storeOf()), module);

    expect(await readRecord(storeOf(), module.id)).toEqual(module);
  });

  it('writes nothing until there is a record to write', async () => {
    openRecords(storeOf());

    expect(await readRecord(storeOf(), 'src/cart.js')).toBeUndefined();
    await expect(readdir(storeOf())).rejects.toThrow();
  });

  it('has no answer for a module nobody transformed', async () => {
    writeRecord(openRecords(storeOf()), captured());

    expect(await readRecord(storeOf(), 'src/other.js')).toBeUndefined();
  });

  it('takes the later of two appends of one module', async () => {
    const writer = openRecords(storeOf());
    writeRecord(writer, captured({ sourceDigest: digestString('first') }));
    writeRecord(writer, captured({ sourceDigest: digestString('second') }));

    expect((await readRecord(storeOf(), 'src/cart.js'))?.sourceDigest).toBe(
      digestString('second'),
    );
  });

  it('reads every writer of a store, not whichever wrote last', async () => {
    writeRecord(openRecords(storeOf()), captured({ file: 'src/a.js' }));
    writeRecord(openRecords(storeOf()), captured({ file: 'src/b.js' }));

    const found = await readRecords([storeOf()], ['src/a.js', 'src/b.js']);

    expect([...found.values()].map((module) => module.file).sort()).toEqual([
      'src/a.js',
      'src/b.js',
    ]);
  });

  it('ignores a segment cut by another probe recipe', async () => {
    const store = storeOf();
    await mkdir(store, { recursive: true });
    await writeFile(
      resolve(store, 'foreign.rec'),
      Buffer.concat([segmentHeader('sense:instrument/presence-v1'), frameRecord(captured())]),
    );

    expect(await readRecord(store, 'src/cart.js')).toBeUndefined();
  });

  it('keeps the records of one recipe from a reader of the other', async () => {
    // Ordinal 1 is a function under `entries` and may be an `else` under
    // `presence`: a store is opened under one recipe and read under the same.
    const store = storeOf();
    const writer = openRecords(store, instrumentationId('entries'));
    await writeRecord(writer, captured());

    expect(await readRecord(store, 'src/cart.js')).toBeUndefined();
    expect(await readRecord(store, 'src/cart.js', instrumentationId('entries')))
      .toEqual(expect.objectContaining({ file: 'src/cart.js' }));
  });

  it('ignores a file in the store that is not a segment at all', async () => {
    const store = storeOf();
    await mkdir(store, { recursive: true });
    await writeFile(resolve(store, 'stray.rec'), '{"modules":[]}');
    writeRecord(openRecords(store), captured());

    expect(await readRecord(store, 'src/cart.js')).toEqual(captured());
  });

  it('answers for the modules before a write that was interrupted', async () => {
    const store = storeOf();
    const writer = openRecords(store);
    writeRecord(writer, captured({ file: 'src/a.js' }));
    writeRecord(writer, captured({ file: 'src/b.js' }));

    const [name] = await readdir(store);
    const whole = await readFile(resolve(store, name!));
    await writeFile(resolve(store, name!), whole.subarray(0, whole.length - 24));

    const found = await readRecords([store], ['src/a.js', 'src/b.js']);

    expect([...found.keys()]).toEqual(['src/a.js']);
  });

  it('records a module two builds disagree about as one nobody may attribute', async () => {
    writeRecord(openRecords(storeOf('app')), captured({ sourceDigest: digestString('one') }));
    writeRecord(openRecords(storeOf('preview')), captured({ sourceDigest: digestString('two') }));

    const found = await readRecords(
      [storeOf('app'), storeOf('preview')],
      ['src/cart.js'],
    );

    expect(found.get('src/cart.js')).toEqual({
      file: 'src/cart.js',
      id: 'src/cart.js',
      sourceDigest: digestString('one'),
      instrumented: false,
      blocks: [],
    });
  });

  it('keeps a module two builds agree about', async () => {
    writeRecord(openRecords(storeOf('app')), captured());
    writeRecord(openRecords(storeOf('preview')), captured());

    const found = await readRecords(
      [storeOf('app'), storeOf('preview')],
      ['src/cart.js'],
    );

    expect(found.get('src/cart.js')).toEqual(captured());
  });

  it('names one directory per build, under the repository it is a build of', () => {
    expect(storeOf('app')).not.toBe(storeOf('preview'));
    expect(storeOf()).toContain('variance-authority');
    expect(recordStore('/repo', 'build', cacheRoot)).not.toBe(
      recordStore('/other', 'build', cacheRoot),
    );
  });
});

describe('the fold of a run\'s journals', () => {
  const journals: readonly ReadJournal[] = [
    { testFile: 'test/alpha.case.ts', modules: [{ id: 7, hits: [0, 1, 2], shared: [0, 1], loaded: [0, 1] }] },
    { testFile: 'test/beta.case.ts', modules: [{ id: 7, hits: [0, 3], shared: [0], loaded: [0] }] },
    { testFile: 'test/gamma.case.ts', modules: [] },
  ];
  const rows = (fold: ReadonlyMap<ModuleId, ReadonlyMap<number, ReadonlySet<string>>>): unknown =>
    [...fold.get(7)!].map(([ordinal, tests]) => [ordinal, [...tests].sort()]);

  it('credits what a module did while evaluating to every file that consumed it', () => {
    expect(rows(crossingsOf(journals))).toEqual([
      [0, ['test/alpha.case.ts', 'test/beta.case.ts']],
      [1, ['test/alpha.case.ts', 'test/beta.case.ts']],
      [2, ['test/alpha.case.ts']],
      [3, ['test/beta.case.ts']],
    ]);
  });

  it('folds what ran before the first test under the same crediting', () => {
    // Ordinal 1 ran while the module evaluated, and evaluation happened before
    // the first test of every file that consumed it — beta included, whose own
    // snapshot never saw it because alpha's window evaluated the module.
    expect(rows(loadedOf(journals))).toEqual([
      [0, ['test/alpha.case.ts', 'test/beta.case.ts']],
      [1, ['test/alpha.case.ts', 'test/beta.case.ts']],
    ]);
  });
});
