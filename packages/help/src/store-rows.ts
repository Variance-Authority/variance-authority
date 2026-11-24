import type { Deep, Documented, Entry, Named, Opening } from '@variance-authority/package/help';
import { NONE } from '@variance-authority/core/segment';
import type { Sections } from './store-layout.js';
import { decodersOf } from './store-decoders.js';

/**
 * The rows of one opened store a question names, found by what the question
 * holds: a name, a file, a specifier.
 *
 * The export list and the imports by path are tables of every file: 249,214
 * and 141,679 rows on Kibana. A question about one name prints a few dozen of
 * them, and decoding every row into an object to filter for those cost the
 * repository per question. So a lookup here compares ids or bytes down a
 * column, or reads a posting list the store holds, and decodes the rows it
 * found. Rows come back ascending, the order the whole table is in, so a
 * caller that filtered the table reads the same rows in the same order.
 */

// compass: variance-authority.report.agent-surface

/** Which of the three lists an import by path is in. */
export type PathGroup = 'deep' | 'byPath' | 'unfollowed';
const GROUPS: readonly PathGroup[] = ['deep', 'byPath', 'unfollowed'];

/** The rows of one opened store, by name, by file and by specifier. */
export interface StoreRows {
  /** Published candidates by their written name and the exports the declaration resolver selected. */
  publishedCandidates(name: string, declared: readonly Pick<Named, 'at' | 'name'>[]): readonly number[];
  /** One publishing door and its carried declaration identity, without its entry's metadata. */
  published(row: number): readonly [Documented, Opening, Pick<Entry, 'name' | 'at' | 'declared'>];
  /** One complete published entry. */
  entry(row: number): Entry;
  /** Every published spelling, once each, in the order its first entry has. */
  publishedNames(): readonly string[];
  /** The openings whose source files are among `files`, in their stored order. */
  openingsIn(files: Iterable<string>): readonly (readonly [Documented, Opening])[];
  /** The export rows written under `name`. */
  exportedNamed(name: string): Uint32Array;
  /** The export rows of the file `at`. */
  exportedIn(at: string): Uint32Array;
  /** The export rows whose own file binds them as `name`, whatever name they are exported under. */
  exportedBinding(name: string): readonly number[];
  /** One export row, the same value every time it is asked. */
  named(row: number): Named;
  /** The id of the file `path` among the files a row names; none for a path no row names. */
  fileId(path: string): number | undefined;
  /** The imports by path that take `name`. */
  pathsTaking(name: string): readonly number[];
  /** The imports by path written as exactly `specifier`. */
  pathsWritten(specifier: string): readonly number[];
  /** One import by path and the list it is in, the same value every time it is asked. */
  path(row: number): readonly [Deep, PathGroup];
}

