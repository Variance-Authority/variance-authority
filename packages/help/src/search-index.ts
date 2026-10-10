import type { Help, UseKind } from '@variance-authority/package/help';
import { everyEntry } from '@variance-authority/package/help';
import { encodeSearch, type PublishedRows, type SearchGeneration } from '@variance-authority/sense';
import { specifierOf } from './tools/find.js';

export type { SearchGeneration };

/**
 * What `docs_search` reads, laid out so a question reads only what it matches.
 *
 * The published Help value holds every export of the repository, every import
 * site of every published name, and every signature and doc comment. Search
 * needs a substring over names and docs, and then the few rows the substring
 * hit. Parsing the whole value to ask for one name made every question cost the
 * repository: on a Jira-scale workspace, 836 ms of `JSON.parse` in front of a
 * 71 ms scan.
 *
 * So the rows search can print are columns here, every string lives once in a
 * pool, and the text a substring runs over is one lowercased byte run per
 * column. Opening the file costs one read and no decoding; a question decodes
 * the rows it matched.
 *
 * The loose pass reads a term dictionary written with the same tokenizer and
 * term rule MiniSearch was given, so the set it answers is the set MiniSearch
 * would have answered without building an index per question
 * ([`loose.ts`](./tools/loose.ts)). The dictionary holds each token whole and,
 * when the token is written in several words, each word, so `select test
 * files` reaches `selectTestFiles`.
 */

// The layout is written by `help_search.rs` in the sense addon.
const MAGIC = 0x53484156; // "VAHS", little-endian
const VERSION = 2;
const NONE = 0xffffffff;

/** The tokenizer MiniSearch applies by default, which the loose pass was built with. */
export const SPACE_OR_PUNCTUATION = /[\n\r\p{Z}\p{P}]+/u;

/** A query's terms: the tokens it was typed in, short ones dropped, the rest lowercased. */
export function tokensOf(text: string): readonly string[] {
  const found: string[] = [];
  for (const token of text.split(SPACE_OR_PUNCTUATION)) {
    if (token.length >= 2) found.push(token.toLowerCase());
  }
  return found;
}

const LOWER = /^\p{Lowercase}$/u;
const UPPER = /^\p{Uppercase}$/u;
const DIGIT = /^\p{N}$/u;

/**
 * The words one token is written in, split where the case or a digit changes:
 * a lowercase letter before an uppercase one, the last capital of a run before
 * a lowercase letter, and a digit beside anything that is not one.
 * `parseHTTPResponse2` is `parse`, `HTTP`, `Response` and `2`; a token with
 * nowhere to split is one word.
 */
export function wordsOf(token: string): readonly string[] {
  const chars = [...token];
  const words: string[] = [];
  let start = 0;
  for (let at = 1; at < chars.length; at += 1) {
    const before = chars[at - 1]!;
    const here = chars[at]!;
    const after = chars[at + 1];
    const split =
      (LOWER.test(before) && UPPER.test(here)) ||
      (UPPER.test(before) && UPPER.test(here) && after !== undefined && LOWER.test(after)) ||
      DIGIT.test(before) !== DIGIT.test(here);
    if (!split) continue;
    words.push(chars.slice(start, at).join(''));
    start = at;
  }
  words.push(chars.slice(start).join(''));
  return words;
}

/**
 * The term rule the dictionary is written with: each token whole and, when it
 * is written in several words, each word; a term shorter than two UTF-16 code
 * units is dropped and the rest are lowercased, once each. `help_search.rs`
 * writes the dictionary by the same rule.
 */
export function termsOf(text: string): readonly string[] {
  const found = new Set<string>();
  for (const token of text.split(SPACE_OR_PUNCTUATION)) {
    if (token.length >= 2) found.add(token.toLowerCase());
    const words = wordsOf(token);
    if (words.length < 2) continue;
    for (const word of words) if (word.length >= 2) found.add(word.toLowerCase());
  }
  return [...found];
}

const USE_KINDS: readonly UseKind[] = ['source', 'test', 'story'];

