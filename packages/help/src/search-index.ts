import type { Help, UseKind } from '@variance-authority/package/help';
import { PARAGRAPH_BREAK } from '@variance-authority/package/help';
import { helpOf } from './store-value.js';
import { NONE, USE_KINDS, generationOf, sectionsOf, type StoreHead } from './store-layout.js';

/**
 * The questions' store: the Help value and the search over it, in one file a
 * question opens in place.
 *
 * The value holds every export of the repository, every import site of every
 * published name, and every signature and doc comment. A question needs a few
 * rows of it: a name's entry, its uses, a substring over names and docs.
 * Parsing the whole value to ask for one name made every question cost the
 * repository: on Kibana, 162 MB of JSON in front of every name question.
 *
 * So every field is a column here, every string lives once in a pool, and the
 * text a substring runs over is one lowercased byte run per column. Opening the
 * file costs one read and no decoding; a question decodes the rows it reads,
 * and the value decodes a field the first time something reads it.
 *
 * The loose pass reads a term dictionary written with the same tokenizer and
 * term rule MiniSearch was given, so the set it answers is the set MiniSearch
 * would have answered without building an index per question
 * ([`loose.ts`](./tools/loose.ts)). The dictionary holds each token whole and,
 * when the token is written in several words, each word, so `select test
 * files` reaches `selectTestFiles`.
 */

/**
 * The tokenizer MiniSearch applies by default, which the loose pass was built
 * with, the backtick, a symbol that delimits a code span and is never a word's,
 * and a math symbol (`Sm`), which a type writes between names: `Promise<Node>`,
 * `A | B`, `=>`.
 */
