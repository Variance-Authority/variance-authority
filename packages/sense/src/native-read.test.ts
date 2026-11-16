import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import type { FileRecord } from '@variance-authority/core/relate';
import { nativeIndexGraph } from './native-index-graph.js';
import { native, nativeAvailable } from './addon.js';
import { MODULE_EXTENSIONS } from './read.js';
import { resolveTo, resolversFor } from './resolve.js';
import { LARGEST_FILE } from './scan.js';
import { openSourceIndexFile, readSourceIndex } from './source-index-file.js';
import { requestOf } from './specifier.js';
import { decodeSourceIndex } from './source-index-format.js';

/**
 * Native resolution against the module resolver, and binary records against
 * the requests and declarations the native reader returned.
 *
 * The corpus is this repository, which is the only corpus worth arguing with: a
 * fixture is a guess about what TypeScript looks like, and a few thousand real
 * files are not. A disagreement is an edge the two paths do not share: a file
 * reported that should not have been, or a file missed that should have been.
 */

const run = promisify(execFile);
const available = nativeAvailable();
const root = resolve(import.meta.dirname, '../../..');

describe('the native scanner over this repository', () => {
  it.runIf(available)('resolves every repository request the way the oracle does', async () => {
    const files = await modules();
    const batch = native()!.scanBatch(root, files);
    const resolvers = resolversFor({});
    const disagreed: unknown[] = [];
    let at = 0;

    for (const [index, file] of files.entries()) {
      for (let step = 0; step < batch.counts[index]!; step += 1) {
        const value = batch.values[at] ?? '';
        const request = requestOf(value);
        const oracle = request === undefined
          ? ''
          : resolveTo({ resolvers, root, from: join(root, file), request, style: false, language: 'module' }) ?? '';
        const answered = batch.targets[at] ?? '';
        if (answered !== oracle) disagreed.push({ file, value, oracle, answered });
        at += 1;
      }
    }

    expect(disagreed).toEqual([]);
  }, 120_000);

  it.runIf(available)('publishes every repository record with its resolved requests and declarations', async () => {
    const files = await modules();
    const tree = native()!.gitTree(root)!;
    const batch = tree.scanBatch(root, files, LARGEST_FILE);
    const graph = nativeIndexGraph(tree, {
      root, seeds: files, largestFile: LARGEST_FILE, aliases: undefined,
      directories: new Map(), remembering: false, follow: false,
    });
    const records = decodeSourceIndex(graph.encode([])).records;
    expect(new Set(records.keys())).toEqual(new Set(files));
    let requestAt = 0;
    let declareAt = 0;
    for (const [index, file] of files.entries()) {
      const indexed = records.get(file)!;
      const count = batch.counts[index]!;
      const declares = batch.declares.slice(declareAt, declareAt + batch.declareCounts[index]!);
      expect(indexed.record.file).toBe(file);
      expect(indexed.witnesses).toEqual([]);
      if (batch.parsed[index] === 1) {
        expect(indexed.targets).toEqual(batch.targets.slice(requestAt, requestAt + count).map((target) => target || undefined));
        expect(indexed.record.declares ?? []).toEqual(declares);
      }
      requestAt += count;
      declareAt += batch.declareCounts[index]!;
    }
    expect([...records.values()].some(({ record }) => record.packages?.some(({ kind }) => kind === 'type'))).toBe(true);
  }, 120_000);

  it.runIf(available)('says why a file it declined is not an empty answer', () => {
    const batch = native()!.readBatch(root, ['packages/sense/package.json'], 8);

    expect(batch.counts[0]).toBe(0);
    expect(batch.unknown[0]).toContain('over the 8 this scan opens');
  });

  it.runIf(available)('reports an unreadable file rather than reporting no edges', () => {
    const batch = native()!.readBatch(root, ['packages/sense/does-not-exist.ts']);

    expect(batch.counts[0]).toBe(0);
    expect(batch.unknown[0]).toContain('could not be read');
  });

  it.runIf(available)('names its kinds the way the oracle names them', () => {
    expect(native()!.kinds()).toEqual(['imports', 'reexports', 'dynamic', 'type', 'depends', 'asset']);
  });

  /**
   * A cold graph publishes its parse layer as a segment of its own, beside the
   * generation the scan encodes. A segment the decoder refuses rejects the whole
   * chain it was committed with, so a column the native encoder stops writing
   * costs the run its records and not only its parses — and `save` absorbs I/O
   * failure, so nothing upstream says a word about it.
   */
  it.runIf(available)('publishes a parse layer the source index reads back beside its own', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-native-index-'));
    const file = join(directory, 'source-index.bin');
    const record: FileRecord = {
      file: 'packages/sense/src/scan.ts',
      digest: 'git:4444444444444444444444444444444444444444' as Digest,
      edges: [{ to: 'packages/sense/src/native.ts', kind: 'imports' }],
    };

    try {
      const graph = nativeIndexGraph(native()!.gitTree(root)!, {
        root, seeds: [record.file], largestFile: LARGEST_FILE,
        aliases: undefined, directories: new Map(), remembering: true,
      });
      const bytes = graph.parseSegment();
      const keys = new Set(decodeSourceIndex(bytes).parses.keys());
      expect(keys.size).toBeGreaterThan(0);

      const index = await openSourceIndexFile(file);
      await index.save({
        parses: new Map(),
        directories: new Map(),
        records: new Map([[record.file, { record, witnesses: ['packages/sense/src'] }]]),
      }, { bytes, keys });

      expect(await readdir(`${file}.segments`)).toHaveLength(2);
      const stored = await readSourceIndex(file);
      expect([...stored.records.keys()]).toEqual([record.file]);
      expect([...keys].filter((key) => !stored.parses.has(key))).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

/** Every tracked module in this checkout, as repository-relative paths. */
async function modules(): Promise<string[]> {
  const { stdout } = await run('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 28 });

  return stdout
    .split('\0')
    .filter((path) => path !== '' && MODULE_EXTENSIONS.some((end) => path.endsWith(end)))
    // Tracked but removed from the working tree: a deletion not yet committed.
    .filter((path) => existsSync(join(root, path)));
}