/** The rows of one opened store, each lookup reading the columns it compares and the rows it found. */
export function rowsOf(sections: Sections): StoreRows {
  const { bytesOf, u32, string, slice } = sections;
  const decoders = decodersOf(sections);
  const stringOff = u32('strings.off');
  const stringBlob = bytesOf('strings.blob');
  const files = u32('files');
  const nameString = u32('names.name');
  const namesPubOff = u32('names.pubOff');
  const namesPub = u32('names.pub');
  const pubName = u32('pub.name');
  const pubAt = u32('pub.at');
  const pubDeclared = u32('pub.declared');
  const openEntryOff = u32('open.entryOff');
  const openSource = u32('open.source');
  const pkgOpenOff = u32('pkg.openOff');
  const namesExpOff = u32('names.expOff');
  const namesExp = u32('names.exp');
  const expAt = u32('exp.at');
  const expBound = u32('exp.bound');
  const deepSpecifier = u32('deep.specifier');
  const deepNamesOff = u32('deep.namesOff');
  const deepGroups = u32('deep.groups');
  const useName = u32('use.name');

  /** Whether the pooled string `id` is `wanted`, compared as bytes: nothing is decoded for a row that is not. */
  const says = (id: number, wanted: Buffer): boolean => {
    if (id === NONE) return false;
    const from = stringOff[id] ?? 0;
    const to = stringOff[id + 1] ?? 0;
    return to - from === wanted.length && stringBlob.compare(wanted, 0, wanted.length, from, to) === 0;
  };
  /**
   * The id every row of `column` naming `text` holds; none when none does. A
   * string lives once in the pool, so the first row that says it gives the id.
   */
  const idIn = (column: Uint32Array, from: number, to: number, text: string): number | undefined => {
    const wanted = Buffer.from(text, 'utf8');
    for (let row = from; row < to; row += 1) if (says(column[row] ?? NONE, wanted)) return column[row];
    return undefined;
  };
  /** The rows of `column` holding the id `text` has in it. */
  const rowsSaying = (column: Uint32Array, from: number, to: number, text: string): number[] => {
    const found: number[] = [];
    const id = idIn(column, from, to, text);
    if (id === undefined) return found;
    for (let row = from; row < to; row += 1) if (column[row] === id) found.push(row);
    return found;
  };

  // Name ids are in code-unit order of the names, which is not the order of
  // their bytes, so the names themselves are compared: one per halving.
  const nameId = (name: string): number | undefined => {
    let low = 0;
    let high = nameString.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const held = string(nameString[middle] ?? NONE);
      if (held === name) return middle;
      if (held < name) low = middle + 1;
      else high = middle;
    }
    return undefined;
  };

  // `files` holds the id of every file a row names, in the order of their bytes.
  const fileId = (path: string): number | undefined => {
    const wanted = Buffer.from(path, 'utf8');
    let low = 0;
    let high = files.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const id = files[middle] ?? NONE;
      const order = stringBlob.compare(wanted, 0, wanted.length, stringOff[id] ?? 0, stringOff[id + 1] ?? 0);
      if (order === 0) return id;
      if (order > 0) high = middle;
      else low = middle + 1;
    }
    return undefined;
  };

  // A file's export rows, grouped once by a counting sort of the file column:
  // two typed arrays, and no object for a row.
  let grouped: { readonly off: Uint32Array; readonly rows: Uint32Array } | undefined;
  const byFile = (): { readonly off: Uint32Array; readonly rows: Uint32Array } => {
    if (grouped !== undefined) return grouped;
    const off = new Uint32Array(stringOff.length + 1);
    for (let row = 0; row < expAt.length; row += 1) off[(expAt[row] ?? 0) + 1]! += 1;
    for (let id = 1; id < off.length; id += 1) off[id]! += off[id - 1]!;
    const next = off.slice(0, off.length - 1);
    const rows = new Uint32Array(expAt.length);
    for (let row = 0; row < expAt.length; row += 1) rows[next[expAt[row] ?? 0]!++] = row;
    return (grouped = { off, rows });
  };

  const held = new Map<number, Named>();
  const paths = new Map<number, readonly [Deep, PathGroup]>();
  const firstUse = deepNamesOff[0] ?? 0;
  const lastUse = deepNamesOff[deepNamesOff.length - 1] ?? firstUse;
  const openingOwner = (row: number): number => pkgOpenOff.findIndex((end, at) => at > 0 && row < end) - 1;
  return {
    publishedCandidates(name, declared) {
      const id = nameId(name);
      const found = new Set(id === undefined ? [] : slice(namesPubOff, namesPub, id));
      const named = Buffer.from(name, 'utf8');
      const bindings = new Map<number, Buffer[]>();
      for (const held of declared) {
        const at = fileId(held.at);
        if (at === undefined) continue;
        const names = bindings.get(at) ?? [];
        bindings.set(at, names);
        names.push(Buffer.from(held.name, 'utf8'));
      }
      for (let row = 0; row < pubDeclared.length; row += 1) {
        const binding = pubDeclared[row] ?? NONE;
        if (says(binding, named) || bindings.get(pubAt[row] ?? NONE)?.some((one) => says(binding, one)) === true) found.add(row);
      }
      return [...found].sort((left, right) => left - right);
    },
    published(row) {
      const opening = openEntryOff.findIndex((end, at) => at > 0 && row < end) - 1;
      return [decoders.package(openingOwner(opening)), decoders.opening(opening), {
        name: string(nameString[pubName[row] ?? NONE] ?? NONE),
        at: string(pubAt[row] ?? NONE),
        declared: string(pubDeclared[row] ?? NONE),
      }];
    },
    entry: decoders.entry,
    publishedNames: () => [...new Set(pubName)].map((id) => string(nameString[id] ?? NONE)),
    openingsIn(files) {
      const ids = new Set([...files].map(fileId).filter((id) => id !== undefined));
      const found: (readonly [Documented, Opening])[] = [];
      for (let row = 0; row < openSource.length; row += 1) {
        if (ids.has(openSource[row] ?? NONE)) found.push([decoders.package(openingOwner(row)), decoders.opening(row)]);
      }
      return found;
    },
    exportedNamed(name) {
      const id = nameId(name);
      return id === undefined ? new Uint32Array() : slice(namesExpOff, namesExp, id);
    },
    exportedIn(at) {
      const id = fileId(at);
      if (id === undefined) return new Uint32Array();
      const { off, rows } = byFile();
      return rows.subarray(off[id] ?? 0, off[id + 1] ?? 0);
    },
    exportedBinding: (name) => rowsSaying(expBound, 0, expBound.length, name),
    fileId,
    named(row) {
      let value = held.get(row);
      if (value === undefined) held.set(row, (value = decoders.named(row)));
      return value;
    },
    pathsTaking(name) {
      const found: number[] = [];
      let row = 0;
      for (const use of rowsSaying(useName, firstUse, lastUse, name)) {
        while ((deepNamesOff[row + 1] ?? 0) <= use) row += 1;
        if (found[found.length - 1] !== row) found.push(row);
      }
      return found;
    },
    pathsWritten: (specifier) => rowsSaying(deepSpecifier, 0, deepSpecifier.length, specifier),
    path(row) {
      let value = paths.get(row);
      if (value === undefined) {
        const group = GROUPS[deepGroups.findIndex((end) => row < end)] ?? 'unfollowed';
        paths.set(row, (value = [decoders.path(row), group]));
      }
      return value;
    },
  };
}
