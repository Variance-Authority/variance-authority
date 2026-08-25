import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { decodeSourceIndex, encodeSourceIndex, type StoredSourceIndex } from './source-index-format.js';

const EMPTY: StoredSourceIndex = { parses: new Map(), records: new Map() };
let temporary = 0;

/** A missing, foreign, incomplete, or corrupt generation is an empty cache. */
export async function readSourceIndex(path: string): Promise<StoredSourceIndex> {
  try {
    return decodeSourceIndex(await readFile(path));
  } catch {
    return EMPTY;
  }
}

/** Publish a complete generation atomically; cache I/O never fails a scan. */
export async function writeSourceIndex(path: string, stored: StoredSourceIndex): Promise<void> {
  const scratch = `${path}.${process.pid}.${temporary++}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(scratch, encodeSourceIndex(stored));
    await rename(scratch, path);
  } catch {
    try { await unlink(scratch); } catch { /* Nothing was published. */ }
  }
}
