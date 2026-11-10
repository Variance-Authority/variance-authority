import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { Parsed } from './cache.js';
import { keyFor, parseWay } from './files.js';
import { native, nativeAvailable, nativeGraph, type NativeGitTree } from './native.js';
import { graphRecords, nativeIndexGraph } from './native-index-graph.js';
import { MODULE_EXTENSIONS } from './read.js';
import { shapeOf } from './reuse.js';
import { memoryParseCache } from './cache.js';
import { LARGEST_FILE, scanCount } from './scan.js';
import { openSourceIndexFile, type IndexedRecord, type StoredSourceIndex } from './source-index-file.js';
import { decodeSourceIndex } from './source-index-format.js';
import { gitTreeOf } from './tree.js';

/**
 * The closure the addon holds, against the one it hands over.
 *
 * The oracle is the path a caller that wants every record takes: `nativeGraph`
 * hands each one to JavaScript as an object, and a save writes them. Both are
 * run over this repository's own sources, with what JavaScript reads beside a
 * closure — a stylesheet's record, a parse — added to each, and the index each
 * one publishes is compared file for file, byte for byte: onto an empty chain,
 * which the addon publishes itself, and onto a committed one, where the save
 * writes a delta and the addon encodes the closure into it.
 */

const run = promisify(execFile);
const available = nativeAvailable();
const root = resolve(import.meta.dirname, '../../..');

