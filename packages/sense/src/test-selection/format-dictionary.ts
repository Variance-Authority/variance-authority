import { codeUnitOrder } from '@variance-authority/core/segment';

/** The dictionary the output gets, and the two ways to name a string in it. */
export interface MergedDictionary {
  /** A previous string id to its new one. Meaningless for an id nothing kept. */
  readonly remap: Uint32Array;
  /** The new id of a string an object-backed row or a test names. */
  readonly id: (value: string) => number;
  readonly blob: Buffer;
  readonly offsets: Uint32Array;
}

/**
 * A previous dictionary's `marked` strings and the `fresh` ones, as one
 * dictionary in code-unit order: each string once, every kept one copied as
 * the bytes it is stored as. `string` reads a kept one as text, for the rare
 * comparison bytes cannot settle.
 */
export function mergedDictionary(input: {
  readonly blob: Uint8Array;
  readonly offsets: Uint32Array;
  readonly marked: Uint8Array;
  readonly fresh: ReadonlySet<string>;
  readonly string: (id: number) => string;
}): MergedDictionary {
  const { marked, string } = input;
  const previousOffsets = input.offsets;
  const previousBlob = Buffer.isBuffer(input.blob)
    ? input.blob
    : Buffer.from(input.blob.buffer, input.blob.byteOffset, input.blob.byteLength);
  const strings = Math.max(previousOffsets.length - 1, 0);
  // Counted before it is filled, so the ids go straight into an array of the
  // size they need. A snapshot this size keeps a couple of million of them, and
  // a JavaScript array of a couple of million numbers is an order of magnitude
  // more memory than the integers in it — the doubling it grows by is paid in
  // full, at the moment the old copy and the new one are both alive.
  let survivorCount = 0;
  for (let id = 0; id < strings; id += 1) survivorCount += marked[id]!;
  const survivors = new Uint32Array(survivorCount);
  for (let id = 0, at = 0; id < strings; id += 1) if (marked[id] === 1) survivors[at++] = id;

  const fresh = [...input.fresh].sort(codeUnitOrder);
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
      codeUnitOrder(string(id), decoder.decode(bytes));

  /**
   * The new dictionary, as a merge of two ordered runs.
   *
   * The survivors in id order are already in dictionary order — the dictionary
   * they came out of was sorted, and a subsequence of a sorted list is sorted —
   * so the run that dominates the result is compared and copied as bytes, and
   * never becomes a string at all.
   */
  // One entry per output string: a previous id as itself, an entrant as the
  // ones' complement of its position in `fresh`. Two runs merge into a third no
  // longer than both, so the room it takes is known before the merge starts and
  // nothing here grows.
  const dictionary = new Int32Array(survivors.length + fresh.length);
  let held = 0;
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
      remap[id] = held;
      if (side === 0) {
        freshIds.set(fresh[entrant]!, held);
        entrant += 1;
      }
      blobLength += previousOffsets[id + 1]! - previousOffsets[id]!;
      dictionary[held++] = id;
      survivor += 1;
    } else {
      freshIds.set(fresh[entrant]!, held);
      blobLength += freshBytes[entrant]!.length;
      dictionary[held++] = ~entrant;
      entrant += 1;
    }
  }
  // Every string an object-backed row or a test names went into `fresh`, so the
  // small map answers every lookup and a map over the whole dictionary is never
  // built.
  const id = (value: string): number => freshIds.get(value)!;

  const stringBlob = Buffer.allocUnsafe(blobLength);
  const stringOffsets = new Uint32Array(held + 1);
  let offset = 0;
  for (let at = 0; at < held; at += 1) {
    stringOffsets[at] = offset;
    const value = dictionary[at]!;
    if (value >= 0) {
      offset += previousBlob.copy(stringBlob, offset, previousOffsets[value]!, previousOffsets[value + 1]!);
      continue;
    }
    const bytes = freshBytes[~value]!;
    stringBlob.set(bytes, offset);
    offset += bytes.length;
  }
  stringOffsets[held] = offset;

  return { remap, id, blob: stringBlob, offsets: stringOffsets };
}

/** Whether these bytes hold no code point at or above U+E000, where UTF-8 order stops being code-unit order. */
export function below(bytes: Uint8Array): boolean {
  for (let at = 0; at < bytes.length; at += 1) if (bytes[at]! >= 0xee) return false;
  return true;
}
