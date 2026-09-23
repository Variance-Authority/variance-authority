import type { Help, UseKind } from '@variance-authority/package/help';
import { everyEntry } from '@variance-authority/package/help';
import { specifierOf } from './tools/find.js';

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
 * ([`loose.ts`](./tools/loose.ts)).
 */

const MAGIC = 0x53484156; // "VAHS", little-endian
const VERSION = 1;
const NONE = 0xffffffff;

/** The tokenizer MiniSearch applies by default, which the loose pass was built with. */
export const SPACE_OR_PUNCTUATION = /[\n\r\p{Z}\p{P}]+/u;

/** The term rule the loose pass gave MiniSearch: short terms dropped, the rest lowercased. */
export function termsOf(text: string): readonly string[] {
  const found: string[] = [];
  for (const token of text.split(SPACE_OR_PUNCTUATION)) {
    if (token.length >= 2) found.push(token.toLowerCase());
  }
  return found;
}

/** Which generation the index belongs to; absent on one built in memory. */
export interface SearchGeneration {
  readonly root: string;
  readonly graphRoot: string;
  readonly graphDigest: string;
  readonly generatedAt: string;
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

class Pool {
  readonly ids = new Map<string, number>();
  readonly values: string[] = [];
  id(value: string): number {
    let id = this.ids.get(value);
    if (id === undefined) {
      id = this.values.length;
      this.ids.set(value, id);
      this.values.push(value);
    }
    return id;
  }
}

/** Strings joined as UTF-8 with a separator, and where each one starts. */
function joined(values: readonly string[], separator: string): { off: Uint32Array; blob: Uint8Array } {
  const text = values.join(separator);
  const blob = Buffer.from(text, 'utf8');
  const off = new Uint32Array(values.length + 1);
  let at = 0;
  for (let index = 0; index < values.length; index += 1) {
    off[index] = at;
    at += Buffer.byteLength(values[index] ?? '', 'utf8') + Buffer.byteLength(separator, 'utf8');
  }
  off[values.length] = values.length === 0 ? 0 : blob.length + Buffer.byteLength(separator, 'utf8');
  return { off, blob };
}

/** Postings: for each key, the ascending rows that hold it. */
function postings(lists: readonly (readonly number[])[]): { off: Uint32Array; rows: Uint32Array } {
  const off = new Uint32Array(lists.length + 1);
  let total = 0;
  for (let key = 0; key < lists.length; key += 1) {
    off[key] = total;
    total += lists[key]?.length ?? 0;
  }
  off[lists.length] = total;
  const rows = new Uint32Array(total);
  let at = 0;
  for (const list of lists) for (const row of list ?? []) rows[at++] = row;
  return { off, rows };
}

const u32s = (values: readonly number[]): Uint32Array => Uint32Array.from(values);

/** Each name's place in code-unit order, so a tie is broken without decoding either side. */
function ranks(values: readonly string[]): Uint32Array {
  const order = values.map((_, id) => id).sort((a, b) => {
    const x = values[a] ?? '';
    const y = values[b] ?? '';
    return x < y ? -1 : x > y ? 1 : 0;
  });
  const rank = new Uint32Array(values.length);
  order.forEach((id, at) => (rank[id] = at));
  return rank;
}

/** Encode what search reads of one Help value. */
export function encodeSearchIndex(help: Help, generation?: SearchGeneration): Uint8Array {
  const strings = new Pool();
  const names = new Pool();
  const nameString: number[] = [];
  const namePub: number[][] = [];
  const nameExp: number[][] = [];
  const nameOf = (name: string): number => {
    const id = names.id(name);
    if (nameString[id] === undefined) {
      nameString[id] = strings.id(name);
      namePub[id] = [];
      nameExp[id] = [];
    }
    return id;
  };

  const pub = { name: [] as number[], spec: [] as number[], kind: [] as number[], doc: [] as number[],
    at: [] as number[], usedBy: [] as number[], uses: [] as number[] };
  const sitesOff: number[] = [0];
  const sitesAt: number[] = [];
  const docLower: string[] = [];

  // The loose pass's dictionary: a name's own terms, and each published row's
  // doc terms, kept apart because an area admits a doc by the row's file.
  const byTerm = new Map<string, { names: number[]; pub: number[] }>();
  const post = (term: string): { names: number[]; pub: number[] } => {
    let held = byTerm.get(term);
    if (held === undefined) byTerm.set(term, (held = { names: [], pub: [] }));
    return held;
  };

  for (const [owner, held, entry] of everyEntry(help)) {
    const row = pub.name.length;
    const name = nameOf(entry.name);
    namePub[name]?.push(row);
    pub.name.push(name);
    pub.spec.push(strings.id(specifierOf(owner, held)));
    pub.kind.push(strings.id(entry.kind));
    pub.doc.push(entry.doc === undefined ? NONE : strings.id(entry.doc));
    pub.at.push(strings.id(entry.at));
    pub.usedBy.push(entry.usedBy.length);
    pub.uses.push(entry.uses);
    for (const site of entry.sites) sitesAt.push(strings.id(site.at));
    sitesOff.push(sitesAt.length);
    docLower.push((entry.doc ?? '').toLowerCase());
    if (entry.doc !== undefined) for (const term of new Set(termsOf(entry.doc))) post(term).pub.push(row);
  }

  const exp = { name: [] as number[], at: [] as number[], by: [] as number[], line: [] as number[], kind: [] as number[] };
  for (const named of help.exported) {
    const row = exp.name.length;
    const name = nameOf(named.name);
    nameExp[name]?.push(row);
    exp.name.push(name);
    exp.at.push(strings.id(named.at));
    exp.by.push(strings.id(named.by));
    exp.line.push(named.line);
    exp.kind.push(USE_KINDS.indexOf(named.kind));
  }

  names.values.forEach((name, id) => {
    for (const term of new Set(termsOf(name))) post(term).names.push(id);
  });
  // Byte order, so a prefix is one range the reader finds without decoding.
  const terms = [...byTerm.keys()]
    .map((term) => [term, Buffer.from(term, 'utf8')] as const)
    .sort(([, a], [, b]) => Buffer.compare(a, b))
    .map(([term]) => term);

  // Every file a row names, by its UTF-8 bytes, so an area's paths become ids
  // by binary search and a row is admitted by comparing integers.
  const files = [...new Set([...pub.at, ...sitesAt, ...exp.at])]
    .map((id) => [id, Buffer.from(strings.values[id] ?? '', 'utf8')] as const)
    .sort(([, a], [, b]) => Buffer.compare(a, b))
    .map(([id]) => id);
  const pooled = joined(strings.values, '');
  const lowerNames = joined(names.values.map((name) => name.toLowerCase()), '\0');
  const lowerDocs = joined(docLower, '\0');
  const termText = joined(terms, '');
  const namePostings = postings(namePub);
  const expPostings = postings(nameExp);
  const termNames = postings(terms.map((term) => byTerm.get(term)?.names ?? []));
  const termPub = postings(terms.map((term) => byTerm.get(term)?.pub ?? []));

  const sections: Record<SectionName, Uint8Array | Uint32Array> = {
    'strings.off': pooled.off, 'strings.blob': pooled.blob, 'files': u32s(files),
    'names.name': u32s(nameString),
    'names.rank': ranks(names.values),
    'names.lowerOff': lowerNames.off, 'names.lower': lowerNames.blob,
    'names.pubOff': namePostings.off, 'names.pub': namePostings.rows,
    'names.expOff': expPostings.off, 'names.exp': expPostings.rows,
    'pub.name': u32s(pub.name), 'pub.spec': u32s(pub.spec), 'pub.kind': u32s(pub.kind), 'pub.doc': u32s(pub.doc),
    'pub.at': u32s(pub.at), 'pub.usedBy': u32s(pub.usedBy), 'pub.uses': u32s(pub.uses),
    'pub.sitesOff': u32s(sitesOff), 'sites.at': u32s(sitesAt),
    'pub.docLowerOff': lowerDocs.off, 'pub.docLower': lowerDocs.blob,
    'exp.name': u32s(exp.name), 'exp.at': u32s(exp.at), 'exp.by': u32s(exp.by), 'exp.line': u32s(exp.line),
    'exp.kind': Uint8Array.from(exp.kind),
    'terms.off': termText.off, 'terms.blob': termText.blob,
    'terms.nameOff': termNames.off, 'terms.name': termNames.rows,
    'terms.pubOff': termPub.off, 'terms.pub': termPub.rows,
  };

  // Offsets count from where the sections start, so the header's own length
  // never feeds back into what it says.
  const table: Record<string, readonly [number, number]> = {};
  let size = 0;
  for (const name of SECTIONS) {
    table[name] = [size, sections[name].byteLength];
    size = align(size + sections[name].byteLength);
  }
  const head = Buffer.from(JSON.stringify({ generation: generation ?? null, sections: table }), 'utf8');
  const start = align(12 + head.length);

  const out = new Uint8Array(start + size);
  const view = new DataView(out.buffer);
  view.setUint32(0, MAGIC, true);
  view.setUint32(4, VERSION, true);
  view.setUint32(8, head.length, true);
  out.set(head, 12);
  for (const name of SECTIONS) {
    const section = sections[name];
    out.set(new Uint8Array(section.buffer, section.byteOffset, section.byteLength), start + (table[name]?.[0] ?? 0));
  }
  return out;
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
