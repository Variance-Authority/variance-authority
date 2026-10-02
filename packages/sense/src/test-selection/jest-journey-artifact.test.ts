import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { native, nativeAvailable } from '../native.js';
import preconditions from './case-preconditions.cjs';
import { packCase, packFrames } from './cases.js';
import { decodeExecutionIndex } from './execution-format.js';
import { stitchJourneyArtifacts } from './jest-journey-artifact.js';
import journalFormat from './journal-format.cjs';

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

type Said = Parameters<typeof preconditions.packSaid>[1];

const file = '/repo/test/pay.test.ts';

function owner(name: string, said?: Said): string {
  return said === undefined ? packCase(file, name, name) : preconditions.packSaid(packCase(file, name, name), said);
}

/** One shard's journey artifact, folded by the addon from the frames it wrote. */
async function shard(root: string, name: string, owners: readonly string[]): Promise<string> {
  const cases = resolve(root, name);
  await mkdir(cases);
  await writeFile(resolve(cases, 'worker.vac'), packFrames(owners.map((packed) => journalFormat.encodeJournal(packed, new Map()))));
  const output = resolve(root, `${name}.bin`);
  native()!.foldJourneyTo!(cases, '/repo', [], 'sense:instrument/presence-v5', output);
  return output;
}

describe.runIf(nativeAvailable())('stitched shard artifacts', () => {
  it('resolve each case across its shards as one run resolves its calls', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-authority-stitch-'));
    temporary.push(root);
    const first = await shard(root, 'one', [
      owner('pays', [['network', 'live', `${file}:3`, 0]]),
      owner('retried', [['flag', 'ff-on', `${file}:12`, 1]]),
      owner('heard once', []),
      owner('unheard'),
    ]);
    const second = await shard(root, 'two', [
      owner('pays', [['network', 'mocked', `${file}:9`, preconditions.CASE_LEVEL]]),
      owner('retried', [['flag', 'ff-off', `${file}:12`, 1]]),
      owner('heard once'),
      owner('unheard'),
      // Work that outlived `pays` in this shard: a second frame, the same case.
      owner('pays', []),
    ]);
    const output = resolve(root, 'journeys.bin');

    await stitchJourneyArtifacts([first, second], output);

    const stitched = decodeExecutionIndex(await readFile(output));
    expect(stitched.tests.map((test) => test.id)).toEqual([
      'test/pay.test.ts > heard once', 'test/pay.test.ts > pays', 'test/pay.test.ts > retried', 'test/pay.test.ts > unheard',
    ]);
    expect(Object.fromEntries(stitched.tests.map((test) => [test.name, test.preconditions]))).toEqual({
      'heard once': [],
      pays: [{ name: 'network', value: 'mocked', site: 'test/pay.test.ts:9', level: preconditions.CASE_LEVEL }],
      retried: [
        { name: 'flag', value: 'ff-off', site: 'test/pay.test.ts:12', level: 1 },
        { name: 'flag', value: 'ff-on', site: 'test/pay.test.ts:12', level: 1 },
      ],
      unheard: undefined,
    });
  });
});