const SECTIONS = [
  'strings.off', 'strings.blob', 'files',
  'names.name', 'names.rank', 'names.lowerOff', 'names.lower', 'names.pubOff', 'names.pub', 'names.expOff', 'names.exp',
  'pub.name', 'pub.spec', 'pub.kind', 'pub.doc', 'pub.at', 'pub.usedBy', 'pub.uses', 'pub.sitesOff', 'sites.at',
  'pub.docLowerOff', 'pub.docLower',
  'exp.name', 'exp.at', 'exp.by', 'exp.line', 'exp.kind',
  'terms.off', 'terms.blob', 'terms.nameOff', 'terms.name', 'terms.pubOff', 'terms.pub',
] as const;
type SectionName = (typeof SECTIONS)[number];

/**
 * The published rows of one Help value, a column per field, in the order
 * `everyEntry` yields them.
 */
export function publishedRows(help: Help): PublishedRows {
  const rows: PublishedRows = { name: [], spec: [], kind: [], doc: [], at: [], usedBy: [], uses: [], siteCounts: [], sites: [] };
  for (const [owner, held, entry] of everyEntry(help)) {
    rows.name.push(entry.name);
    rows.spec.push(specifierOf(owner, held));
    rows.kind.push(entry.kind);
    rows.doc.push(entry.doc ?? null);
    rows.at.push(entry.at);
    rows.usedBy.push(entry.usedBy.length);
    rows.uses.push(entry.uses);
    rows.siteCounts.push(entry.sites.length);
    for (const site of entry.sites) rows.sites.push(site.at);
  }
  return rows;
}

/**
 * Encode what search reads of one Help value. The addon encodes it
 * (`help_search.rs`), because `variance index` publishes the same file from a
 * reading whose export list never reaches JavaScript.
 */
export function encodeSearchIndex(help: Help, generation?: SearchGeneration): Uint8Array {
  return encodeSearch(publishedRows(help), help.exported, generation).bytes;
}

function align(at: number): number {
  return (at + 3) & ~3;
}

/** One published name, as a search line prints it. */
export interface PublishedRow {
  readonly row: number;
  readonly name: string;
  readonly specifier: string;
  readonly kind: string;
  readonly doc?: string;
  readonly at: string;
  /** Counted and not named: a list line never names who imports. */
  readonly usedBy: { readonly length: number };
  readonly uses: number;
}

/** One exported name, as a search line prints it. */
export interface ExportedRow {
  readonly row: number;
  readonly name: string;
  readonly at: string;
  readonly by: string;
  readonly line: number;
  readonly kind: UseKind;
}

/** An opened index: columns over one buffer, decoded a row at a time. */
export interface SearchIndex {
  readonly generation?: SearchGeneration;
  /** Names whose lowercase text contains `query`, ascending. */
  namesContaining(query: string): readonly number[];
  /** Published rows whose lowercase doc contains `query`, ascending. */
  docsContaining(query: string): readonly number[];
  name(id: number): string;
  publishedOf(name: number): Uint32Array;
  exportedOf(name: number): Uint32Array;
  published(row: number): PublishedRow;
  /** The name id of one published row, without decoding the rest of it. */
  publishedName(row: number): number;
  /** A name's place in code-unit order among every name the index holds. */
  rank(name: number): number;
  /** The package and import counts of one published row, read off their columns. */
  usedBy(row: number): number;
  uses(row: number): number;
  /** The files that import one published row, one per import site. */
  sites(row: number): readonly string[];
  /** The same, as file ids. */
  siteFiles(row: number): Uint32Array;
  /** The ids of those of `paths` any row names; a path no row names has none. */
  fileIds(paths: Iterable<string>): ReadonlySet<number>;
  file(id: number): string;
  exportedFile(row: number): number;
  publishedFile(row: number): number;
  exported(row: number): ExportedRow;
  /** Where one exported row sits among source, test and story: 0, 1 or 2. */
  exportedKind(row: number): number;
  /** The file of one exported row, without decoding the rest of it. */
  exportedAt(row: number): string;
  /** The file of one published row. */
  publishedAt(row: number): string;
  /** How many dictionary terms there are; they are ordered by their UTF-8 bytes. */
  readonly termCount: number;
  term(id: number): string;
  termBytes(id: number): Buffer;
  termNames(term: number): Uint32Array;
  termPublished(term: number): Uint32Array;
}

