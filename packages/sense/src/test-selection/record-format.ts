/**
 * One module's record, as bytes.
 *
 * A segment is an append-only file of self-delimiting frames, one frame per
 * module the transform saw. That shape is forced by who writes it: a Jest worker
 * rewriting one file inside a synchronous transform hook, a dev server that
 * keeps transforming for the whole life of a Playwright run, ten processes
 * transpiling ten changed files while a hundred and ninety-nine thousand stay
 * cached. None of them can hold the set, none of them can wait for the others,
 * and a process appending to a file it alone opened contends with nobody.
 *
 * A frame is self-contained: its own string dictionary, its own columns, its own
 * checksum. That costs about fifteen percent against interning across the whole
 * segment, and buys the property every other part of this depends on — a frame
 * can be read without reading what came before it, and a torn tail loses the
 * modules in the tail rather than the segment.
 *
 * Columns rather than rows because the reader that matters next is not this one.
 * Every field is a run of fixed-width little-endian values at a computable
 * offset, so a reader in another language takes a slice where this one takes a
 * loop.
 */

import type { BlockKind } from '../instrument/index.js';
import { KINDS } from './format-layout.js';
import type { CoverageBlock } from './index.js';
import type { CapturedModule } from './instrumented-modules.js';

/** `VAREC` and a format version. A segment that does not open with it is not one. */
const MAGIC = Buffer.from([0x56, 0x41, 0x52, 0x45, 0x43, 0x00, 0x00, 0x01]);

const DIGEST_BYTES = 16;
const FRAME_HEADER = 8;
/** `id` 4, `flags` 4, `blocks` 4, `dictionary` 4, `sourceDigest` 16. */
const RECORD_HEADER = 32;
const NO_OWNER = 0xffffffff;
const INSTRUMENTED = 1;

/**
 * The id of a module the table had not numbered when it was transformed.
 *
 * A record under it answers for the path instead, which the frame already
 * carries as the first string of its dictionary. One run per new file pays a
 * path where it would have paid four bytes; the fold numbers it, and the next
 * transform of that file emits a number.
 */
export const UNNUMBERED = 0xffffffff;

const align = (bytes: number, to: number): number => (bytes + to - 1) & ~(to - 1);

/** Identity as sixteen bytes. The `v1:` rendering is for people and for JSON. */
function digestBytes(digest: string): Buffer {
  const hex = digest.slice(digest.indexOf(':') + 1);
  if (hex.length !== DIGEST_BYTES * 2) throw new Error(`not a digest: ${digest}`);
  return Buffer.from(hex, 'hex');
}

const digestText = (raw: Buffer, at: number): string =>
  `v1:${raw.toString('hex', at, at + DIGEST_BYTES)}`;

/**
 * FNV-1a over the payload, verified where a record is decoded rather than where
 * it is passed over. A torn tail is already caught by the frame length running
 * past the end of the file; this catches the byte a filesystem lost silently.
 */
