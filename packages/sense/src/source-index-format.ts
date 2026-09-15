import {
  codeUnitOrder as order,
  encodeSegment,
  flagOf,
  NONE,
  openSegment,
  rangeOf,
  sameLength as sameLengthOf,
  stringColumns,
  stringReader as openStrings,
  validateOffsets,
  type Column,
} from '@variance-authority/core/segment';
import type { Digest } from '@variance-authority/core/format';
import type { FileRecord } from '@variance-authority/core/relate';
import type { Parsed, ParseKey } from './cache.js';
import type { Export } from './read.js';

/**
 * One durable generation of source facts, as bytes.
 *
 * The schema is here and the arithmetic is not:
 * [`core/segment`](../../core/src/segment/index.ts) owns sections, alignment,
 * interning and the checks a decode runs before it believes a file, because the
 * suite index needed the same four hundred lines and two copies of offset
 * validation is one copy that eventually stops matching.
 *
 * What stays is the part that is about *source*: which columns exist, which of
 * them is a list, and the two absences this format has to keep apart — a parse
 * that recorded no exports against one that was never asked for them.
 */
const FORMAT = 'variance-authority-source-index';
const VERSION = 5;
const WHAT = 'source index';

/** A record, and the directories whose contents could still change its edges. */
export interface IndexedRecord {
  readonly record: FileRecord;
  /** Repo-relative directories, sorted ([`witness.ts`](./witness.ts)). */
  readonly witnesses: readonly string[];
}

export interface StoredSourceIndex {
  readonly parses: ReadonlyMap<ParseKey, Parsed>;
  readonly deletedParses?: ReadonlySet<ParseKey>;
  /** How resolution was configured when these records were built. */
  readonly config?: Digest;
  /** Every directory the tree held, named by the entries it held. */
  readonly directories: ReadonlyMap<string, Digest>;
  readonly deletedDirectories?: ReadonlySet<string>;
  readonly records: ReadonlyMap<string, IndexedRecord>;
  readonly deletedRecords?: ReadonlySet<string>;
}

