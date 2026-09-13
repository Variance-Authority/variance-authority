/**
 * An atomic pointer to ordered immutable byte segments.
 *
 * The manifest is the commit: a segment written without it is unreachable, and
 * a manifest is published only after every segment it names exists. Callers own
 * the meaning of a segment and reject the complete chain when one is unusable.
 */

import { readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { digestBytes, type Digest } from './digest.js';

const MAGIC = Buffer.from('VAIDXLSM');
const VERSION = 1;
const HEADER_BYTES = MAGIC.length + 4;
const MAX_SEGMENTS = 8;
let temporary = 0;

interface SegmentReference {
  readonly digest: Digest;
  readonly length: number;
}

interface Manifest {
  readonly format: 'variance-authority-immutable-log';
  readonly version: 1;
  readonly segments: readonly SegmentReference[];
}

export interface ImmutableLog {
  readonly segments: readonly Buffer[];
  readonly legacy: boolean;
  readonly committed: boolean;
  /**
   * Append `delta`, or replace the chain with the whole of it when the chain has
   * grown past {@link MAX_SEGMENTS} or was written by the shape before this one.
   *
   * `compacted` is a thunk because the compaction is the expensive half and is
   * not wanted most of the time — for the source index it is a several-megabyte
   * encode beside a delta of a few kilobytes, and the chain asks for it on one
   * publish in eight. Only this function knows which publish that is.
   */
  publish(delta: Uint8Array, compacted: () => Uint8Array): Promise<void>;
}

/** Open the committed chain. Missing state is an empty chain; malformed state throws. */
export async function openImmutableLog(path: string): Promise<ImmutableLog> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (!missing(error)) throw error;
    return logAt(path, [], [], false, false);
  }

  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) {
    return logAt(path, [], [bytes], true, true);
  }

  const references = decodeManifest(bytes);
  const directory = segmentDirectory(path);
  const segments = await Promise.all(references.map(async (reference) => {
    const segment = await readFile(join(directory, fileName(reference.digest)));
    if (segment.length !== reference.length || digestBytes(segment) !== reference.digest) {
      throw new Error('invalid immutable log segment');
    }
    return segment;
  }));
  return logAt(path, references, segments, false, true);
}

/**
 * The committed segments, read where waiting is not available.
 *
 * A transform hook is the caller: it is handed a module, it must return the
 * transformed text, and there is no point in it at which anything may be
 * awaited. Reading is the half of the log that can answer under that
 * constraint — a chain of at most {@link MAX_SEGMENTS} immutable files, each
 * checked against the length and digest the manifest published for it, and none
 * of them held open by a writer.
 */
export function readImmutableLog(path: string): readonly Buffer[] {
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (error) {
    if (!missing(error)) throw error;
    return [];
  }
  if (!bytes.subarray(0, MAGIC.length).equals(MAGIC)) return [bytes];

  const directory = segmentDirectory(path);
  return decodeManifest(bytes).map((reference) => {
    const segment = readFileSync(join(directory, fileName(reference.digest)));
    if (segment.length !== reference.length || digestBytes(segment) !== reference.digest) {
      throw new Error('invalid immutable log segment');
    }
    return segment;
  });
}

/** A new writer used to replace state that could not be opened. */
export function emptyImmutableLog(path: string): ImmutableLog {
  return logAt(path, [], [], false, false);
}

function logAt(
  path: string,
  references: readonly SegmentReference[],
  segments: readonly Buffer[],
  legacy: boolean,
  committed: boolean,
): ImmutableLog {
  return {
    segments,
    legacy,
    committed,
    async publish(delta, compacted) {
      const compact = legacy || references.length + 1 > MAX_SEGMENTS;
      const content = Buffer.from(compact ? compacted() : delta);
      const reference = { digest: digestBytes(content), length: content.length };
      const next = compact ? [reference] : [...references, reference];
      const directory = segmentDirectory(path);
      const scratch = `${path}.${process.pid}.${temporary++}.tmp`;
      const segmentScratch = join(directory, `${fileName(reference.digest)}.${process.pid}.tmp`);
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(segmentScratch, content);
        await rename(segmentScratch, join(directory, fileName(reference.digest)));
        await writeFile(scratch, encodeManifest(next));
        await rename(scratch, path);
        if (compact) await discard(references, next, directory);
      } catch (error) {
        await Promise.all([unlink(scratch).catch(() => {}), unlink(segmentScratch).catch(() => {})]);
        throw error;
      }
    },
  };
}

function encodeManifest(segments: readonly SegmentReference[]): Buffer {
  const manifest: Manifest = {
    format: 'variance-authority-immutable-log',
    version: VERSION,
    segments,
  };
  const json = Buffer.from(JSON.stringify(manifest), 'utf8');
  const header = Buffer.alloc(HEADER_BYTES);
  MAGIC.copy(header);
  header.writeUInt32LE(json.length, MAGIC.length);
  return Buffer.concat([header, json]);
}

function decodeManifest(bytes: Buffer): readonly SegmentReference[] {
  if (bytes.length < HEADER_BYTES) throw new Error('invalid immutable log manifest');
  const length = bytes.readUInt32LE(MAGIC.length);
  if (length !== bytes.length - HEADER_BYTES) throw new Error('invalid immutable log manifest');
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString('utf8', HEADER_BYTES));
  } catch { throw new Error('invalid immutable log manifest'); }
  if (!manifestIsValid(parsed)) throw new Error('invalid immutable log manifest');
  return parsed.segments;
}

function manifestIsValid(value: unknown): value is Manifest {
  if (typeof value !== 'object' || value === null) return false;
  const manifest = value as Partial<Manifest>;
  if (manifest.format !== 'variance-authority-immutable-log' ||
      manifest.version !== VERSION || !Array.isArray(manifest.segments)) return false;
  return manifest.segments.every((segment) =>
    typeof segment === 'object' && segment !== null &&
    typeof segment.digest === 'string' && /^v1:[0-9a-f]{32}$/.test(segment.digest) &&
    Number.isSafeInteger(segment.length) && segment.length >= 0);
}

async function discard(
  previous: readonly SegmentReference[],
  next: readonly SegmentReference[],
  directory: string,
): Promise<void> {
  const retained = new Set(next.map((segment) => fileName(segment.digest)));
  const obsolete = new Set(previous.map((segment) => fileName(segment.digest)));
  let present: readonly string[];
  try { present = await readdir(directory); } catch { return; }
  await Promise.all(present
    .filter((file) => obsolete.has(file) && !retained.has(file))
    .map((file) => unlink(join(directory, file)).catch(() => {})));
}

function segmentDirectory(path: string): string { return `${path}.segments`; }
function fileName(digest: Digest): string { return `${digest.replace(':', '-')}.bin`; }
function missing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error &&
    (error as { readonly code?: unknown }).code === 'ENOENT';
}
