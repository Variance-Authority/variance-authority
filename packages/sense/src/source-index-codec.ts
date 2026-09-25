import { codeUnitOrder as order } from '@variance-authority/core/segment';
import type { Parsed, ParseKey } from './cache.js';
import type { IndexedRecord, StoredSourceIndex } from './source-index-format.js';
import { addHarvestStrings } from './source-index-harvest.js';
import { addMemberStrings } from './source-index-members.js';
import { addMockStrings } from './source-index-mocks.js';

/** Split the cache key so its already-interned digest is not stored twice. */
export function partsOf(key: ParseKey): readonly [string, string] {
  const at = key.indexOf('\u0000');
  return at === -1 ? [key, ''] : [key.slice(0, at), key.slice(at + 1)];
}

export function joinedKey(digest: string, way: string): ParseKey {
  return way === '' ? digest : `${digest}\u0000${way}`;
}

/** Every string referenced by one source-index generation, in stable order. */
export function dictionary(
  stored: StoredSourceIndex,
  parses: readonly (readonly [ParseKey, Parsed])[],
  records: readonly (readonly [string, IndexedRecord])[],
): readonly string[] {
  const values = new Set<string>();
  if (stored.config !== undefined) values.add(stored.config);
  for (const key of stored.deletedParses ?? []) for (const part of partsOf(key)) values.add(part);
  for (const file of stored.deletedRecords ?? []) values.add(file);
  for (const path of stored.deletedDirectories ?? []) values.add(path);
  for (const [path, digest] of stored.directories) { values.add(path); values.add(digest); }
  for (const [key, parsed] of parses) {
    for (const part of partsOf(key)) values.add(part);
    for (const request of parsed.requests) {
      values.add(request.value); values.add(request.kind);
      for (const binding of request.bindings) { values.add(binding.imported); values.add(binding.local); }
    }
    for (const item of parsed.exports ?? []) {
      for (const value of [item.exported, item.local, item.from, item.imported]) {
        if (value !== undefined) values.add(value);
      }
    }
    addHarvestStrings(parsed, values);
    addMockStrings(parsed, values);
    addMemberStrings(parsed, values);
    for (const value of parsed.declares ?? []) values.add(value);
    if (parsed.unknown !== undefined) values.add(parsed.unknown);
  }
  for (const [file, held] of records) {
    const record = held.record;
    values.add(file);
    for (const value of [record.digest, record.unknown]) if (value !== undefined) values.add(value);
    for (const edge of record.edges ?? []) { values.add(edge.to); values.add(edge.kind); }
    for (const edge of record.packages ?? []) { values.add(edge.to); values.add(edge.kind); }
    for (const value of record.declares ?? []) values.add(value);
    for (const value of record.unresolved ?? []) values.add(value);
    for (const value of held.witnesses) values.add(value);
    for (const value of held.targets ?? []) if (value !== undefined) values.add(value);
  }
  return [...values].sort(order);
}
