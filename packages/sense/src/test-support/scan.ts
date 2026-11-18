/** Test-only projection of native source facts for language and resolver assertions. */
import { resolve } from 'node:path';
import type { Digest } from '@variance-authority/core/format';
import type { FileRecord } from '@variance-authority/core/relate';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { native } from '../addon.js';
import type { ParseCache, Parsed } from '../cache.js';
import { keyFor, parseWay, seedPaths } from '../files.js';
import { nativeIndexGraph } from '../native-index-graph.js';
import type { ResolveOptions } from '../resolve.js';
import { realPath } from '../resolve.js';
import { gitTreeOf, treeOf, type Tree } from '../tree.js';
import { shapeOf } from '../reuse.js';
import { withDeclaredTsconfig } from '../typescript.js';
import { decodeSourceIndex } from './source-index-format.js';

export const LARGEST_FILE = 1024 * 1024;
export interface ScanOptions extends ResolveOptions {
  readonly root: string;
  readonly dirs: readonly string[];
  readonly before?: readonly string[];
  readonly digests?: ReadonlyMap<string, Digest> | Tree | false;
  readonly packs?: boolean;
  readonly changed?: readonly string[];
  readonly cache?: ParseCache;
  readonly stores?: readonly string[];
  readonly largestFile?: number;
  readonly parsed?: (file: string, parsed: Parsed) => void;
  readonly indexed?: (file: string, parsed: Parsed, targets: readonly (string | undefined)[]) => void;
}

export async function scanFixtureGraph(asked: ScanOptions) {
  const root = realPath(resolve(asked.root));
  const options = withDeclaredTsconfig(root, asked);
  const addon = native();
  if (addon === undefined) throw new Error('native source scanner did not load');
  const tree = options.digests === false ? undefined : options.digests === undefined ? await gitTreeOf(root, options.dirs, options.changed) : treeOf(options.digests);
  const shape = tree === undefined ? undefined : await shapeOf({ root, tree, options });
  const holder = tree?.native ?? (tree === undefined ? addon.filesystemTree(root, [...options.dirs]) : addon.sourceTree(root, [...tree.paths()], seedPaths(root, options.dirs, tree.paths())));
  const paths = tree !== undefined && tree.native === undefined ? tree.paths() : undefined;
  const identities = paths === undefined ? undefined : Object.fromEntries(paths.flatMap((file) => {
    const digest = tree!.get(file); return digest === undefined ? [] : [[file, digest]];
  }));
  const graph = nativeIndexGraph(holder, {
    root, seeds: [...holder.seeds(), ...(options.before ?? [])], largestFile: options.largestFile ?? LARGEST_FILE,
    remembering: false, aliases: shape?.aliases, directories: shape?.shape.directories ?? new Map(), follow: true,
    ...(options.packs === undefined ? {} : { packs: options.packs }),
    ...(options.stores === undefined ? {} : { stores: options.stores }),
    ...(options.tsconfig === undefined ? {} : { tsconfig: options.tsconfig }),
    ...(options.conditionNames === undefined ? {} : { conditionNames: options.conditionNames }),
    ...(identities === undefined ? {} : { identities }),
  });
  return { graph, listing: holder };
}

export async function scanRelations(options: ScanOptions): Promise<readonly FileRecord[]> {
  const { graph } = await scanFixtureGraph(options);
  const rows = decodeSourceIndex(graph.encode([]));
  const parsed = options.parsed === undefined && options.indexed === undefined && options.cache === undefined ? undefined : decodeSourceIndex(graph.parseSegment()).parses;
  const records = [...rows.records.values()].sort((a, b) => codeUnitOrder(a.record.file, b.record.file));
  for (const { record, targets } of records) {
    const read = record.digest === undefined ? undefined : parsed?.get(keyFor(record.digest, parseWay(record.file)));
    if (read !== undefined) {
      options.cache?.set(keyFor(record.digest!, parseWay(record.file)), read);
      options.parsed?.(record.file, read);
      options.indexed?.(record.file, read, targets ?? []);
    }
  }
  return records.map((held) => held.record);
}

export async function scanCount(options: ScanOptions) {
  const { graph, listing } = await scanFixtureGraph(options);
  return { files: graph.size, parsed: graph.parsed, listing };
}
