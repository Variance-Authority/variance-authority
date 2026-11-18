/** Test-only binary inspection and fixture publication; never part of the package. */
import type { Digest } from '@variance-authority/core/format';
import { native } from '../addon.js';
import { entry } from '../help-reading.js';
import { openImmutableLog } from '../immutable-log.js';
import type { SourceIndexState } from '../source-index-file.js';
import { decodeSourceIndex, encodeSourceIndex, type StoredSourceIndex } from './source-index-format.js';

export async function openSourceIndexFile(path: string) {
  const opened = entry('openIndex')(path);
  let state: { readonly state: SourceIndexState; readonly written?: number };
  try { state = opened.status(); } finally { opened.close(); }
  const log = await openImmutableLog(path).catch(() => undefined);
  const parses = new Map(); const records = new Map(); const directories = new Map();
  let config: Digest | undefined;
  const generation: Digest[] = [];
  for (const [at, bytes] of (log?.segments ?? []).entries()) {
    let row: StoredSourceIndex;
    try { row = decodeSourceIndex(bytes); } catch { break; }
    for (const key of row.deletedParses ?? []) parses.delete(key);
    for (const key of row.deletedRecords ?? []) records.delete(key);
    for (const key of row.deletedDirectories ?? []) directories.delete(key);
    for (const [key, value] of row.parses) parses.set(key, value);
    for (const [key, value] of row.records) records.set(key, value);
    for (const [key, value] of row.directories) directories.set(key, value);
    config = row.config ?? config;
    if (log?.digests[at] !== undefined) generation.push(log.digests[at]!);
  }
  const stored: StoredSourceIndex = { parses, records, directories, ...(config === undefined ? {} : { config }) };
  return {
    ...state, stored, generation,
    async save(next: StoredSourceIndex): Promise<string | undefined> {
      const bytes = encodeSourceIndex({ ...next,
        deletedParses: new Set([...parses.keys()].filter((key) => !next.parses.has(key))),
        deletedRecords: new Set([...records.keys()].filter((key) => !next.records.has(key))),
        deletedDirectories: new Set([...directories.keys()].filter((key) => !next.directories.has(key))),
      });
      return native()!.appendSourceIndex(path, generation, log?.legacy ?? false, [bytes]) ?? undefined;
    },
  };
}
export async function readSourceIndex(path: string): Promise<StoredSourceIndex> { return (await openSourceIndexFile(path)).stored; }