describe('a cold closure held by the addon', () => {
  it.runIf(available)('publishes the index a save of the handed-over records publishes, byte for byte', async () => {
    const seeds = await modules('packages/sense/src/');
    const tree = (await gitTreeOf(root, ['packages/sense/src']))!;
    const { shape, aliases } = await shapeOf({ root, tree });
    const request = {
      root,
      seeds,
      largestFile: LARGEST_FILE,
      remembering: true,
      aliases,
      directories: shape.directories,
    };
    const held = nativeIndexGraph(tree.native!, request)!;
    const oracle = nativeGraph({
      addon: native()!,
      tree: tree.native!,
      ...request,
      files: seeds,
      digests: seeds.map(() => undefined),
    });

    const oracleRecords = new Map<string, IndexedRecord>(oracle.built.map((built) => [built.record.file, {
      record: built.record,
      witnesses: built.witnesses,
      ...(built.targets === undefined ? {} : { targets: built.targets }),
    }]));
    expect(graphRecords(held)).toEqual([...oracleRecords.values()].map((indexed) => indexed.record)
      .sort((left, right) => left.file < right.file ? -1 : left.file > right.file ? 1 : 0));

    // What JavaScript adds beside a closure: a record the walk never reads, and
    // the parse behind it.
    const sheet: IndexedRecord = {
      record: { file: 'packages/sense/theme.css', digest: 'sha1:0000000000000000000000000000000000000000' },
      witnesses: ['packages/sense'],
      targets: [undefined, 'packages/sense/tokens.css'],
    };
    const parse: Parsed = { requests: [{ value: './tokens.css', kind: 'import', bindings: [], line: 1 }] } as Parsed;
    const parseKey = keyFor(sheet.record.digest!, parseWay(sheet.record.file));

    // A committed chain the closure lands on: one of its files read before it
    // changed, which the closure replaces, and one that is gone since.
    const [stale] = oracleRecords.values();
    const committed: StoredSourceIndex = {
      parses: new Map([[parseKey, parse]]),
      config: shape.config,
      directories: shape.directories,
      records: new Map([
        [sheet.record.file, sheet],
        [stale!.record.file, { ...stale!, record: { ...stale!.record, digest: sheet.record.digest! } }],
        ['packages/sense/gone.ts', { record: { file: 'packages/sense/gone.ts', edges: [] }, witnesses: [] }],
      ]),
    };

    const directory = await mkdtemp(join(tmpdir(), 'sense-index-graph-'));
    try {
      for (const [name, baseline, count] of [['empty', undefined, 2], ['committed', committed, 2]] as const) {
        const expected = join(directory, `${name}-expected.bin`);
        const actual = join(directory, `${name}-actual.bin`);
        if (baseline !== undefined) {
          for (const path of [expected, actual]) await (await openSourceIndexFile(path)).save(baseline);
        }
        await (await openSourceIndexFile(expected)).save({
          parses: new Map([[parseKey, parse]]),
          config: shape.config,
          directories: shape.directories,
          records: new Map([...oracleRecords, [sheet.record.file, sheet]]),
        }, oracle.parseLayer);
        await (await openSourceIndexFile(actual)).save({
          parses: new Map([[parseKey, parse]]),
          config: shape.config,
          directories: shape.directories,
          records: new Map([[sheet.record.file, sheet]]),
        }, { get bytes() { return held.parseSegment(); }, keys: { has: (key) => held.hasParse(key) } }, held);

        expect(await readFile(actual), name).toEqual(await readFile(expected));
        const segments = (await readdir(`${expected}.segments`)).sort();
        expect(segments, name).toHaveLength(count);
        expect((await readdir(`${actual}.segments`)).sort(), name).toEqual(segments);
        for (const segment of segments) {
          expect(await readFile(join(`${actual}.segments`, segment)), `${name} ${segment}`)
            .toEqual(await readFile(join(`${expected}.segments`, segment)));
        }
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  // A scan of ten thousand modules or more takes this path, and `ask symbol`
  // reads its declarations from the parses it publishes: a closure that left
  // them out answered a large checkout as if it declared nothing.
  it.runIf(available)('publishes the declarations of every module it parses', async () => {
    const seeds = ['packages/sense/src/source-index.ts'];
    const tree = (await gitTreeOf(root, ['packages/sense/src']))!;
    const { shape, aliases } = await shapeOf({ root, tree });
    const held = nativeIndexGraph(tree.native!, {
      root,
      seeds,
      largestFile: LARGEST_FILE,
      remembering: true,
      aliases,
      directories: shape.directories,
    })!;
    const read = graphRecords(held).find((record) => record.file === seeds[0])!;
    const { parses } = decodeSourceIndex(held.parseSegment());
    const parsed = parses.get(keyFor(read.digest!, parseWay(read.file)));
    expect(parsed?.harvested).toBe(true);
    expect(parsed?.symbols?.map((symbol) => symbol.name)).toContain('nativeParses');
    // Every wave, not only the seeds': the closure reaches past the first file.
    expect(parses.size).toBeGreaterThan(seeds.length);
    expect([...parses.values()].filter((each) => each.harvested !== true)).toEqual([]);
  });

  // `scanCount` reports what the closure parsed: a module it declined for its
  // size holds a record but was never parsed.
  it.runIf(available)('counts the modules it parsed, not the ones it declined', async () => {
    const seeds = ['packages/sense/src/source-index.ts'];
    const tree = (await gitTreeOf(root, ['packages/sense/src']))!;
    const { shape, aliases } = await shapeOf({ root, tree });
    const closure = (largestFile: number) => nativeIndexGraph(tree.native!, {
      root, seeds, largestFile, remembering: true, aliases, directories: shape.directories,
    })!;
    const declined = closure(1);
    expect(declined.size).toBe(1);
    expect(declined.parsed).toBe(0);
    const read = closure(LARGEST_FILE);
    expect(read.parsed).toBe(decodeSourceIndex(read.parseSegment()).parses.size);
  });

  // Ten thousand modules is where a scan hands its closure to the addon to hold.
  it.runIf(available)('counts, through a scan, every module the closure holds and only the ones it parsed', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-scan-count-'));
    await mkdir(join(directory, 'src'));
    const modules = 10_000;
    for (let at = 0; at < modules; at += 500) {
      await Promise.all(Array.from({ length: 500 }, (_, each) =>
        writeFile(join(directory, 'src', `m${String(at + each)}.ts`), `export const m = ${String(at + each)};\n`)));
    }
    await writeFile(join(directory, 'src', 'wide.ts'), `export const wide = '${'x'.repeat(LARGEST_FILE)}';\n`);
    await run('git', ['init', '--quiet'], { cwd: directory });
    await run('git', ['add', '.'], { cwd: directory });
    await run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'many'], { cwd: directory });

    const counted = await scanCount({ root: directory, dirs: ['src'], cache: memoryParseCache() });
    expect(counted).toMatchObject({ files: modules + 1, parsed: modules });
  }, 120_000);

  it('throws a closure the addon failed to build to the scan that asked for it', () => {
    const tree = {
      indexGraph: () => {
        throw new Error('source index: "x" was never collected into the dictionary');
      },
    } as unknown as NativeGitTree;
    expect(() => nativeIndexGraph(tree, {
      root,
      seeds: ['a.ts'],
      largestFile: LARGEST_FILE,
      remembering: false,
      aliases: undefined,
      directories: new Map(),
    })).toThrow('source index: "x" was never collected into the dictionary');
  });
});

/** Every tracked module under `prefix` that is on the disk. */
async function modules(prefix: string): Promise<string[]> {
  const { stdout } = await run('git', ['ls-files', '-z', '--', prefix], { cwd: root, maxBuffer: 1 << 28 });
  return stdout
    .split('\0')
    .filter((path) => path !== '' && MODULE_EXTENSIONS.some((end) => path.endsWith(end)))
    .filter((path) => existsSync(join(root, path)));
}
