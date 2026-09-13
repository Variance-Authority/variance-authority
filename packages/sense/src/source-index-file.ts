import { isDeepStrictEqual } from 'node:util';
import type { Digest } from '@variance-authority/core/format';
import type { Parsed } from './cache.js';
import { emptyImmutableLog, openImmutableLog, type ImmutableLog } from './immutable-log.js';
import { differenceLayer, orderedMap, type MapLayer } from './ordered-map.js';
import {
  decodeSourceIndex,
  encodeSourceIndex,
  type IndexedRecord,
  type StoredSourceIndex,
} from './source-index-format.js';

export type { IndexedRecord, StoredSourceIndex } from './source-index-format.js';

const EMPTY: StoredSourceIndex = { parses: new Map(), records: new Map(), directories: new Map() };

/** A missing, foreign, incomplete, or corrupt chain is an empty cache. */
export async function readSourceIndex(path: string): Promise<StoredSourceIndex> {
  try {
    return (await load(path)).stored;
  } catch {
    return EMPTY;
  }
}

/** Append one immutable change; cache I/O never fails a scan. */
export async function writeSourceIndex(path: string, stored: StoredSourceIndex): Promise<void> {
  let current: StoredSourceIndex;
  let log: ImmutableLog;
  try {
    ({ stored: current, log } = await load(path));
  } catch {
    current = EMPTY;
    log = emptyImmutableLog(path);
  }

  try {
    const parses = differenceLayer(current.parses, stored.parses, isDeepStrictEqual);
    const records = differenceLayer(current.records, stored.records, isDeepStrictEqual);
    const directories = differenceLayer(current.directories, stored.directories);
    if (
      log.committed &&
      current.config === stored.config &&
      empty(parses) && empty(records) && empty(directories)
    ) return;

    await log.publish(
      encodeSourceIndex(segment(stored.config, parses, records, directories)),
      () => encodeSourceIndex(stored),
    );
  } catch {
    // Persistence is a saving, never a new failure mode for the scan.
  }
}

async function load(path: string): Promise<{
  readonly stored: StoredSourceIndex;
  readonly log: ImmutableLog;
}> {
  const log = await openImmutableLog(path);
  const decoded = log.segments.map((bytes) => decodeSourceIndex(bytes));
  const parseLayers: MapLayer<Digest, Parsed>[] = decoded.map((part) => ({
    puts: part.parses,
    deletes: part.deletedParses ?? new Set(),
  }));
  const recordLayers: MapLayer<string, IndexedRecord>[] = decoded.map((part) => ({
    puts: part.records,
    deletes: part.deletedRecords ?? new Set(),
  }));
  const directoryLayers: MapLayer<string, Digest>[] = decoded.map((part) => ({
    puts: part.directories,
    deletes: part.deletedDirectories ?? new Set(),
  }));
  const config = decoded.at(-1)?.config;
  return {
    log,
    stored: {
      parses: orderedMap(parseLayers),
      ...(config === undefined ? {} : { config }),
      directories: orderedMap(directoryLayers),
      records: orderedMap(recordLayers),
    },
  };
}

function segment(
  config: Digest | undefined,
  parses: MapLayer<Digest, Parsed>,
  records: MapLayer<string, IndexedRecord>,
  directories: MapLayer<string, Digest>,
): StoredSourceIndex {
  return {
    parses: parses.puts,
    ...(parses.deletes.size === 0 ? {} : { deletedParses: parses.deletes }),
    ...(config === undefined ? {} : { config }),
    directories: directories.puts,
    ...(directories.deletes.size === 0 ? {} : { deletedDirectories: directories.deletes }),
    records: records.puts,
    ...(records.deletes.size === 0 ? {} : { deletedRecords: records.deletes }),
  };
}

function empty<K, V>(layer: MapLayer<K, V>): boolean {
  return layer.puts.size === 0 && layer.deletes.size === 0;
}
