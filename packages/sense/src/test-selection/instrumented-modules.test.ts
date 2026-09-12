import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { digestString } from '@variance-authority/core/format';
import { afterEach, describe, expect, it } from 'vitest';
import {
  openRecords,
  readRecord,
  readRecords,
  idOrder,
  recordStore,
  writeRecord,
  type CapturedModule,
} from './instrumented-modules.js';
import type { ModuleId } from '../instrument/index.js';
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
