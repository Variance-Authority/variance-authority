import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import { encodeAsSetExecutionIndex, readTestCoverage, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { main, parseArgs } from '../bin.js';
import { distillRows } from './distill.js';
import { readExecutionIndex } from './execution-input.js';
import { recordedJourneys } from './resources.js';

vi.mock('./resources.js', async (original) => ({
  ...await original<typeof import('./resources.js')>(),
  recordedJourneys: vi.fn(() => { throw new Error('merge must not compute a journey comparison'); }),
}));

const temporary: string[] = [];
afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'va-merge-command-')));
  temporary.push(root);
  await mkdir(join(root, 'src'));
  const source = 'export function greet() { return "hello"; }\n';
  await writeFile(join(root, 'src/greet.ts'), source);
  const shards: string[] = [];
  for (const name of ['a', 'b']) {
    const file = `${name}.test.ts`;
    await writeFile(join(root, file), 'it("greets", () => {});\n');
    const path = join(root, `${name}.bin`);
    const test = { id: `${file} > greets`, file, name: 'greets', stopped: false };
    const blocks = [
      { ordinal: 0, kind: 'module' as const, digest: 'module', name: '', path: '', startLine: 1, endLine: 1, source: true, testFiles: [], loadedBy: [file] },
      { ordinal: 1, owner: 0, kind: 'function' as const, digest: 'function', name: 'greet', path: 'greet', startLine: 1, endLine: 1, source: true, testFiles: [file] },
    ];
    await writeTestCoverage(path, {
      version: 3, instrumentation: 'fixture',
      tests: [{ file, complete: true, preconditions: [] }],
      modules: [{ file: 'src/greet.ts', sourceDigest: digestString(source), instrumented: true, blocks }],
    }, { index: encodeAsSetExecutionIndex({ tests: [test], modules: [{ file: 'src/greet.ts', blocks: blocks.map((block) => ({
      ...block, crossings: block.kind === 'function' ? [{ test: 0, distance: 0 }] : [],
    })) }] }) });
    shards.push(path);
  }
  return { root, shards, into: join(root, 'combined.bin') };
}

describe('`journeys merge`', () => {
  it('combines coverage and cases without project configuration, a checkout or a comparison', async () => {
    const { root, shards, into } = await fixture();
    const before = (await Promise.all(shards.map((execution) => distillRows({ root, execution })))).flatMap((read) => read.rows);
    let out = '';
    let err = '';
    const code = await main(['journeys', 'merge', ...shards, '--into', into], {
      out: (text) => { out += text; }, err: (text) => { err += text; },
    });

    expect({ code, err }).toEqual({ code: 0, err: '' });
    expect(out).toBe(`journeys: combined 2 records into ${into} (2 tests, 1 modules, 2 crossings, 2 cases)\n`);
    expect(out).not.toContain('pool:');
    expect(recordedJourneys).not.toHaveBeenCalled();
    expect((await readTestCoverage(into)).modules[0]!.blocks[0]!.loadedBy).toEqual(['a.test.ts', 'b.test.ts']);
    expect((await readExecutionIndex(into)).tests.map((test) => test.id)).toEqual(['a.test.ts > greets', 'b.test.ts > greets']);
    expect((await distillRows({ root, execution: into })).rows).toEqual(before);
  });

  it('writes the same bytes whatever order the shards are named in', async () => {
    const { shards, into } = await fixture();
    const quiet = { out: () => {}, err: () => {} };
    expect(await main(['journeys', 'merge', ...shards, '--into', into], quiet)).toBe(0);
    const swapped = `${into}.swapped`;
    expect(await main(['journeys', 'merge', ...[...shards].reverse(), '--into', swapped], quiet)).toBe(0);
    expect(Buffer.compare(await readFile(into), await readFile(swapped))).toBe(0);
  });

  it('refuses shards of two runs by name, and writes nothing', async () => {
    const { root, shards, into } = await fixture();
    const other = join(root, 'other.bin');
    await writeTestCoverage(other, { version: 3, instrumentation: 'fixture', commit: 'elsewhere', tests: [{ file: 'c.test.ts', complete: true, preconditions: [] }], modules: [] });
    let err = '';
    const code = await main(['journeys', 'merge', shards[0]!, other, '--into', into], { out: () => {}, err: (text) => { err += text; } });
    expect(code).not.toBe(0);
    expect(err).toContain('disagree about the commit');
    await expect(readFile(into)).rejects.toThrow();
  });

  it('reads no checkout, so it takes no `--root`', () => {
    expect(() => parseArgs(['journeys', 'merge', 'one.bin', '--into', 'all.bin', '--root', 'checkout'])).toThrow('`--root` is not');
  });

  it('resolves shard and output paths at the working directory', () => {
    expect(parseArgs(['journeys', 'merge', 'one.bin', '--into', 'all.bin'])).toEqual({
      command: 'journeys', operation: 'merge', config: expect.any(String), shards: [resolve('one.bin')], into: resolve('all.bin'),
    });
  });

  it.each([
    ['merge'], ['merge', 'one.bin'], ['merge', '--into', 'all.bin'],
    ['merge', 'one.bin', '--into', 'all.bin', '--suite', 'unit'],
    ['merge', 'one.bin', '--into', 'all.bin', '--all'],
    ['merge', 'one.bin', '--into', 'all.bin', '--config', 'web.json'],
  ])('refuses incomplete or reading-specific arguments: %j', (...args) => {
    expect(() => parseArgs(['journeys', ...args])).toThrow('`variance journeys merge`');
  });
});
