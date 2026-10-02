import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import { coverageTest, readFinished, readJournals } from './finished-files.js';
import journalFormat from './journal-format.cjs';
import type { CapturedModule } from './instrumented-modules.js';

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'va-finished-files-'));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('a run directory nothing was written to', () => {
  it('reads as a run whose workers left no journal', async () => {
    expect(await readJournals(join(directory, 'never'))).toEqual([]);
  });

  it('reads as a run whose runners finished no file', async () => {
    expect(await readFinished(join(directory, 'never'))).toEqual([]);
  });
});

describe('the preconditions of a test file', () => {
  const module = (id: string, instrumented: boolean): CapturedModule => ({
    file: id,
    id,
    sourceDigest: `source:${id}`,
    instrumented,
    blocks: [],
  });

  it('are the modules it entered that no probe can see inside, and not the instrumented ones', async () => {
    const test = join(directory, 'a.test.ts');
    await writeFile(test, 'test');
    const run = join(directory, 'run');
    await mkdir(run);
    await writeFile(join(run, 'worker'), journalFormat.encodeJournal(test, new Map([
      ['lib.ts', new Uint32Array([1])],
      ['vendor.js', new Uint32Array(0)],
    ])));
    const modules = new Map([
      ['lib.ts', module('lib.ts', true)],
      ['vendor.js', module('vendor.js', false)],
    ]);

    const row = await coverageTest(
      { filepath: test, complete: true },
      directory,
      [],
      await readJournals(run),
      modules,
    );

    expect(row).toMatchObject({ file: 'a.test.ts', complete: true });
    expect(row.preconditions).toEqual([
      { name: 'a.test.ts', digest: digestString('test') },
      { name: 'vendor.js', digest: 'source:vendor.js' },
    ]);
  });
});
