/**
 * The number a repository knows each of its modules by, for as long as the file
 * exists.
 *
 * An id is written into the emitted code of every instrumented module, and then
 * repeated once for every crossing — every time a test file, a story, or a
 * request is recorded as having entered that module. Crossings are where the
 * cost lives: this repository's own suite records two hundred and eighty
 * thousand of them against eight hundred modules, and a monorepo scaled to two
 * hundred thousand modules records millions. An id derived from the path — a
 * digest, however narrowly rendered — spends sixty-four bits at every one of
 * them and cannot spend fewer, because a digest is uniformly distributed and a
 * sorted run of them has gaps as wide as the space. A repository with two
 * hundred thousand modules has 17.6 bits of module in it. Numbering them
 * exactly spends eighteen, and a sorted run of exact numbers is a run of small
 * gaps, which is a run that compresses.
 *
 * So the numbers are assigned, not derived, and that needs a table. The table is
 * the same structure `core/relate` already builds in memory for the same files
 * and for the same reason — a node is an integer — held on disk instead, and
 * never renumbered: a file added today does not move a file numbered last year,
 * because its number is appended rather than computed from where it sorts.
 *
 * ## The shape
 *
 * Paths are stored sorted and front-coded — each entry keeps only the bytes it
 * does not share with the entry before it — with a whole path every sixteenth
 * entry so a lookup can binary-search the block heads and then read forward at
 * most fifteen entries. On two hundred thousand monorepo paths that is 22 bytes
 * a path against 50 stored plainly. Storage order is the sorted order and the id
 * is a column beside it, so sorting is free to be optimal: nothing about where a
 * path sits decides what it is called.
 *
 * Growth rides {@link ImmutableLog}, which is already how this package keeps the
 * source index: the committed table is a chain of immutable segments under one
 * atomic manifest, an append is a new segment holding only the paths that are
 * new, and a compaction merges the chain into one sorted run without disturbing
 * a single id. Every segment is sorted within itself, so a lookup binary-searches
 * each of the eight a chain may hold.
 *
 * ## Who assigns
 *
 * The fold assigns, and {@link nameModules} asks for the lock as an argument
 * rather than asking callers to remember it. Three folds grow this table today
 * and a fourth will be written one day; an exclusion each of them decides for
 * itself is an exclusion one of them will decide differently, so the decision is
 * spent here, once, where it cannot be read past. Transforms only read, which is
 * what makes the table safe under a build that transpiles ten changed files in
 * parallel: a lookup is a read of an immutable file, and parallel readers of an
 * immutable file need nothing from each other.
 *
 * A transform that meets a path the table has never seen — a file created since
 * the last run — has nothing to look up, and waiting for an authority is not
 * available to it: the id goes into the emitted code now. It emits the path
 * instead, which is the one other thing that is exactly as unique as the module
 * and needs no table at all. The journal reports it, the fold recognises it as a
 * path rather than a number, numbers it for next time, and the run is correct
 * with one module costing path-length bytes at its crossings. Nothing is
 * reserved, nothing is claimed, and two processes that meet two new files at the
 * same moment cannot collide, because neither of them invented anything.
 */

import { emptyImmutableLog, openImmutableLog, readImmutableLog } from './immutable-log.js';
import type { IndexLock } from './test-selection/index-lock.js';

/** "VANAMES" and the format version. */
const MAGIC = Buffer.from([0x56, 0x41, 0x4e, 0x41, 0x4d, 0x45, 0x53, 0x01]);

/** Entries between whole paths: the walk a lookup does after the binary search. */
const BLOCK = 16;

/** `magic` 8, `count` 4, `blocks` 4, `next` 4. */
const HEADER = 20;

/** `shared` 1, `length` 2. */
const ENTRY_HEADER = 3;

const MAX_SHARED = 0xff;

interface Segment {
  readonly raw: Buffer;
  readonly count: number;
  /** Offset of the restart column, whose members are offsets into `entries`. */
  readonly restarts: number;
  readonly blocks: number;
  /** Offset of the id column. */
  readonly ids: number;
  readonly entries: number;
  /** One past the highest id this segment assigns. */
  readonly next: number;
}

/** A repository's modules, numbered. */
export interface ModuleNames {
  /** How many modules have ever been numbered, and so the next number to assign. */
  readonly count: number;
  /** What this repository calls `path`, or `undefined` if it has never seen it. */
  idOf(path: string): number | undefined;
  /** The path numbered `id`, or `undefined`. */
  pathOf(id: number): string | undefined;
}

/**
 * The committed table. A missing, foreign, or corrupt chain is an empty table.
 *
 * Synchronous because its caller is: a transform is handed a module and must
 * return the transformed text, and the id goes into that text. One read of at
 * most eight immutable files, once per worker, against a table that no reader
 * can be made to wait for.
 */
