import type { BlockKind } from '../instrument/index.js';
import { packBlob, packBytes, packWords } from './columns.js';

/**
 * How a snapshot is laid out: what it versions, which sections it holds, and
 * when a column is worth storing as runs.
 *
 * A section is a column and nothing else — no lengths interleaved with values,
 * no record boundaries — so the index at the head of the file is the whole of
 * what a reader has to parse before it can address any of them.
 */

/**
 * The snapshot's own version: what `TestCoverage` means, which a producer
 * states and a merge carries.
 */
export const MODEL = 3;

/**
 * The byte layout's version, which moves when the model does not. A reader
 * refuses a file it cannot decode, and a file whose columns are stored as runs
 * is not one a reader of the previous layout can map. It moved again when those
 * runs became zstd rather than brotli: the run tag would have said so, but a
 * header that answers first turns an unreadable byte into a stated version.
 *
 * And again for the two sections that hold what loaded a region before its
 * test began. A reader that finds them missing fails where it addresses them,
 * with the sentence it keeps for bytes that are not ours — so a snapshot one
 * release older reads as corrupt rather than as old. Adding a section is
 * therefore a move of this number, even though every section that was there
 * still means what it did.
 *
 * And again when the block-to-test relation stopped being stored as the pairs
 * themselves. A region names one interned set out of a pool the whole file
 * shares, so `blocks.tests` and `crossings.test` are gone rather than changed,
 * and the sections that replace them hold a different thing entirely.
 *
 * And once more for what loaded a region, which was the last relation still
 * stored as its pairs. It is a set of the same tests the crossings are, so it
 * names one out of the same pool: `blocks.loaded` and `loaded.test` are gone
 * and `blocks.loadedSet` holds one id a region in their place.
 *
 * And again for `tests.duration`, what the runner said each test file cost.
 * Unlike the moves before it, the previous layout stays readable: every section
 * it has still means what it did, and the one it lacks is a fact nobody
 * reported, which a reader answers with absence rather than a refusal. The JVM
 * agent still writes that layout.
 *
 * And again when the record took in its cases (spec 0094): `cases`,
 * `cases.before` and `cases.last` sit beside the coverage sections, each
 * holding bytes of its own. The layout before it stays readable as a record
 * that kept no cases, which is what it is to every reader: the case index it
 * may have had beside it is not read.
 */
export const FORMAT = 10;

/** The layout before the case sections, read as a record that kept no cases. */
export const UNCASED_FORMAT = 9;

/** The layout before `tests.duration`, read as one whose runner reported no durations. */
export const UNTIMED_FORMAT = 8;

/** The layouts a reader opens. */
export function readableFormat(
  version: unknown,
): version is typeof FORMAT | typeof UNCASED_FORMAT | typeof UNTIMED_FORMAT {
  return version === FORMAT || version === UNCASED_FORMAT || version === UNTIMED_FORMAT;
}

const ALIGNMENT = 8;
export const NO_OWNER = 0xffff_ffff;

/**
 * A test file whose runner reported no duration. Not zero: zero milliseconds is
 * a duration a runner can report, and a file nobody timed did not cost nothing.
 */
export const NO_DURATION = 0xffff_ffff;

/**
 * The word `tests.duration` holds for a duration: whole milliseconds, as the
 * runner reported them to the nearest one. A value no runner could have meant —
 * negative, not finite, or too large for the column — is stored as absent.
 */
export function durationWord(duration: number | undefined): number {
  if (duration === undefined || !Number.isFinite(duration) || duration < 0) return NO_DURATION;
  const whole = Math.round(duration);
  return whole >= NO_DURATION ? NO_DURATION : whole;
}

/**
 * Stored as runs above this, and as it is below it.
 *
 * Run coding is worth its decompression on the columns that dominate a
 * repository-sized snapshot and worth nothing on the ones that hold a handful
 * of rows, where the run index alone would be most of the section.
 */
const PACK_ABOVE = 1 << 16;

/** Every section the file holds, in the order it holds them. */
export const NAMES = [
  'strings.blob',
  'strings.off',
  'snapshot.instrumentation',
  'snapshot.commit',
  'tests.path',
  'tests.complete',
  'tests.preconditions',
  'preconditions.name',
  'preconditions.digest',
  'modules.path',
  'modules.source',
  'modules.instrumented',
  'modules.blocks',
  'blocks.ordinal',
  'blocks.kind',
  'blocks.owner',
  'blocks.digest',
  'blocks.name',
  'blocks.path',
  'blocks.start',
  'blocks.end',
  'blocks.source',
  'blocks.set',
  'blocks.loadedSet',
  'sets.blob',
  'sets.off',
] as const;

/** The section the layouts after `UNTIMED_FORMAT` added: one word a test, see {@link NO_DURATION}. */
export const DURATION = 'tests.duration';

export interface Section {
  readonly name: string;
  readonly offset: number;
  readonly length: number;
  readonly width: 1 | 4;
  /** Rows the section decodes to; present only when it is stored as runs. */
  readonly rows?: number;
}

export interface Header {
  readonly version: number;
  readonly sections: readonly Section[];
}

