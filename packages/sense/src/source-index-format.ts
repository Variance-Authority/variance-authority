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
import type { Parsed } from './cache.js';
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
const VERSION = 1;
const WHAT = 'source index';

export interface StoredSourceIndex {
  readonly parses: ReadonlyMap<Digest, Parsed>;
  readonly deletedParses?: ReadonlySet<Digest>;
  readonly layout?: Digest;
  readonly records: ReadonlyMap<string, FileRecord>;
  readonly deletedRecords?: ReadonlySet<string>;
}

/** Encode source facts once: interned strings, dense columns, and offset lists. */
export function encodeSourceIndex(stored: StoredSourceIndex): Buffer {
  const parses = [...stored.parses].sort(([left], [right]) => order(left, right));
  const records = [...stored.records].sort(([left], [right]) => order(left, right));
  const strings = dictionary(stored, parses, records);
  const ids = new Map(strings.map((value, index) => [value, index]));
  const id = (value: string): number => ids.get(value)!;

  const { blob: stringBlob, off: stringOff } = stringColumns(strings);

  const parseDigest = new Uint32Array(parses.length);
  const parseRequests = new Uint32Array(parses.length + 1);
  const parseExports = new Uint32Array(parses.length + 1);
  const parseExportPresent = new Uint8Array(parses.length);
  const parseDeclares = new Uint32Array(parses.length + 1);
  const parseDeclarePresent = new Uint8Array(parses.length);
  const parseUnknown = new Uint32Array(parses.length).fill(NONE);
  const requestValue: number[] = [];
  const requestKind: number[] = [];
  const requestBindings: number[] = [0];
  const bindingImported: number[] = [];
  const bindingLocal: number[] = [];
  const bindingType: number[] = [];
  const exportExported: number[] = [];
  const exportLocal: number[] = [];
  const exportFrom: number[] = [];
  const exportImported: number[] = [];
  const exportType: number[] = [];
  const declareName: number[] = [];

  for (const [index, [digest, parsed]] of parses.entries()) {
    parseDigest[index] = id(digest);
    parseRequests[index] = requestValue.length;
    for (const request of parsed.requests) {
      requestValue.push(id(request.value));
      requestKind.push(id(request.kind));
      for (const binding of request.bindings) {
        bindingImported.push(id(binding.imported));
        bindingLocal.push(id(binding.local));
        bindingType.push(binding.type ? 1 : 0);
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
  const edgeTo: number[] = [];
  const edgeKind: number[] = [];
  const recordDeclareName: number[] = [];
  const unresolvedValue: number[] = [];

  for (const [index, [file, record]] of records.entries()) {
    recordFile[index] = id(file);
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
  recordEdges[records.length] = edgeTo.length;
  recordDeclares[records.length] = recordDeclareName.length;
  recordUnresolved[records.length] = unresolvedValue.length;

  return bytes(encodeSegment(FORMAT, VERSION, {
    'strings.blob': stringBlob,
    'strings.off': stringOff,
    'index.layout': Uint32Array.of(optionalId(stored.layout, id)),
    'parses.digest': parseDigest,
    'parses.deleted': Uint32Array.from(
      [...stored.deletedParses ?? []].sort(order), (digest) => id(digest)),
    'parses.requests': parseRequests,
    'parses.exports': parseExports,
    'parses.exports-present': parseExportPresent,
    'parses.declares': parseDeclares,
    'parses.declares-present': parseDeclarePresent,
    'parses.unknown': parseUnknown,
    'requests.value': Uint32Array.from(requestValue),
    'requests.kind': Uint32Array.from(requestKind),
    'requests.bindings': Uint32Array.from(requestBindings),
    'bindings.imported': Uint32Array.from(bindingImported),
    'bindings.local': Uint32Array.from(bindingLocal),
    'bindings.type': Uint8Array.from(bindingType),
    'exports.exported': Uint32Array.from(exportExported),
    'exports.local': Uint32Array.from(exportLocal),
    'exports.from': Uint32Array.from(exportFrom),
    'exports.imported': Uint32Array.from(exportImported),
    'exports.type': Uint8Array.from(exportType),
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

  const parseDigest = opened.u32('parses.digest');
  const deletedParseIds = opened.maybeU32('parses.deleted');
  const parseRequests = opened.u32('parses.requests');
  const parseExports = opened.u32('parses.exports');
  const parseExportPresent = opened.u8('parses.exports-present');
  const parseDeclares = opened.u32('parses.declares');
  const parseDeclarePresent = opened.u8('parses.declares-present');
  const parseUnknown = opened.u32('parses.unknown');
  const requestValue = opened.u32('requests.value');
  const requestKind = opened.u32('requests.kind');
  const requestBindings = opened.u32('requests.bindings');
  const bindingImported = opened.u32('bindings.imported');
  const bindingLocal = opened.u32('bindings.local');
  const bindingType = opened.u8('bindings.type');
  const exportExported = opened.u32('exports.exported');
  const exportLocal = opened.u32('exports.local');
  const exportFrom = opened.u32('exports.from');
  const exportImported = opened.u32('exports.imported');
  const exportType = opened.u8('exports.type');
  const declareName = opened.u32('declares.name');
  validateOffset(parseRequests, requestValue.length, parseDigest.length);
  validateOffset(parseExports, exportExported.length, parseDigest.length);
  validateOffset(parseDeclares, declareName.length, parseDigest.length);
  sameLength(parseDigest.length, [parseExportPresent, parseDeclarePresent, parseUnknown]);
  sameLength(requestValue.length, [requestKind]);
  validateOffset(requestBindings, bindingImported.length, requestValue.length);
  sameLength(bindingImported.length, [bindingLocal, bindingType]);
  sameLength(exportExported.length, [exportLocal, exportFrom, exportImported, exportType]);

  const parses = new Map<Digest, Parsed>();
  for (let row = 0; row < parseDigest.length; row += 1) {
    const requests = range(parseRequests, row).map((request) => ({
      value: text(requestValue[request]!),
      kind: text(requestKind[request]!) as Parsed['requests'][number]['kind'],
      bindings: range(requestBindings, request).map((binding) => ({
        imported: text(bindingImported[binding]!),
        local: text(bindingLocal[binding]!),
        type: flag(bindingType[binding]),
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
      };
    });
    const declares = range(parseDeclares, row).map((entry) => text(declareName[entry]!));
    const unknown = optional(parseUnknown[row]!);
    const digest = text(parseDigest[row]!) as Digest;
    if (parses.has(digest)) throw invalid();
    parses.set(digest, {
      requests,
      ...(flag(parseExportPresent[row]) ? { exports: published } : {}),
      ...(flag(parseDeclarePresent[row]) ? { declares } : {}),
      ...(unknown === undefined ? {} : { unknown }),
    });
  }
  const deletedParses = new Set<Digest>();
  for (const value of deletedParseIds) {
    const digest = text(value) as Digest;
    if (parses.has(digest) || deletedParses.has(digest)) throw invalid();
    deletedParses.add(digest);
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
  const edgeTo = opened.u32('edges.to');
  const edgeKind = opened.u32('edges.kind');
  const recordDeclareName = opened.u32('record-declares.name');
  const unresolvedValue = opened.u32('unresolved.value');
  validateOffset(recordEdges, edgeTo.length, recordFile.length);
  validateOffset(recordDeclares, recordDeclareName.length, recordFile.length);
  validateOffset(recordUnresolved, unresolvedValue.length, recordFile.length);
  sameLength(recordFile.length, [recordDigest, recordEdgePresent, recordDeclarePresent,
    recordUnresolvedPresent, recordUnknown]);
  sameLength(edgeTo.length, [edgeKind]);

  const records = new Map<string, FileRecord>();
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
    if (records.has(file)) throw invalid();
    records.set(file, {
      file,
      ...(digest === undefined ? {} : { digest }),
      ...(flag(recordEdgePresent[row]) ? { edges } : {}),
      ...(flag(recordDeclarePresent[row]) ? { declares } : {}),
      ...(flag(recordUnresolvedPresent[row]) ? { unresolved } : {}),
      ...(unknown === undefined ? {} : { unknown }),
    });
  }
  const deletedRecords = new Set<string>();
  for (const value of deletedRecordIds) {
    const file = text(value);
    if (records.has(file) || deletedRecords.has(file)) throw invalid();
    deletedRecords.add(file);
  }
  const layout = optional(opened.u32('index.layout')[0]!);
  return {
    parses,
    ...(deletedParses.size === 0 ? {} : { deletedParses }),
    ...(layout === undefined ? {} : { layout: layout as Digest }),
    records,
    ...(deletedRecords.size === 0 ? {} : { deletedRecords }),
  };
}

function dictionary(
  stored: StoredSourceIndex,
  parses: readonly (readonly [Digest, Parsed])[],
  records: readonly (readonly [string, FileRecord])[],
): readonly string[] {
  const values = new Set<string>();
  if (stored.layout !== undefined) values.add(stored.layout);
  for (const digest of stored.deletedParses ?? []) values.add(digest);
  for (const file of stored.deletedRecords ?? []) values.add(file);
  for (const [digest, parsed] of parses) {
    values.add(digest);
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
  for (const [file, record] of records) {
    values.add(file);
    for (const value of [record.digest, record.unknown]) if (value !== undefined) values.add(value);
    for (const edge of record.edges ?? []) { values.add(edge.to); values.add(edge.kind); }
    for (const value of record.declares ?? []) values.add(value);
    for (const value of record.unresolved ?? []) values.add(value);
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