/** Open one encoded index. Throws on anything that is not this format and version. */
export function openSearchIndex(bytes: Uint8Array): SearchIndex {
  // Columns are read in place as 32-bit words, which needs them 4-aligned.
  const buffer =
    bytes.byteOffset % 4 === 0
      ? Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
      : Buffer.from(new Uint8Array(bytes).buffer);
  if (buffer.length < 12 || buffer.readUInt32LE(0) !== MAGIC || buffer.readUInt32LE(4) !== VERSION) {
    throw new Error(`not a search index v${VERSION}`);
  }
  const headLength = buffer.readUInt32LE(8);
  const head = JSON.parse(buffer.toString('utf8', 12, 12 + headLength)) as {
    generation: SearchGeneration | null;
    sections: Record<string, readonly [number, number]>;
  };
  const start = align(12 + headLength);
  const bytesOf = (name: SectionName): Buffer => {
    const [at, length] = head.sections[name] ?? [0, 0];
    return buffer.subarray(start + at, start + at + length);
  };
  const u32 = (name: SectionName): Uint32Array => {
    const held = bytesOf(name);
    return new Uint32Array(held.buffer, held.byteOffset, held.byteLength / 4);
  };

  const stringOff = u32('strings.off');
  const stringBlob = bytesOf('strings.blob');
  const files = u32('files');
  const string = (id: number): string =>
    stringBlob.toString('utf8', stringOff[id] ?? 0, stringOff[id + 1] ?? 0);

  const nameString = u32('names.name');
  const nameRank = u32('names.rank');
  const namesLowerOff = u32('names.lowerOff');
  const namesLower = bytesOf('names.lower');
  const namesPubOff = u32('names.pubOff');
  const namesPub = u32('names.pub');
  const namesExpOff = u32('names.expOff');
  const namesExp = u32('names.exp');
  const pub = {
    name: u32('pub.name'), spec: u32('pub.spec'), kind: u32('pub.kind'), doc: u32('pub.doc'), at: u32('pub.at'),
    usedBy: u32('pub.usedBy'), uses: u32('pub.uses'), sitesOff: u32('pub.sitesOff'),
  };
  const sitesAt = u32('sites.at');
  const docLowerOff = u32('pub.docLowerOff');
  const docLower = bytesOf('pub.docLower');
  const exp = { name: u32('exp.name'), at: u32('exp.at'), by: u32('exp.by'), line: u32('exp.line') };
  const expKind = bytesOf('exp.kind');
  const termOff = u32('terms.off');
  const termBlob = bytesOf('terms.blob');
  const termNameOff = u32('terms.nameOff');
  const termName = u32('terms.name');
  const termPubOff = u32('terms.pubOff');
  const termPub = u32('terms.pub');

  const name = (id: number): string => string(nameString[id] ?? NONE);
  const slice = (off: Uint32Array, rows: Uint32Array, key: number): Uint32Array =>
    rows.subarray(off[key] ?? 0, off[key + 1] ?? 0);

  return {
    ...(head.generation === null ? {} : { generation: head.generation }),
    namesContaining: (query) => containing(namesLower, namesLowerOff, query, (id) => name(id).toLowerCase()),
    docsContaining: (query) =>
      containing(docLower, docLowerOff, query, (row) => {
        const doc = pub.doc[row] ?? NONE;
        return doc === NONE ? '' : string(doc).toLowerCase();
      }),
    name,
    publishedOf: (id) => slice(namesPubOff, namesPub, id),
    exportedOf: (id) => slice(namesExpOff, namesExp, id),
    published(row) {
      const doc = pub.doc[row] ?? NONE;
      return {
        row,
        name: name(pub.name[row] ?? NONE),
        specifier: string(pub.spec[row] ?? NONE),
        kind: string(pub.kind[row] ?? NONE),
        ...(doc === NONE ? {} : { doc: string(doc) }),
        at: string(pub.at[row] ?? NONE),
        usedBy: { length: pub.usedBy[row] ?? 0 },
        uses: pub.uses[row] ?? 0,
      };
    },
    publishedName: (row) => pub.name[row] ?? NONE,
    rank: (id) => nameRank[id] ?? NONE,
    usedBy: (row) => pub.usedBy[row] ?? 0,
    uses: (row) => pub.uses[row] ?? 0,
    sites: (row) => [...slice(pub.sitesOff, sitesAt, row)].map(string),
    siteFiles: (row) => slice(pub.sitesOff, sitesAt, row),
    fileIds(paths) {
      const ids = new Set<number>();
      for (const path of paths) {
        const wanted = Buffer.from(path, 'utf8');
        let low = 0;
        let high = files.length;
        while (low < high) {
          const middle = (low + high) >>> 1;
          const id = files[middle] ?? NONE;
          const order = stringBlob.compare(wanted, 0, wanted.length, stringOff[id] ?? 0, stringOff[id + 1] ?? 0);
          if (order === 0) {
            ids.add(id);
            break;
          }
          if (order > 0) high = middle;
          else low = middle + 1;
        }
      }
      return ids;
    },
    file: string,
    exportedFile: (row) => exp.at[row] ?? NONE,
    publishedFile: (row) => pub.at[row] ?? NONE,
    exported: (row) => ({
      row,
      name: name(exp.name[row] ?? NONE),
      at: string(exp.at[row] ?? NONE),
      by: string(exp.by[row] ?? NONE),
      line: exp.line[row] ?? 0,
      kind: USE_KINDS[expKind[row] ?? 0] ?? 'source',
    }),
    exportedKind: (row) => expKind[row] ?? 0,
    exportedAt: (row) => string(exp.at[row] ?? NONE),
    publishedAt: (row) => string(pub.at[row] ?? NONE),
    termCount: termOff.length - 1,
    term: (id) => termBlob.toString('utf8', termOff[id] ?? 0, termOff[id + 1] ?? 0),
    termBytes: (id) => termBlob.subarray(termOff[id] ?? 0, termOff[id + 1] ?? 0),
    termNames: (term) => slice(termNameOff, termName, term),
    termPublished: (term) => slice(termPubOff, termPub, term),
  };
}