export const SPACE_OR_PUNCTUATION = /[\n\r\p{Z}\p{P}\p{Sm}`]+/u;

/** A query's terms: the tokens it was typed in, short ones dropped, the rest lowercased. */
export function tokensOf(text: string): readonly string[] {
  const found: string[] = [];
  for (const token of text.split(SPACE_OR_PUNCTUATION)) {
    if (token.length >= 2) found.push(token.toLowerCase());
  }
  return found;
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
  readonly doc?: string;
}

/** An opened store's search: columns over one buffer, decoded a row at a time. */
export interface SearchIndex {
  /** The generation the store was published as; absent when it was encoded in memory. */
  readonly generation?: StoreHead;
  /** Names whose lowercase text contains `query`, ascending. */
  namesContaining(query: string): readonly number[];
  /** Published rows whose lowercase doc contains `query`, ascending. */
  docsContaining(query: string): readonly number[];
  /** Exported rows whose lowercase doc contains `query`, ascending. */
  exportedDocsContaining(query: string): readonly number[];
  /** Of {@link docsContaining}, the rows whose doc says `query` in its opening paragraph, before any blank line. */
  docOpeningsContaining(query: string): readonly number[];
  /** Of {@link exportedDocsContaining}, the rows whose doc says `query` in its opening paragraph. */
  exportedDocOpeningsContaining(query: string): readonly number[];
  name(id: number): string;
  publishedOf(name: number): Uint32Array;
  exportedOf(name: number): Uint32Array;
  published(row: number): PublishedRow;
  /** The name id of one published row, without decoding the rest of it. */
  publishedName(row: number): number;
  /** The bytes of one published row's doc, without decoding it; absent when it has none. */
  publishedDocLength(row: number): number | undefined;
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
  exported(row: number): ExportedRow;
  /** The name id of one exported row, without decoding the rest of it. */
  exportedName(row: number): number;
  /** The bytes of one exported row's doc, without decoding it; absent when it has none. */
  exportedDocLength(row: number): number | undefined;
  /** Where one exported row sits among source, test and story: 0, 1 or 2. */
  exportedKind(row: number): number;
  /** The file of one exported row, without decoding the rest of it. */
  exportedAt(row: number): string;
  /** The file of one published row. */
  publishedAt(row: number): string;
  /** How many names the index holds. */
  readonly nameCount: number;
  /** How many dictionary terms there are; they are ordered by their UTF-8 bytes. */
  readonly termCount: number;
  term(id: number): string;
  termBytes(id: number): Buffer;
  termNames(term: number): Uint32Array;
  termPublished(term: number): Uint32Array;
  /** The exported rows whose doc holds the term. */
  termExported(term: number): Uint32Array;
  /** The published rows whose signature holds the term: what the declaration writes before its body. */
  termPublishedSignature(term: number): Uint32Array;
  /** The exported rows whose signature holds the term. */
  termExportedSignature(term: number): Uint32Array;
}

/** One opened store: the Help value, decoded a field at a time, and the search over it. */
export interface OpenedStore {
  readonly help: Help;
  readonly search: SearchIndex;
  /** Absent for a store encoded in memory. */
  readonly generation?: StoreHead;
  /** The digest of the export list, which every store carries. */
  readonly exportedDigest: string;
}

/** Open one encoded store's search. Throws on anything that is not this format and version. */
export function openSearchIndex(bytes: Uint8Array): SearchIndex {
  return openHelpStore(bytes).search;
}

/**
 * Open one encoded store. Throws on anything that is not this format and
 * version; nothing past the head is decoded until something reads it.
 */
export function openHelpStore(bytes: Uint8Array): OpenedStore {
  const sections = sectionsOf(bytes);
  const { fields, bytesOf, u32, string, maybe, slice } = sections;
  const files = u32('files');
  const stringOff = u32('strings.off');
  const stringBlob = bytesOf('strings.blob');

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
    usedByOff: u32('pub.usedByOff'), usedByList: u32('pub.usedByList'), uses: u32('pub.uses'),
    sitesOff: u32('pub.sitesOff'), tdOff: u32('pub.tdOff'),
  };
  const docLowerOff = u32('pub.docLowerOff');
  const docLower = bytesOf('pub.docLower');
  const exp = { name: u32('exp.name'), at: u32('exp.at'), by: u32('exp.by'), line: u32('exp.line'), doc: u32('exp.doc') };
  const expDocLowerOff = u32('exp.docLowerOff');
  const expDocLower = bytesOf('exp.docLower');
  const expKind = bytesOf('exp.kind');
  const useAt = u32('use.at');
  const termOff = u32('terms.off');
  const termBlob = bytesOf('terms.blob');
  const termNameOff = u32('terms.nameOff');
  const termName = u32('terms.name');
  const termPubOff = u32('terms.pubOff');
  const termPub = u32('terms.pub');
  const termExpOff = u32('terms.expOff');
  const termExp = u32('terms.exp');
  const termPubSigOff = u32('terms.pubSigOff');
  const termPubSig = u32('terms.pubSig');
  const termExpSigOff = u32('terms.expSigOff');
  const termExpSig = u32('terms.expSig');

  const name = (id: number): string => string(nameString[id] ?? NONE);
  const pubDoc = (row: number): string => maybe(pub.doc[row])?.toLowerCase() ?? '';
  const expDoc = (row: number): string => maybe(exp.doc[row])?.toLowerCase() ?? '';
  // Each doc in a lowercase blob is followed by its separator, the last one included.
  const docLength = (docs: Uint32Array, off: Uint32Array, row: number): number | undefined =>
    (docs[row] ?? NONE) === NONE ? undefined : (off[row + 1] ?? 0) - (off[row] ?? 0) - 1;
  const generation = generationOf(fields);

  const search: SearchIndex = {
    ...(generation === undefined ? {} : { generation }),
    namesContaining: (query) => containing(namesLower, namesLowerOff, query, (id) => name(id).toLowerCase()),
    docsContaining: (query) => containing(docLower, docLowerOff, query, pubDoc),
    exportedDocsContaining: (query) => containing(expDocLower, expDocLowerOff, query, expDoc),
    docOpeningsContaining: (query) => containing(docLower, docLowerOff, query, pubDoc, true),
    exportedDocOpeningsContaining: (query) => containing(expDocLower, expDocLowerOff, query, expDoc, true),
    name,
    publishedOf: (id) => slice(namesPubOff, namesPub, id),
    exportedOf: (id) => slice(namesExpOff, namesExp, id),
    published(row) {
      const doc = maybe(pub.doc[row]);
      return {
        row,
        name: name(pub.name[row] ?? NONE),
        specifier: string(pub.spec[row] ?? NONE),
        kind: string(pub.kind[row] ?? NONE),
        ...(doc === undefined ? {} : { doc }),
        at: string(pub.at[row] ?? NONE),
        usedBy: { length: usedByCount(row) },
        uses: pub.uses[row] ?? 0,
      };
    },
    publishedName: (row) => pub.name[row] ?? NONE,
    publishedDocLength: (row) => docLength(pub.doc, docLowerOff, row),
    rank: (id) => nameRank[id] ?? NONE,
    usedBy: (row) => usedByCount(row),
    uses: (row) => pub.uses[row] ?? 0,
    sites: (row) => [...slice(pub.sitesOff, useAt, row)].map(string),
    siteFiles: (row) => slice(pub.sitesOff, useAt, row),
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
    exported(row) {
      const doc = maybe(exp.doc[row]);
      return {
        row,
        name: name(exp.name[row] ?? NONE),
        at: string(exp.at[row] ?? NONE),
        by: string(exp.by[row] ?? NONE),
        line: exp.line[row] ?? 0,
        kind: USE_KINDS[expKind[row] ?? 0] ?? 'source',
        ...(doc === undefined ? {} : { doc }),
      };
    },
    exportedName: (row) => exp.name[row] ?? NONE,
    exportedDocLength: (row) => docLength(exp.doc, expDocLowerOff, row),
    exportedKind: (row) => expKind[row] ?? 0,
    exportedAt: (row) => string(exp.at[row] ?? NONE),
    publishedAt: (row) => string(pub.at[row] ?? NONE),
    nameCount: nameString.length,
    termCount: termOff.length - 1,
    term: (id) => termBlob.toString('utf8', termOff[id] ?? 0, termOff[id + 1] ?? 0),
    termBytes: (id) => termBlob.subarray(termOff[id] ?? 0, termOff[id + 1] ?? 0),
    termNames: (term) => slice(termNameOff, termName, term),
    termPublished: (term) => slice(termPubOff, termPub, term),
    termExported: (term) => slice(termExpOff, termExp, term),
    termPublishedSignature: (term) => slice(termPubSigOff, termPubSig, term),
    termExportedSignature: (term) => slice(termExpSigOff, termExpSig, term),
  };
  function usedByCount(row: number): number {
    return (pub.usedByOff[row + 1] ?? 0) - (pub.usedByOff[row] ?? 0);
  }

  const exportedDigest = fields.exportedDigest;
  if (exportedDigest === undefined) throw new Error('the help store states no digest of its export list');
  return { help: helpOf(sections), search, exportedDigest, ...(generation === undefined ? {} : { generation }) };
}

/**
 * Rows whose text contains `query`, found in one byte run rather than row by row.
 *
 * UTF-8 is self-synchronising, so a byte match of an encoded needle starts on a
 * character boundary and is a match of the string. Rows are joined with a NUL,
 * which no needle without one can span. A lone surrogate in the text encodes as
 * U+FFFD, so a query holding a NUL, a surrogate or U+FFFD is answered row by row
 * instead.
 *
 * With `opening`, a row is kept only when its first match comes before the
 * first blank line — the paragraph `opening()` shows, by its own rule — read
 * from the bytes between the row's start and the match alone.
 */
function containing(
  blob: Buffer,
  off: Uint32Array,
  query: string,
  text: (row: number) => string,
  opening = false,
): readonly number[] {
  const rows = off.length - 1;
  const found: number[] = [];
  if (rows <= 0 || query === '') return found;
  if (query.includes('\0') || /[\uD800-\uDFFF�]/.test(query)) {
    for (let row = 0; row < rows; row += 1) {
      const said = text(row);
      const at = said.indexOf(query);
      if (at !== -1 && (!opening || !PARAGRAPH_BREAK.test(said.slice(0, at)))) found.push(row);
    }
    return found;
  }
  const needle = Buffer.from(query, 'utf8');
  let at = blob.indexOf(needle, 0);
  while (at !== -1) {
    const row = rowAt(off, at);
    if (!opening || !PARAGRAPH_BREAK.test(blob.toString('utf8', off[row] ?? 0, at))) found.push(row);
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
