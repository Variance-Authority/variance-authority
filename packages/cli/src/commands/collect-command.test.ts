import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeSuiteIndex } from '@variance-authority/report/suite-index';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { runCollect, runCollectMerge } from './collect-command.js';
import type { Collected } from './collector.js';
import { collecting, rendered } from './evidence-fixture.js';
import { configOf } from './run-fixture.js';

let root: string;
let out: string[];
let err: string[];
const streams = { out: (text: string) => out.push(text), err: (text: string) => err.push(text) };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'collect-command-'));
  out = [];
  err = [];
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const IDS = ['button--primary', 'button--quiet', 'card--default', 'menu--open'];

const ok = (id: string): Collected => rendered(id, [{ owner: 'Button', text: `Read ${id}` }]);
const answer = (id: string): Collected => (id === 'card--default' ? { ok: false, because: 'no theme' } : ok(id));

async function collect(total: number, options: { ids?: readonly string[]; answer?: (id: string) => Collected } = {}): Promise<string[]> {
  const config: Config = configOf({ subjects: { kind: 'list', ids: [...(options.ids ?? IDS)], collector: join(root, 'collector.mjs') } });
  const paths: string[] = [];
  for (let index = 1; index <= total; index += 1) {
    const path = join(root, `evidence-${String(index)}.json`);
    await runCollect({ command: 'collect', config: join(root, 'variance.config.json'), shard: { index, total }, out: path }, config, streams, {
      cwd: root,
      load: async (_path, context) => collecting(context.plan!, options.answer ?? ok).collector,
    });
    paths.push(path);
  }
  return paths;
}

describe('variance collect: one job, one part', () => {
  it('writes the part of its own shard, and says what it collected', async () => {
    const [first] = await collect(2);
    const part = JSON.parse(await readFile(first!, 'utf8')) as { shard: unknown; outcomes: unknown[] };

    expect(part.shard).toEqual({ index: 1, total: 2 });
    expect(out.join('')).toMatch(/evidence-1\.json: shard 1\/2 owns \d+ of 4 subjects/);
  });
});

describe('variance collect merge: every part, one index', () => {
  it('publishes the suite index and keeps the parts', async () => {
    const parts = await collect(2);
    const index = join(root, 'suite.index');

    expect(await runCollectMerge({ command: 'collect', operation: 'merge', parts, out: index }, streams)).toBe(0);
    const read = decodeSuiteIndex(await readFile(index));
    expect(read.coverage?.map((entry) => entry.subject)).toEqual(IDS);
    expect(await readFile(parts[0]!, 'utf8')).toMatch(/"outcomes"/);
    expect(out.join('')).toMatch(/4 subjects/);
  });

  it('leaves the index as it was when a shard is missing, and names the one to collect', async () => {
    const [first] = await collect(2);
    const index = join(root, 'suite.index');
    await writeFile(index, 'previous');

    await expect(runCollectMerge({ command: 'collect', operation: 'merge', parts: [first!], out: index }, streams)).rejects.toThrow(
      /shard 2\/2 is missing; collect each shard with `variance collect --shard k\/n` and merge again/,
    );
    expect(await readFile(index, 'utf8')).toBe('previous');
  });

  it('refuses a part it cannot read, by its path', async () => {
    const bogus = join(root, 'bogus.json');
    await writeFile(bogus, '{"format":"other"}');
    await expect(runCollectMerge({ command: 'collect', operation: 'merge', parts: [bogus], out: join(root, 'i') }, streams)).rejects.toThrow(
      /bogus\.json is not a collection part this version reads/,
    );
  });

  it('publishes nothing while a subject failed, and says which shard to collect again', async () => {
    const parts = await collect(2, { answer });
    const index = join(root, 'suite.index');
    await writeFile(index, 'previous');

    expect(await runCollectMerge({ command: 'collect', operation: 'merge', parts, out: index }, streams)).toBe(2);
    expect(await readFile(index, 'utf8')).toBe('previous');
    expect(decodeSuiteIndex(await readFile(`${index}.incomplete`)).coverage).toContainEqual({
      subject: 'card--default',
      outcome: 'failed',
      because: 'no theme',
    });
    expect(err.join('')).toMatch(/card--default failed: no theme; collect it again with `variance collect --shard \d\/2`/);
  });

  it('says so when the plan holds no subjects, and publishes the empty index', async () => {
    const parts = await collect(2, { ids: [] });
    const index = join(root, 'suite.index');

    expect(await runCollectMerge({ command: 'collect', operation: 'merge', parts, out: index }, streams)).toBe(0);
    expect(decodeSuiteIndex(await readFile(index)).coverage).toEqual([]);
    expect(out.join('')).toMatch(/the plan holds no subjects/);
  });
});
