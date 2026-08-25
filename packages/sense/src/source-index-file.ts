import { isDeepStrictEqual } from 'node:util';
import type { Digest, FileRecord } from '@variance-authority/core';
import type { Parsed } from './cache.js';
import { emptyImmutableLog, openImmutableLog, type ImmutableLog } from './immutable-log.js';
import { differenceLayer, orderedMap, type MapLayer } from './ordered-map.js';
import { decodeSourceIndex, encodeSourceIndex, type StoredSourceIndex } from './source-index-format.js';

const EMPTY: StoredSourceIndex = { parses: new Map(), records: new Map() };

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
    if (log.committed && current.layout === stored.layout && empty(parses) && empty(records)) return;

    await log.publish(
      encodeSourceIndex(segment(stored.layout, parses, records)),
      encodeSourceIndex(stored),
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
  const recordLayers: MapLayer<string, FileRecord>[] = decoded.map((part) => ({
    puts: part.records,
    deletes: part.deletedRecords ?? new Set(),
  }));
  const layout = decoded.at(-1)?.layout;
  return {
    log,
    stored: {
      parses: orderedMap(parseLayers),
      ...(layout === undefined ? {} : { layout }),
      records: orderedMap(recordLayers),
    },
  };
}

function segment(
  layout: Digest | undefined,
  parses: MapLayer<Digest, Parsed>,
  records: MapLayer<string, FileRecord>,
): StoredSourceIndex {
  return {
    parses: parses.puts,
    ...(parses.deletes.size === 0 ? {} : { deletedParses: parses.deletes }),
    ...(layout === undefined ? {} : { layout }),
    records: records.puts,
    ...(records.deletes.size === 0 ? {} : { deletedRecords: records.deletes }),
  };
}

function empty<K, V>(layer: MapLayer<K, V>): boolean {
  return layer.puts.size === 0 && layer.deletes.size === 0;
}