export function readModuleNames(path: string): ModuleNames {
  try {
    return tableOf(readImmutableLog(path));
  } catch {
    return tableOf([]);
  }
}

/**
 * Number every path the table does not hold yet, and return the table that
 * results.
 *
 * New paths are numbered in sorted order rather than in the order they were
 * met, so two machines that meet the same set of new files agree on what to call
 * them and the emitted code they cache is the same emitted code.
 *
 * `lock` is the exclusion, and it is a parameter because this is
 * read-modify-write: the table is read here and the segment is published a few
 * lines later, and two folds running that gap at once each read the same `count`
 * and hand one number to two paths. That is the failure this package can least
 * afford — nothing detects it, and afterwards a run attributes one module's
 * crossings to another. Holding the index is therefore a precondition of
 * calling, so it is written where a precondition belongs.
 */
export async function nameModules(
  path: string,
  paths: Iterable<string>,
  lock: IndexLock,
): Promise<ModuleNames> {
  // Asking for one is not the same as still having one: a token can be stored
  // and used after the merge it was taken for has released it, which is the one
  // way past the signature that is left.
  if (!lock.held) {
    throw new Error(`the lock over ${lock.file} was released before ${path} was numbered`);
  }

  const current = readModuleNames(path);
  const fresh = [...new Set(paths)].filter((name) => current.idOf(name) === undefined).sort(order);
  if (fresh.length === 0) return current;

  const added: (readonly [string, number])[] = fresh.map((name, index) => [
    name,
    current.count + index,
  ]);
  const all = [...numbered(current), ...added].sort(([left], [right]) => order(left, right));

  const compacted = encodeSegment(all);
  try {
    const log = await openImmutableLog(path).catch(() => emptyImmutableLog(path));
    await log.publish(encodeSegment(added), () => compacted);
  } catch {
    // A table that could not be written numbers the same modules the same way
    // next time. Persistence is a saving, never a new way for a run to fail.
  }
  return tableOf([compacted]);
}

function numbered(names: ModuleNames): readonly (readonly [string, number])[] {
  const held: (readonly [string, number])[] = [];
  for (let id = 0; id < names.count; id += 1) {
    const name = names.pathOf(id);
    if (name !== undefined) held.push([name, id]);
  }
  return held;
}

/** Sorted paths and their numbers: front-coded entries beside an id column. */
function encodeSegment(sorted: readonly (readonly [string, number])[]): Buffer {
  const blocks = Math.max(1, Math.ceil(sorted.length / BLOCK));
  const restarts = Buffer.alloc(blocks * 4);
  const ids = Buffer.alloc(sorted.length * 4);
  const parts: Buffer[] = [];
  let at = 0;
  let previous: Buffer = Buffer.alloc(0);

  for (const [index, [name, id]] of sorted.entries()) {
    const bytes = Buffer.from(name, 'utf8');
    const head = index % BLOCK === 0;
    if (head) restarts.writeUInt32LE(at, (index / BLOCK) * 4);
    const shared = head ? 0 : Math.min(MAX_SHARED, common(previous, bytes));
    const entry = Buffer.alloc(ENTRY_HEADER + bytes.length - shared);
    entry.writeUInt8(shared, 0);
    entry.writeUInt16LE(bytes.length - shared, 1);
    bytes.copy(entry, ENTRY_HEADER, shared);
    parts.push(entry);
    ids.writeUInt32LE(id, index * 4);
    at += entry.length;
    previous = bytes;
  }

  const header = Buffer.alloc(HEADER);
  MAGIC.copy(header);
  header.writeUInt32LE(sorted.length, 8);
  header.writeUInt32LE(blocks, 12);
  header.writeUInt32LE(sorted.reduce((top, [, id]) => Math.max(top, id + 1), 0), 16);
  return Buffer.concat([header, restarts, ids, ...parts]);
}

function common(left: Buffer, right: Buffer): number {
  const limit = Math.min(left.length, right.length);
  let index = 0;
  while (index < limit && left[index] === right[index]) index += 1;
  return index;
}

function segmentOf(raw: Buffer): Segment | undefined {
  if (raw.length < HEADER || !raw.subarray(0, MAGIC.length).equals(MAGIC)) return undefined;
  const count = raw.readUInt32LE(8);
  const blocks = raw.readUInt32LE(12);
  const next = raw.readUInt32LE(16);
  const restarts = HEADER;
  const ids = restarts + blocks * 4;
  const entries = ids + count * 4;
  if (entries > raw.length) return undefined;
  return { raw, count, restarts, blocks, ids, entries, next };
}