/** Encode source facts once: interned strings, dense columns, and offset lists. */
export function encodeSourceIndex(stored: StoredSourceIndex): Buffer {
  const parses = [...stored.parses].sort(([left], [right]) => order(left, right));
  const records = [...stored.records].sort(([left], [right]) => order(left, right));
  const directories = [...stored.directories].sort(([left], [right]) => order(left, right));
  const strings = dictionary(stored, parses, records);
  const ids = new Map(strings.map((value, index) => [value, index]));
  const id = (value: string): number => ids.get(value)!;

  const { blob: stringBlob, off: stringOff } = stringColumns(strings);

  const parseDigest = new Uint32Array(parses.length);
  const parseWay = new Uint32Array(parses.length);
  const parseRequests = new Uint32Array(parses.length + 1);
  const parseExports = new Uint32Array(parses.length + 1);
  const parseExportPresent = new Uint8Array(parses.length);
  const parseDeclares = new Uint32Array(parses.length + 1);
  const parseDeclarePresent = new Uint8Array(parses.length);
  const parseUnknown = new Uint32Array(parses.length).fill(NONE);
  const requestValue: number[] = [];
  const requestKind: number[] = [];
  const requestLine: number[] = [];
  const requestBindings: number[] = [0];
  const bindingImported: number[] = [];
  const bindingLocal: number[] = [];
  const bindingType: number[] = [];
  const bindingLine: number[] = [];
  const exportExported: number[] = [];
  const exportLocal: number[] = [];
  const exportFrom: number[] = [];
  const exportImported: number[] = [];
  const exportType: number[] = [];
  const exportLine: number[] = [];
  const declareName: number[] = [];

  for (const [index, [key, parsed]] of parses.entries()) {
    const [digest, way] = partsOf(key);
    parseDigest[index] = id(digest);
    parseWay[index] = id(way);
    parseRequests[index] = requestValue.length;
    for (const request of parsed.requests) {
      requestValue.push(id(request.value));
      requestKind.push(id(request.kind));
      // A line is a small integer, not a string: interning it would put every
      // distinct line number a repository ever wrote into the dictionary.
      requestLine.push(request.line);
      for (const binding of request.bindings) {
        bindingImported.push(id(binding.imported));
        bindingLocal.push(id(binding.local));
        bindingType.push(binding.type ? 1 : 0);
        bindingLine.push(binding.line);
      }
      requestBindings.push(bindingImported.length);
    }
    parseExports[index] = exportExported.length;
    parseExportPresent[index] = parsed.exports === undefined ? 0 : 1;
    for (const published of parsed.exports ?? []) {
      exportExported.push(optionalId(published.exported, id));
      exportLocal.push(optionalId(published.local, id));
      exportFrom.push(optionalId(published.from, id));
      exportImported.push(optionalId(published.imported, id));
      exportLine.push(published.line);
      exportType.push(published.type ? 1 : 0);
    }
    parseDeclares[index] = declareName.length;
    parseDeclarePresent[index] = parsed.declares === undefined ? 0 : 1;
    for (const name of parsed.declares ?? []) declareName.push(id(name));
    parseUnknown[index] = optionalId(parsed.unknown, id);
  }
  parseRequests[parses.length] = requestValue.length;
  parseExports[parses.length] = exportExported.length;
  parseDeclares[parses.length] = declareName.length;

  const recordFile = new Uint32Array(records.length);
  const recordDigest = new Uint32Array(records.length).fill(NONE);
  const recordEdges = new Uint32Array(records.length + 1);
  const recordEdgePresent = new Uint8Array(records.length);
  const recordDeclares = new Uint32Array(records.length + 1);
  const recordDeclarePresent = new Uint8Array(records.length);
  const recordUnresolved = new Uint32Array(records.length + 1);
  const recordUnresolvedPresent = new Uint8Array(records.length);
  const recordUnknown = new Uint32Array(records.length).fill(NONE);
  const recordWitnesses = new Uint32Array(records.length + 1);
  const witnessDirectory: number[] = [];
  const edgeTo: number[] = [];
  const edgeKind: number[] = [];
  const recordDeclareName: number[] = [];
  const unresolvedValue: number[] = [];

  for (const [index, [file, held]] of records.entries()) {
    const record = held.record;
    recordFile[index] = id(file);
    recordWitnesses[index] = witnessDirectory.length;
    for (const directory of held.witnesses) witnessDirectory.push(id(directory));
    recordDigest[index] = optionalId(record.digest, id);
    recordEdges[index] = edgeTo.length;
    recordEdgePresent[index] = record.edges === undefined ? 0 : 1;
    for (const edge of record.edges ?? []) {
      edgeTo.push(id(edge.to));
      edgeKind.push(id(edge.kind));
    }
    recordDeclares[index] = recordDeclareName.length;
    recordDeclarePresent[index] = record.declares === undefined ? 0 : 1;
    for (const name of record.declares ?? []) recordDeclareName.push(id(name));
    recordUnresolved[index] = unresolvedValue.length;
    recordUnresolvedPresent[index] = record.unresolved === undefined ? 0 : 1;
    for (const value of record.unresolved ?? []) unresolvedValue.push(id(value));
    recordUnknown[index] = optionalId(record.unknown, id);
  }
  recordWitnesses[records.length] = witnessDirectory.length;
  recordEdges[records.length] = edgeTo.length;
  recordDeclares[records.length] = recordDeclareName.length;
  recordUnresolved[records.length] = unresolvedValue.length;

  return bytes(encodeSegment(FORMAT, VERSION, {
    'strings.blob': stringBlob,
    'strings.off': stringOff,
    'index.config': Uint32Array.of(optionalId(stored.config, id)),
    'directories.path': Uint32Array.from(directories, ([path]) => id(path)),
    'directories.digest': Uint32Array.from(directories, ([, digest]) => id(digest)),
    'directories.deleted': Uint32Array.from(
      [...stored.deletedDirectories ?? []].sort(order), (path) => id(path)),
    'parses.key': parseDigest,
    'parses.key-way': parseWay,
    'parses.deleted': Uint32Array.from(
      [...stored.deletedParses ?? []].sort(order), (key) => id(partsOf(key)[0])),
    'parses.deleted-way': Uint32Array.from(
      [...stored.deletedParses ?? []].sort(order), (key) => id(partsOf(key)[1])),
    'parses.requests': parseRequests,
    'parses.exports': parseExports,
    'parses.exports-present': parseExportPresent,
    'parses.declares': parseDeclares,
    'parses.declares-present': parseDeclarePresent,
    'parses.unknown': parseUnknown,
    'requests.value': Uint32Array.from(requestValue),
    'requests.kind': Uint32Array.from(requestKind),
    'requests.line': Uint32Array.from(requestLine),
    'requests.bindings': Uint32Array.from(requestBindings),
    'bindings.imported': Uint32Array.from(bindingImported),
    'bindings.local': Uint32Array.from(bindingLocal),
    'bindings.type': Uint8Array.from(bindingType),
    'bindings.line': Uint32Array.from(bindingLine),
    'exports.exported': Uint32Array.from(exportExported),
    'exports.local': Uint32Array.from(exportLocal),
    'exports.from': Uint32Array.from(exportFrom),
    'exports.imported': Uint32Array.from(exportImported),
    'exports.type': Uint8Array.from(exportType),
    'exports.line': Uint32Array.from(exportLine),
    'declares.name': Uint32Array.from(declareName),
    'records.file': recordFile,
    'records.deleted': Uint32Array.from(
      [...stored.deletedRecords ?? []].sort(order), (file) => id(file)),
    'records.digest': recordDigest,
    'records.edges': recordEdges,
    'records.edges-present': recordEdgePresent,
    'records.declares': recordDeclares,
    'records.declares-present': recordDeclarePresent,
    'records.unresolved': recordUnresolved,
    'records.unresolved-present': recordUnresolvedPresent,
    'records.unknown': recordUnknown,
    'records.witnesses': recordWitnesses,
    'witnesses.directory': Uint32Array.from(witnessDirectory),
    'edges.to': Uint32Array.from(edgeTo),
    'edges.kind': Uint32Array.from(edgeKind),
    'record-declares.name': Uint32Array.from(recordDeclareName),
    'unresolved.value': Uint32Array.from(unresolvedValue),
  } satisfies Record<string, Column>));
}

