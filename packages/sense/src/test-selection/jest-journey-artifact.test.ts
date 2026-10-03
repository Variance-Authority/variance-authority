import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digestString } from '../digest.js';
import type { ModuleId } from '../instrument/index.js';
import { native, nativeAvailable } from '../native.js';
import preconditions from './case-preconditions.cjs';
import { packCase, packFrames } from './cases.js';
import { decodeExecutionIndex } from './execution-format.js';
import { stitchJourneyArtifacts } from './jest-journey-artifact.js';
import type { CapturedModule } from './instrumented-modules.js';
import journalFormat from './journal-format.cjs';
import { frameRecord, segmentHeader } from './record-format.js';

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
async function shard(
  root: string,
  name: string,
  owners: readonly (string | readonly [string, ReadonlyMap<ModuleId, Uint32Array>])[],
  stores: readonly string[] = [],
): Promise<string> {
  const cases = resolve(root, name);
  await mkdir(cases);
  await writeFile(resolve(cases, 'worker.vac'), packFrames(owners.map((owned) =>
    typeof owned === 'string' ? journalFormat.encodeJournal(owned, new Map()) : journalFormat.encodeJournal(...owned))));
  const output = resolve(root, `${name}.bin`);
  native()!.foldJourneyTo!(cases, '/repo', stores, 'sense:instrument/presence-v5', output);
  return output;
}

/** A record store holding one three-region module, `src/pay.ts`. */
async function store(root: string): Promise<string> {
  const held = resolve(root, 'store');
  await mkdir(held);
  const module: CapturedModule = {
    file: 'src/pay.ts',
    id: 'src/pay.ts',
    sourceDigest: digestString('source'),
    instrumented: true,
    blocks: [0, 1, 2].map((ordinal) => ({
      ordinal,
      kind: ordinal === 0 ? 'module' : 'branch',
      digest: digestString(`block-${ordinal}`),
      name: ordinal === 0 ? '' : `branch-${ordinal}`,
      path: ordinal === 0 ? '' : `branch-${ordinal}`,
      startLine: ordinal + 1,
      endLine: ordinal + 1,
      source: true,
      testFiles: [],
    })),
  };
  await writeFile(resolve(held, 'one.rec'), Buffer.concat([segmentHeader('sense:instrument/presence-v5'), frameRecord(module)]));
  return held;
}

/** `src/pay.ts` with the case calling into the region at `ordinal`. */
function entering(ordinal: number): ReadonlyMap<ModuleId, Uint32Array> {
  const counters = new Uint32Array(3);
  counters[ordinal] = 1;
  return new Map([['src/pay.ts', counters]]);
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

  it('keep two cases that share a name apart when a shard ran only the second', async () => {
    const root = await mkdtemp(resolve(tmpdir(), 'variance-authority-stitch-'));
    temporary.push(root);
    const stores = [await store(root)];
    const first = (said: Said) => preconditions.packSaid(packCase(file, 'pays', '0'), said);
    const second = (said: Said) => preconditions.packSaid(packCase(file, 'pays', '1'), said);
    const live: Said = [['network', 'live', `${file}:3`, preconditions.CASE_LEVEL]];
    const mocked: Said = [['network', 'mocked', `${file}:9`, preconditions.CASE_LEVEL]];
    const both = await shard(root, 'both', [[first(live), entering(1)], [second(mocked), entering(2)]], stores);
    const only = await shard(root, 'only', [[second(mocked), entering(2)]], stores);
    const output = resolve(root, 'journeys.bin');

    await stitchJourneyArtifacts([both, only], output);

    const stitched = decodeExecutionIndex(await readFile(output));
    const entered = (test: number) => stitched.modules.flatMap((module) =>
      module.blocks.filter((block) => block.crossings.some((crossing) => crossing.test === test)).map((block) => block.name));
    expect(stitched.tests.map((test, at) => ({ id: test.id, preconditions: test.preconditions, entered: entered(at) }))).toEqual([
      {
        id: 'test/pay.test.ts > pays',
        preconditions: [{ name: 'network', value: 'live', site: 'test/pay.test.ts:3', level: preconditions.CASE_LEVEL }],
        entered: ['branch-1'],
      },
      {
        id: 'test/pay.test.ts > pays#1',
        preconditions: [{ name: 'network', value: 'mocked', site: 'test/pay.test.ts:9', level: preconditions.CASE_LEVEL }],
        entered: ['branch-2'],
      },
    ]);
  });
});
