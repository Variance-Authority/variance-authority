/** Test-only decoded observations of native source publication. */
import type { FileRecord } from '@variance-authority/core/relate';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { resolve } from 'node:path';
import { seedPaths } from '../files.js';
import { publishedThrough, type PublishedSourcesOptions } from '../published.js';
import { usesOf } from '../uses.js';
import { openSourceIndexFile } from './source-index-file.js';
export async function readPublishedSources(path: string) {
  const file = await openSourceIndexFile(path);
  const cache = { get: (key: string) => file.stored.parses.get(key), set() {} };
  return { ...file, path, records: [...file.stored.records.values()].map((row) => row.record).sort((a, b) => codeUnitOrder(a.file, b.file)), cache,
    uses: usesOf(file.stored.records, cache) };
}
export async function publishedSources(root: string, options: PublishedSourcesOptions) { return publishedThrough(root, options, readPublishedSources); }
export function sourcesWithin(records: readonly FileRecord[], root: string, dirs: readonly string[], before: readonly string[] = []) {
  const byFile = new Map(records.map((record) => [record.file, record]));
  const queue = [...seedPaths(resolve(root), dirs, [...byFile.keys()]), ...before]; const reached = new Set<string>();
  for (const file of queue) { const record = byFile.get(file); if (record === undefined || reached.has(file)) continue; reached.add(file); for (const edge of record.edges ?? []) queue.push(edge.to); }
  return records.filter((record) => reached.has(record.file));
}