function checksum(payload: Buffer): number {
  let hash = 2166136261;
  for (let at = 0; at < payload.length; at += 1) {
    hash = Math.imul(hash ^ payload[at]!, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** The bytes a segment opens with: the magic, and the probe recipe it was cut by. */
export function segmentHeader(instrumentation: string): Buffer {
  const recipe = Buffer.from(instrumentation, 'utf8');
  const out = Buffer.alloc(align(MAGIC.length + 4 + recipe.length, 8));
  MAGIC.copy(out, 0);
  out.writeUInt32LE(recipe.length, MAGIC.length);
  recipe.copy(out, MAGIC.length + 4);
  return out;
}

/** What a segment says it is, or `undefined` when it is not a segment at all. */
export function readSegmentHeader(
  raw: Buffer,
): { readonly instrumentation: string; readonly frames: number } | undefined {
  if (raw.length < MAGIC.length + 4 || !raw.subarray(0, MAGIC.length).equals(MAGIC)) return undefined;
  const length = raw.readUInt32LE(MAGIC.length);
  const end = MAGIC.length + 4 + length;
  if (end > raw.length) return undefined;
  return {
    instrumentation: raw.toString('utf8', MAGIC.length + 4, end),
    frames: align(end, 8),
  };
}

/** One module as a framed record, ready to append. */
export function frameRecord(module: CapturedModule): Buffer {
  const payload = encodeRecord(module);
  const out = Buffer.alloc(FRAME_HEADER + align(payload.length, 8));
  out.writeUInt32LE(payload.length, 0);
  out.writeUInt32LE(checksum(payload), 4);
  payload.copy(out, FRAME_HEADER);
  return out;
}

function encodeRecord(module: CapturedModule): Buffer {
  const ids = new Map<string, number>();
  const id = (value: string): number => {
    const existing = ids.get(value);
    if (existing !== undefined) return existing;
    ids.set(value, ids.size);
    return ids.size - 1;
  };

  // First, so the module's own path is always string zero: that is how a reader
  // finds the path of a record it has no number for, without decoding the rest.
  id(module.file);
  const names = module.blocks.map((block) => id(block.name));
  const paths = module.blocks.map((block) => id(block.path));
  const strings = [...ids.keys()].map((value) => Buffer.from(value, 'utf8'));
  const dictionary = strings.reduce((bytes, value) => bytes + align(4 + value.length, 4), 4);

  const count = module.blocks.length;
  const bits = (count + 7) >> 3;
  const columns = align(count, 4) + count * 4 * 5 + align(bits, 4) + count * DIGEST_BYTES;
  const out = Buffer.alloc(RECORD_HEADER + dictionary + columns);

  out.writeUInt32LE(typeof module.id === 'number' ? module.id : UNNUMBERED, 0);
  out.writeUInt32LE(module.instrumented ? INSTRUMENTED : 0, 4);
  out.writeUInt32LE(count, 8);
  out.writeUInt32LE(dictionary, 12);
  digestBytes(module.sourceDigest).copy(out, 16);

  let at = RECORD_HEADER;
  out.writeUInt32LE(strings.length, at);
  at += 4;
  for (const value of strings) {
    out.writeUInt32LE(value.length, at);
    value.copy(out, at + 4);
    at += align(4 + value.length, 4);
  }

  const column = (width: number): number => {
    const start = at;
    at += width;
    return start;
  };
  const kind = column(align(count, 4));
  const owner = column(count * 4);
  const name = column(count * 4);
  const path = column(count * 4);
  const startLine = column(count * 4);
  const endLine = column(count * 4);
  const source = column(align(bits, 4));
  const digest = column(count * DIGEST_BYTES);

  for (let index = 0; index < count; index += 1) {
    const block = module.blocks[index]!;
    out.writeUInt8(kindId(block.kind), kind + index);
    out.writeUInt32LE(block.owner ?? NO_OWNER, owner + index * 4);
    out.writeUInt32LE(names[index]!, name + index * 4);
    out.writeUInt32LE(paths[index]!, path + index * 4);
    out.writeUInt32LE(block.startLine, startLine + index * 4);
    out.writeUInt32LE(block.endLine, endLine + index * 4);
    if (block.source) out[source + (index >> 3)]! |= 1 << (index & 7);
    digestBytes(block.digest).copy(out, digest + index * DIGEST_BYTES);
  }
  return out;
}

const kindId = (kind: BlockKind): number => KINDS.indexOf(kind);

/** Where one frame sits, and the identity it answers for. */
export interface Frame {
  /** The module's number, or {@link UNNUMBERED} when {@link framePath} answers instead. */
  readonly id: number;
  readonly at: number;
  readonly length: number;
}

/**
 * The path a frame was cut from, read without decoding it.
 *
 * String zero of the dictionary, by construction. A reader scanning a segment
 * for the modules a run reported needs this only for the records it has no
 * number for, and pays one length and one decode for each of them.
 */
export function framePath(raw: Buffer, frame: Frame): string | undefined {
  const at = frame.at + RECORD_HEADER;
  if (at + 8 > raw.length || raw.readUInt32LE(at) === 0) return undefined;
  const length = raw.readUInt32LE(at + 4);
  if (at + 8 + length > raw.length) return undefined;
  return raw.toString('utf8', at + 8, at + 8 + length);
}

/**
 * Every frame in a segment, in the order it was appended.
 *
 * Stops at the first frame that runs past the end of the file, which is what a
 * write interrupted mid-append looks like from here. The modules before it are
 * unaffected: that is the property a frame's self-containment buys.
 */
export function* frames(raw: Buffer, from: number): Generator<Frame> {
  let at = from;
  while (at + FRAME_HEADER + RECORD_HEADER <= raw.length) {
    const length = raw.readUInt32LE(at);
    const payload = at + FRAME_HEADER;
    if (length < RECORD_HEADER || payload + length > raw.length) return;
    yield { id: raw.readUInt32LE(payload), at: payload, length };
    at = payload + align(length, 8);
  }
}

/** One frame's module, or `undefined` when its bytes do not check out. */
export function decodeRecord(raw: Buffer, frame: Frame): CapturedModule | undefined {
  const payload = raw.subarray(frame.at, frame.at + frame.length);
  if (raw.readUInt32LE(frame.at - 4) !== checksum(payload)) return undefined;

  const count = payload.readUInt32LE(8);
  const dictionary = payload.readUInt32LE(12);
  const strings: string[] = [];
  let at = RECORD_HEADER;
  const entries = payload.readUInt32LE(at);
  at += 4;
  for (let index = 0; index < entries; index += 1) {
    if (at + 4 > payload.length) return undefined;
    const length = payload.readUInt32LE(at);
    if (at + 4 + length > payload.length) return undefined;
    strings.push(payload.toString('utf8', at + 4, at + 4 + length));
    at += align(4 + length, 4);
  }

  at = RECORD_HEADER + dictionary;
  const bits = (count + 7) >> 3;
  const column = (width: number): number => {
    const start = at;
    at += width;
    return start;
  };
  const kind = column(align(count, 4));
  const owner = column(count * 4);
  const name = column(count * 4);
  const path = column(count * 4);
  const startLine = column(count * 4);
  const endLine = column(count * 4);
  const source = column(align(bits, 4));
  const digest = column(count * DIGEST_BYTES);
  if (at > payload.length) return undefined;

  const blocks: CoverageBlock[] = [];
  for (let index = 0; index < count; index += 1) {
    const owns = payload.readUInt32LE(owner + index * 4);
    blocks.push({
      ordinal: index,
      kind: KINDS[payload.readUInt8(kind + index)] ?? 'continuation',
      ...(owns === NO_OWNER ? {} : { owner: owns }),
      digest: digestText(payload, digest + index * DIGEST_BYTES),
      name: strings[payload.readUInt32LE(name + index * 4)] ?? '',
      path: strings[payload.readUInt32LE(path + index * 4)] ?? '',
      startLine: payload.readUInt32LE(startLine + index * 4),
      endLine: payload.readUInt32LE(endLine + index * 4),
      source: (payload.readUInt8(source + (index >> 3)) & (1 << (index & 7))) !== 0,
      testFiles: [],
    });
  }

  const file = strings[0];
  if (file === undefined) return undefined;
  const numbered = payload.readUInt32LE(0);
  return {
    file,
    id: numbered === UNNUMBERED ? file : numbered,
    sourceDigest: digestText(payload, 16),
    instrumented: (payload.readUInt32LE(4) & INSTRUMENTED) !== 0,
    blocks,
  };
}