/** A column as it goes to the file: the bytes it would be, and the runs it becomes. */
export interface Stored {
  readonly plain: Buffer;
  readonly rows: number;
  readonly packed?: Buffer;
  /** Bytes one row occupies, which is the element width of the array it came from. */
  readonly width: 1 | 4;
}

/**
 * The wire encoding of a block kind: a kind's position in this list is the byte
 * `blocks.kind` holds for it. The order is append-only — move a member and every
 * artifact an older build wrote decodes into a different vocabulary.
 *
 * `BlockKind` owns the vocabulary and this list owns only its numbering, and
 * both halves of that correspondence are checked where they are written.
 * `satisfies` rejects a name here the union does not carry; `kindId` hands a
 * `BlockKind` to `indexOf`, whose parameter is this tuple's own element type, so
 * a member added to the union stops the build there until it is appended here.
 */
export const BLOCK_KINDS = [
  'module',
  'function',
  'branch',
  'continuation',
  'resume',
  'loop',
  'case',
  'handler',
] as const satisfies readonly BlockKind[];

export function kindId(kind: BlockKind): number {
  const id = BLOCK_KINDS.indexOf(kind);
  // Unreachable from a typed caller; a JavaScript one can still hand over anything.
  if (id < 0) throw new Error(`unknown coverage block kind: ${kind}`);
  return id;
}

/** A column, and the runs it becomes when there is enough of it for them to pay. */
export function column(values: Uint32Array | Uint8Array): Stored {
  const plain = bytes(values);
  const width = values instanceof Uint32Array ? 4 : 1;
  if (plain.length <= PACK_ABOVE) return { plain, rows: values.length, width };
  const packed = values instanceof Uint32Array ? packWords(values) : packBytes(values);
  return packed.length < plain.length
    ? { plain, rows: values.length, packed, width }
    : { plain, rows: values.length, width };
}

/** The blob, cut into runs on the string boundaries its offset column already holds. */
export function blob(values: Uint8Array, offsets: Uint32Array): Stored {
  const plain = bytes(values);
  if (plain.length <= PACK_ABOVE) return { plain, rows: values.length, width: 1 };
  const packed = packBlob(values, offsets);
  return packed.length < plain.length
    ? { plain, rows: values.length, packed, width: 1 }
    : { plain, rows: values.length, width: 1 };
}

export function sections(input: Readonly<Record<string, Stored>>, version = FORMAT): Buffer {
  const chunks: Buffer[] = [];
  const index: Section[] = [];
  let offset = 0;
  for (const [name, held] of Object.entries(input)) {
    const value = held.packed ?? held.plain;
    index.push({
      name,
      offset,
      length: value.length,
      width: held.width,
      ...(held.packed === undefined ? {} : { rows: held.rows }),
    });
    chunks.push(value);
    offset += value.length;
    const padding = aligned(offset) - offset;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
    offset += padding;
  }
  const encoded = Buffer.from(JSON.stringify({ version, sections: index }), 'utf8');
  const headerLength = aligned(4 + encoded.length) - 4;
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(headerLength);
  return Buffer.concat([prefix, encoded, Buffer.alloc(headerLength - encoded.length), ...chunks]);
}

/**
 * The header {@link sections} framed `bytes` with, or `undefined` when they are
 * not framed that way: a length that fits, then a JSON header naming a version
 * and its sections. Decided on the frame rather than on the first byte, which
 * is the low byte of that length and can be any value at all — `{` included.
 */
export function framedHeader(bytes: Uint8Array): Header | undefined {
  if (bytes.length < 4) return undefined;
  const length = Buffer.from(bytes.buffer, bytes.byteOffset, 4).readUInt32LE(0);
  if (length === 0 || length > bytes.length - 4) return undefined;
  try {
    const text = Buffer.from(bytes.buffer, bytes.byteOffset + 4, length).toString('utf8').replace(/\0+$/u, '');
    const header = JSON.parse(text) as { version?: unknown; sections?: unknown } | null;
    return typeof header?.version === 'number' && Array.isArray(header.sections) ? (header as Header) : undefined;
  } catch {
    return undefined;
  }
}

function bytes(array: Uint8Array | Uint32Array): Buffer {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function aligned(value: number): number {
  return Math.ceil(value / ALIGNMENT) * ALIGNMENT;
}

export function validSections(sections: readonly Section[], available: number): boolean {
  if (!Array.isArray(sections) || sections.length === 0) return false;
  if (new Set(sections.map((section) => section.name)).size !== sections.length) return false;
  const ordered = [...sections].sort((left, right) => left.offset - right.offset);
  let end = 0;
  for (const section of ordered) {
    if (
      typeof section.name !== 'string' ||
      !Number.isSafeInteger(section.offset) ||
      !Number.isSafeInteger(section.length) ||
      section.offset < end ||
      section.offset % ALIGNMENT !== 0 ||
      section.length < 0 ||
      section.length > available - section.offset ||
      (section.width !== 1 && section.width !== 4) ||
      (section.rows !== undefined && (!Number.isSafeInteger(section.rows) || section.rows < 0))
    ) return false;
    end = section.offset + section.length;
  }
  return ordered[0]?.offset === 0;
}
