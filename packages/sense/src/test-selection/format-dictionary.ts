import { codeUnitOrder } from './instrumented-modules.js';
import type { TestCoverageView } from './format-view.js';
import type { CoverageModule, CoverageTest } from './index.js';

/**
 * The output's module order: an object for what the run touched or what moved
 * on disk, and a row number for everything else.
 *
 * A row number is the whole of what a carried module costs. Everything the
 * layer does between here and the columns reads it, and only it.
 */
export interface LayeredRow {
  readonly file: string;
  readonly module?: CoverageModule;
  readonly at?: number;
}

/** The id columns a carried row names its strings through. */
export interface NamingColumns {
  readonly modulePath: Uint32Array;
  readonly moduleSource: Uint32Array;
  readonly moduleBlocks: Uint32Array;
  readonly blockName: Uint32Array;
  readonly blockPath: Uint32Array;
  readonly blockDigest: Uint32Array;
}

/** The dictionary the output gets, and the two ways to name a string in it. */
export interface LayeredDictionary {
  /** A previous string id to its new one. Meaningless for an id nothing kept. */
  readonly remap: Uint32Array;
  /** The new id of a string an object-backed row or a test names. */
  readonly id: (value: string) => number;
  readonly blob: Buffer;
  readonly offsets: Uint32Array;
}

/**
 * The output's dictionary, built without decoding the strings it carries.
 *
 * A layer keeps almost every string the previous snapshot held and adds a few
 * hundred. Deciding which are kept is a pass over the id columns, and an id is
 * an integer; placing the entrants among them is a merge of two ordered runs,
 * and the run that dominates the result is compared and copied as UTF-8 and
 * never becomes a string at all. That is what makes the whole layer cheap: the
 * dictionary is the one part of a snapshot that a rewrite has to touch in full.
 */
export function layeredDictionary(input: {
  readonly view: TestCoverageView;
  readonly rows: readonly LayeredRow[];
  readonly tests: readonly CoverageTest[];
  readonly instrumentation: string;
  readonly commit: string | undefined;
  readonly columns: NamingColumns;
}): LayeredDictionary {
  const { view, rows, tests, columns } = input;
  const { modulePath, moduleSource, moduleBlocks, blockName, blockPath, blockDigest } = columns;
  const current = { instrumentation: input.instrumentation, commit: input.commit };

  // Which previous strings the output still names. No string is made to answer
  // that: marking is a pass over the id columns, and an id is an integer.
  const stored = view.dictionary();
  const previousOffsets = stored.offsets;
  const previousBlob = Buffer.isBuffer(stored.blob)
    ? stored.blob
    : Buffer.from(stored.blob.buffer, stored.blob.byteOffset, stored.blob.byteLength);
  const strings = previousOffsets.length - 1;
  const marked = new Uint8Array(strings);
  for (const row of rows) {
    if (row.at === undefined) continue;
    marked[modulePath[row.at]!] = 1;
    marked[moduleSource[row.at]!] = 1;
    for (let block = moduleBlocks[row.at]!; block < moduleBlocks[row.at + 1]!; block += 1) {
      marked[blockName[block]!] = 1;
      marked[blockPath[block]!] = 1;
      marked[blockDigest[block]!] = 1;
    }
  }
  const survivors: number[] = [];
  for (let id = 0; id < strings; id += 1) if (marked[id] === 1) survivors.push(id);

  // Everything the object-backed side names. Small, because the object-backed
  // side is what this run actually looked at.
  const freshValues = new Set<string>();
  freshValues.add(current.instrumentation);
  if (current.commit !== undefined) freshValues.add(current.commit);
  for (const test of tests) {
    freshValues.add(test.file);
    for (const precondition of test.preconditions) {
      freshValues.add(precondition.name);
      freshValues.add(precondition.digest);
    }
  }
  for (const row of rows) {
    if (row.module === undefined) continue;
    freshValues.add(row.module.file);
    freshValues.add(row.module.sourceDigest);
    for (const block of row.module.blocks) {
      freshValues.add(block.name);
      freshValues.add(block.path);
      freshValues.add(block.digest);
    }
  }
  const fresh = [...freshValues].sort(codeUnitOrder);
  const freshBytes = fresh.map((value) => Buffer.from(value, 'utf8'));

  /**
   * UTF-8 byte order is code point order, and code point order is UTF-16 code
   * unit order for everything below U+E000. Above it the two disagree, because a
   * surrogate pair sorts under U+E000 by code unit and over it by code point.
   * Nothing a snapshot holds — a repository path, a declaration name, a hex
   * digest — reaches that far, but "nothing does" is not a proof, so it is
   * checked, and the comparison falls back to the strings themselves when the
   * check fails.
   */
  const ascends = below(previousBlob) && freshBytes.every(below);
  const decoder = new TextDecoder();
  const order = ascends
    ? (id: number, bytes: Buffer): number =>
      previousBlob.compare(bytes, 0, bytes.length, previousOffsets[id]!, previousOffsets[id + 1]!)
    : (id: number, bytes: Buffer): number =>
      codeUnitOrder(view.string(id), decoder.decode(bytes));

  /**
   * The new dictionary, as a merge of two ordered runs.
   *
   * The survivors in id order are already in dictionary order — the dictionary
   * they came out of was sorted, and a subsequence of a sorted list is sorted —
   * so the run that dominates the result is compared and copied as bytes, and
   * never becomes a string at all.
   */
  const dictionary: (number | Buffer)[] = [];
  const remap = new Uint32Array(strings);
  const freshIds = new Map<string, number>();
  let survivor = 0;
  let entrant = 0;
  let blobLength = 0;
  while (survivor < survivors.length || entrant < fresh.length) {
    const side = survivor >= survivors.length ? 1
      : entrant >= fresh.length ? -1
      : order(survivors[survivor]!, freshBytes[entrant]!);
    if (side <= 0) {
      const id = survivors[survivor]!;
      remap[id] = dictionary.length;
      if (side === 0) {
        freshIds.set(fresh[entrant]!, dictionary.length);
        entrant += 1;
      }
      blobLength += previousOffsets[id + 1]! - previousOffsets[id]!;
      dictionary.push(id);
      survivor += 1;
    } else {
      freshIds.set(fresh[entrant]!, dictionary.length);
      blobLength += freshBytes[entrant]!.length;
      dictionary.push(freshBytes[entrant]!);
      entrant += 1;
    }
  }
  // Every string an object-backed row or a test names went into `fresh`, so the
  // small map answers every lookup and a map over the whole dictionary is never
  // built.
  const id = (value: string): number => freshIds.get(value)!;

  const stringBlob = Buffer.allocUnsafe(blobLength);
  const stringOffsets = new Uint32Array(dictionary.length + 1);
  let offset = 0;
  for (const [at, value] of dictionary.entries()) {
    stringOffsets[at] = offset;
    if (typeof value === 'number') {
      offset += previousBlob.copy(stringBlob, offset, previousOffsets[value]!, previousOffsets[value + 1]!);
      continue;
    }
    stringBlob.set(value, offset);
    offset += value.length;
  }
  stringOffsets[dictionary.length] = offset;

  return { remap, id, blob: stringBlob, offsets: stringOffsets };
}

/** Whether these bytes hold no code point at or above U+E000. */
function below(bytes: Uint8Array): boolean {
  for (let at = 0; at < bytes.length; at += 1) if (bytes[at]! >= 0xee) return false;
  return true;
}