/**
 * Rows whose text contains `query`, found in one byte run rather than row by row.
 *
 * UTF-8 is self-synchronising, so a byte match of an encoded needle starts on a
 * character boundary and is a match of the string. Rows are joined with a NUL,
 * which no needle without one can span. A lone surrogate in the text encodes as
 * U+FFFD, so a query holding a NUL, a surrogate or U+FFFD is answered row by row
 * instead.
 */
function containing(
  blob: Buffer,
  off: Uint32Array,
  query: string,
  text: (row: number) => string,
): readonly number[] {
  const rows = off.length - 1;
  const found: number[] = [];
  if (rows <= 0 || query === '') return found;
  if (query.includes('\0') || /[\uD800-\uDFFF\uFFFD]/.test(query)) {
    for (let row = 0; row < rows; row += 1) if (text(row).includes(query)) found.push(row);
    return found;
  }
  const needle = Buffer.from(query, 'utf8');
  let at = blob.indexOf(needle, 0);
  while (at !== -1) {
    const row = rowAt(off, at);
    found.push(row);
    at = blob.indexOf(needle, off[row + 1] ?? blob.length);
  }
  return found;
}

/** The row whose bytes start at or before `at`. */
function rowAt(off: Uint32Array, at: number): number {
  let low = 0;
  let high = off.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >>> 1;
    if ((off[middle] ?? 0) <= at) low = middle;
    else high = middle - 1;
  }
  return low;
}