/** Decode a complete generation. Any malformed reference rejects the whole file. */
export function decodeSourceIndex(input: Uint8Array): StoredSourceIndex {
  const opened = openSegment(FORMAT, VERSION, input, WHAT);
  const strings = openStrings(opened.u8('strings.blob'), opened.u32('strings.off'), invalid).text;
  const text = (value: number): string => {
    if (value === NONE) throw invalid();
    return strings(value);
  };
  const optional = (value: number): string | undefined => value === NONE ? undefined : text(value);

  const parseKey = opened.u32('parses.key');
  const parseWay = opened.u32('parses.key-way');
  const deletedParseIds = opened.maybeU32('parses.deleted');
  const deletedParseWays = opened.maybeU32('parses.deleted-way');
  const parseRequests = opened.u32('parses.requests');
  const parseExports = opened.u32('parses.exports');
  const parseExportPresent = opened.u8('parses.exports-present');
  const parseDeclares = opened.u32('parses.declares');
  const parseDeclarePresent = opened.u8('parses.declares-present');
  const parseUnknown = opened.u32('parses.unknown');
  const requestValue = opened.u32('requests.value');
  const requestKind = opened.u32('requests.kind');
  const requestLine = opened.u32('requests.line');
  const requestBindings = opened.u32('requests.bindings');
  const bindingImported = opened.u32('bindings.imported');
  const bindingLocal = opened.u32('bindings.local');
  const bindingType = opened.u8('bindings.type');
  const bindingLine = opened.u32('bindings.line');
  const exportExported = opened.u32('exports.exported');
  const exportLocal = opened.u32('exports.local');
  const exportFrom = opened.u32('exports.from');
  const exportImported = opened.u32('exports.imported');
  const exportType = opened.u8('exports.type');
  const exportLine = opened.u32('exports.line');
  const declareName = opened.u32('declares.name');
  validateOffset(parseRequests, requestValue.length, parseKey.length);
  validateOffset(parseExports, exportExported.length, parseKey.length);
  validateOffset(parseDeclares, declareName.length, parseKey.length);
  sameLength(parseKey.length, [parseExportPresent, parseDeclarePresent, parseUnknown]);
  sameLength(parseKey.length, [parseWay]);
  if (deletedParseIds.length !== deletedParseWays.length) throw invalid();
  sameLength(requestValue.length, [requestKind, requestLine]);
  validateOffset(requestBindings, bindingImported.length, requestValue.length);
  sameLength(bindingImported.length, [bindingLocal, bindingType, bindingLine]);
  sameLength(exportExported.length, [exportLocal, exportFrom, exportImported, exportType, exportLine]);

  const parses = new Map<ParseKey, Parsed>();
  for (let row = 0; row < parseKey.length; row += 1) {
    const requests = range(parseRequests, row).map((request) => ({
      value: text(requestValue[request]!),
      kind: text(requestKind[request]!) as Parsed['requests'][number]['kind'],
      line: requestLine[request]!,
      bindings: range(requestBindings, request).map((binding) => ({
        imported: text(bindingImported[binding]!),
        local: text(bindingLocal[binding]!),
        type: flag(bindingType[binding]),
        line: bindingLine[binding]!,
      })),
    }));
    const published = range(parseExports, row).map((entry): Export => {
      const exported = optional(exportExported[entry]!);
      const local = optional(exportLocal[entry]!);
      const from = optional(exportFrom[entry]!);
      const imported = optional(exportImported[entry]!);
      return {
        ...(exported === undefined ? {} : { exported }),
        ...(local === undefined ? {} : { local }),
        ...(from === undefined ? {} : { from }),
        ...(imported === undefined ? {} : { imported }),
        type: flag(exportType[entry]),
        line: exportLine[entry]!,
      };
    });
    const declares = range(parseDeclares, row).map((entry) => text(declareName[entry]!));
    const unknown = optional(parseUnknown[row]!);
    const key = joinedKey(text(parseKey[row]!), text(parseWay[row]!));
    if (parses.has(key)) throw invalid();
    parses.set(key, {
      requests,
      ...(flag(parseExportPresent[row]) ? { exports: published } : {}),
      ...(flag(parseDeclarePresent[row]) ? { declares } : {}),
      ...(unknown === undefined ? {} : { unknown }),
    });
  }
  const deletedParses = new Set<ParseKey>();
  for (const [at, value] of deletedParseIds.entries()) {
    const key = joinedKey(text(value), text(deletedParseWays[at]!));
    if (parses.has(key) || deletedParses.has(key)) throw invalid();
    deletedParses.add(key);
  }

  const recordFile = opened.u32('records.file');
  const deletedRecordIds = opened.maybeU32('records.deleted');
  const recordDigest = opened.u32('records.digest');
  const recordEdges = opened.u32('records.edges');
  const recordEdgePresent = opened.u8('records.edges-present');
  const recordDeclares = opened.u32('records.declares');
  const recordDeclarePresent = opened.u8('records.declares-present');
  const recordUnresolved = opened.u32('records.unresolved');
  const recordUnresolvedPresent = opened.u8('records.unresolved-present');
  const recordUnknown = opened.u32('records.unknown');
  const recordWitnesses = opened.u32('records.witnesses');
  const witnessDirectory = opened.u32('witnesses.directory');
  const edgeTo = opened.u32('edges.to');
  const edgeKind = opened.u32('edges.kind');
  const recordDeclareName = opened.u32('record-declares.name');
  const unresolvedValue = opened.u32('unresolved.value');
  validateOffset(recordEdges, edgeTo.length, recordFile.length);
  validateOffset(recordDeclares, recordDeclareName.length, recordFile.length);
  validateOffset(recordUnresolved, unresolvedValue.length, recordFile.length);
  validateOffset(recordWitnesses, witnessDirectory.length, recordFile.length);
  sameLength(recordFile.length, [recordDigest, recordEdgePresent, recordDeclarePresent,
    recordUnresolvedPresent, recordUnknown]);
  sameLength(edgeTo.length, [edgeKind]);

  const records = new Map<string, IndexedRecord>();
  for (let row = 0; row < recordFile.length; row += 1) {
    const file = text(recordFile[row]!);
    const digest = optional(recordDigest[row]!) as Digest | undefined;
    const edges = range(recordEdges, row).map((edge) => ({
      to: text(edgeTo[edge]!),
      kind: text(edgeKind[edge]!) as NonNullable<FileRecord['edges']>[number]['kind'],
    }));
    const declares = range(recordDeclares, row).map((entry) => text(recordDeclareName[entry]!));
    const unresolved = range(recordUnresolved, row).map((entry) => text(unresolvedValue[entry]!));
    const unknown = optional(recordUnknown[row]!);
    const witnesses = range(recordWitnesses, row).map((entry) => text(witnessDirectory[entry]!));
    if (records.has(file)) throw invalid();
    records.set(file, {
      record: {
        file,
        ...(digest === undefined ? {} : { digest }),
        ...(flag(recordEdgePresent[row]) ? { edges } : {}),
        ...(flag(recordDeclarePresent[row]) ? { declares } : {}),
        ...(flag(recordUnresolvedPresent[row]) ? { unresolved } : {}),
        ...(unknown === undefined ? {} : { unknown }),
      },
      witnesses,
    });
  }
  const deletedRecords = new Set<string>();
  for (const value of deletedRecordIds) {
    const file = text(value);
    if (records.has(file) || deletedRecords.has(file)) throw invalid();
    deletedRecords.add(file);
  }
  const directoryPath = opened.u32('directories.path');
  const directoryDigest = opened.u32('directories.digest');
  sameLength(directoryPath.length, [directoryDigest]);
  const directories = new Map<string, Digest>();
  for (let row = 0; row < directoryPath.length; row += 1) {
    const path = text(directoryPath[row]!);
    if (directories.has(path)) throw invalid();
    directories.set(path, text(directoryDigest[row]!) as Digest);
  }
  const deletedDirectories = new Set<string>();
  for (const value of opened.maybeU32('directories.deleted')) {
    const path = text(value);
    if (directories.has(path) || deletedDirectories.has(path)) throw invalid();
    deletedDirectories.add(path);
  }

  const config = optional(opened.u32('index.config')[0]!);
  return {
    parses,
    ...(deletedParses.size === 0 ? {} : { deletedParses }),
    ...(config === undefined ? {} : { config: config as Digest }),
    directories,
    ...(deletedDirectories.size === 0 ? {} : { deletedDirectories }),
    records,
    ...(deletedRecords.size === 0 ? {} : { deletedRecords }),
  };
}