/**
 * Where `wanted` sits against the whole path a block opens with. A head shares
 * nothing with what comes before it, so its bytes lie contiguously and are
 * compared where they lie.
 */
function compareHead(segment: Segment, block: number, wanted: Buffer): number | undefined {
  const at = segment.entries + segment.raw.readUInt32LE(segment.restarts + block * 4);
  if (at + ENTRY_HEADER > segment.raw.length) return undefined;
  const from = at + ENTRY_HEADER;
  const to = from + segment.raw.readUInt16LE(at + 1);
  if (to > segment.raw.length) return undefined;
  return -wanted.compare(segment.raw, from, to);
}

/**
 * Where `wanted` is inside one block, or `undefined` if the block does not hold
 * it.
 *
 * No path is rebuilt to find one. Every entry states how many bytes it shares
 * with the entry before it, and the walk carries how many bytes of `wanted` that
 * entry agreed on, which is enough to decide most comparisons without reading a
 * byte: an entry sharing less has already diverged, upwards, because the block
 * is sorted — so `wanted` is not here. One sharing more agrees on a byte
 * `wanted` disagreed with, so it sorts below and is stepped over. Only an entry
 * sharing exactly as much is read, and only from where the agreement ended.
 */
function indexInBlock(segment: Segment, block: number, wanted: Buffer): number | undefined {
  const raw = segment.raw;
  let at = segment.entries + raw.readUInt32LE(segment.restarts + block * 4);
  const last = Math.min(segment.count, (block + 1) * BLOCK);
  let matched = 0;

  for (let index = block * BLOCK; index < last; index += 1) {
    if (at + ENTRY_HEADER > raw.length) return undefined;
    const shared = raw.readUInt8(at);
    const length = raw.readUInt16LE(at + 1);
    const from = at + ENTRY_HEADER;
    if (from + length > raw.length) return undefined;

    if (shared < matched) return undefined;
    if (shared === matched) {
      const rest = wanted.length - matched;
      const limit = Math.min(length, rest);
      let step = 0;
      while (step < limit && raw[from + step] === wanted[matched + step]) step += 1;
      if (step < limit) {
        if (raw.readUInt8(from + step) > wanted.readUInt8(matched + step)) return undefined;
      } else if (length === rest) return index;
      else if (limit === rest) return undefined;
      matched += step;
    }
    at = from + length;
  }
  return undefined;
}

function indexIn(segment: Segment, wanted: Buffer): number | undefined {
  let low = 0;
  let high = segment.blocks - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    const head = compareHead(segment, middle, wanted);
    if (head === undefined) return undefined;
    if (head <= 0) low = middle;
    else high = middle - 1;
  }
  return indexInBlock(segment, low, wanted);
}

function tableOf(raw: readonly Buffer[]): ModuleNames {
  const segments = raw
    .map((bytes) => segmentOf(bytes))
    .filter((segment): segment is Segment => segment !== undefined);
  const count = segments.reduce((top, segment) => Math.max(top, segment.next), 0);

  // Only the fold reads backwards, and it reads backwards for every module it
  // reports. A transform reads forwards and never pays for this.
  let byId: (string | undefined)[] | undefined;
  const reverse = (): readonly (string | undefined)[] => {
    if (byId !== undefined) return byId;
    byId = Array.from<string | undefined>({ length: count });
    // Front coding reads forwards: the bytes an entry shares are the bytes the
    // entry before it left in the buffer, so only its own are copied in.
    let scratch: Buffer = Buffer.alloc(1024);
    for (const segment of segments) {
      let at = segment.entries;
      for (let index = 0; index < segment.count; index += 1) {
        if (at + ENTRY_HEADER > segment.raw.length) break;
        const shared = segment.raw.readUInt8(at);
        const length = segment.raw.readUInt16LE(at + 1);
        const from = at + ENTRY_HEADER;
        if (from + length > segment.raw.length || shared > scratch.length) break;
        if (shared + length > scratch.length) {
          const grown = Buffer.alloc(Math.max(scratch.length * 2, shared + length));
          scratch.copy(grown);
          scratch = grown;
        }
        segment.raw.copy(scratch, shared, from, from + length);
        const id = segment.raw.readUInt32LE(segment.ids + index * 4);
        byId[id] ??= scratch.toString('utf8', 0, shared + length);
        at = from + length;
      }
    }
    return byId;
  };

  return {
    count,
    idOf(name) {
      const wanted = Buffer.from(name, 'utf8');
      for (const segment of segments) {
        const index = indexIn(segment, wanted);
        if (index !== undefined) return segment.raw.readUInt32LE(segment.ids + index * 4);
      }
      return undefined;
    },
    pathOf(id) {
      return id >= 0 && id < count ? reverse()[id] : undefined;
    },
  };
}

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
