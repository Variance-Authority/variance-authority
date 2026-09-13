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
 */
export const FORMAT = 6;

const ALIGNMENT = 8;
export const NO_OWNER = 0xffff_ffff;

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
  'blocks.tests',
  'crossings.test',
  'blocks.loaded',
  'loaded.test',
] as const;

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
export const KINDS = [
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
  const id = KINDS.indexOf(kind);
  // Unreachable from a typed caller; a JavaScript one can still hand over anything.
  if (id < 0) throw new Error(`unknown coverage block kind: ${kind}`);
  return id;
}

/** A column, and the runs it becomes when there is enough of it for them to pay. */
export function column(values: Uint32Array | Uint8Array): Stored {
  const plain = bytes(values);
  if (plain.length <= PACK_ABOVE) return { plain, rows: values.length };
  const packed = values instanceof Uint32Array ? packWords(values) : packBytes(values);
  return packed.length < plain.length
    ? { plain, rows: values.length, packed }
    : { plain, rows: values.length };
}

/** The blob, cut into runs on the string boundaries its offset column already holds. */
export function blob(values: Uint8Array, offsets: Uint32Array): Stored {
  const plain = bytes(values);
  if (plain.length <= PACK_ABOVE) return { plain, rows: values.length };
  const packed = packBlob(values, offsets);
  return packed.length < plain.length
    ? { plain, rows: values.length, packed }
    : { plain, rows: values.length };
}

export function sections(input: Readonly<Record<string, Stored>>): Buffer {
  const chunks: Buffer[] = [];
  const index: Section[] = [];
  let offset = 0;
  for (const [name, held] of Object.entries(input)) {
    const value = held.packed ?? held.plain;
    index.push({
      name,
      offset,
      length: value.length,
      width: name.endsWith('.kind') ||
          name.endsWith('.complete') ||
          name.endsWith('.instrumented') ||
          name === 'blocks.source' ||
          name.endsWith('.blob')
        ? 1
        : 4,
      ...(held.packed === undefined ? {} : { rows: held.rows }),
    });
    chunks.push(value);
    offset += value.length;
    const padding = aligned(offset) - offset;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
    offset += padding;
  }
  const encoded = Buffer.from(JSON.stringify({ version: FORMAT, sections: index }), 'utf8');
  const headerLength = aligned(4 + encoded.length) - 4;
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(headerLength);
  return Buffer.concat([prefix, encoded, Buffer.alloc(headerLength - encoded.length), ...chunks]);
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