/**
 * A parse key stored as its two parts, so the digest is the entry the record row
 * already interned.
 *
 * The key is a content digest joined to what the file's name said about reading
 * it ([`cache.ts`](./cache.ts)). Written whole it is a second dictionary string
 * for every blob, naming a digest this index already holds — 1.4 MB of a 7.7 MB
 * index on a repository of 24,909 files. Written as two columns the digest is
 * shared with the record that was read from it, and the ways are a handful of
 * distinct strings however large the repository is.
 */
function partsOf(key: ParseKey): readonly [string, string] {
  const at = key.indexOf('\u0000');
  return at === -1 ? [key, ''] : [key.slice(0, at), key.slice(at + 1)];
}

function joinedKey(digest: string, way: string): ParseKey {
  return way === '' ? digest : `${digest}\u0000${way}`;
}

function dictionary(
  stored: StoredSourceIndex,
  parses: readonly (readonly [ParseKey, Parsed])[],
  records: readonly (readonly [string, IndexedRecord])[],
): readonly string[] {
  const values = new Set<string>();
  if (stored.config !== undefined) values.add(stored.config);
  for (const key of stored.deletedParses ?? []) for (const part of partsOf(key)) values.add(part);
  for (const file of stored.deletedRecords ?? []) values.add(file);
  for (const path of stored.deletedDirectories ?? []) values.add(path);
  for (const [path, digest] of stored.directories) { values.add(path); values.add(digest); }
  for (const [key, parsed] of parses) {
    for (const part of partsOf(key)) values.add(part);
    for (const request of parsed.requests) {
      values.add(request.value); values.add(request.kind);
      for (const binding of request.bindings) { values.add(binding.imported); values.add(binding.local); }
    }
    for (const item of parsed.exports ?? []) {
      for (const value of [item.exported, item.local, item.from, item.imported]) if (value !== undefined) values.add(value);
    }
    for (const value of parsed.declares ?? []) values.add(value);
    if (parsed.unknown !== undefined) values.add(parsed.unknown);
  }
  for (const [file, held] of records) {
    const record = held.record;
    values.add(file);
    for (const value of [record.digest, record.unknown]) if (value !== undefined) values.add(value);
    for (const edge of record.edges ?? []) { values.add(edge.to); values.add(edge.kind); }
    for (const value of record.declares ?? []) values.add(value);
    for (const value of record.unresolved ?? []) values.add(value);
    for (const value of held.witnesses) values.add(value);
  }
  return [...values].sort(order);
}

function validateOffset(column: Uint32Array, end: number, rows = column.length - 1): void {
  validateOffsets(column, end, rows, invalid);
}

function sameLength(length: number, columns: readonly { readonly length: number }[]): void {
  sameLengthOf(length, columns, invalid);
}

function range(offsets: Uint32Array, row: number): number[] {
  return rangeOf(offsets, row, invalid);
}

function optionalId(value: string | undefined, id: (value: string) => number): number {
  return value === undefined ? NONE : id(value);
}

function flag(value: number | undefined): boolean {
  return flagOf(value, invalid);
}

function bytes(array: Uint8Array | Uint32Array): Buffer {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function invalid(): Error { return new Error(`not a variance-authority ${WHAT}`); }
