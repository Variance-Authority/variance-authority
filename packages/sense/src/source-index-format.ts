import type { Digest, FileRecord } from '@variance-authority/core';
import type { Parsed } from './cache.js';
import type { Export } from './read.js';

const VERSION = 1;
const ALIGNMENT = 8;
const NONE = 0xffff_ffff;

interface Section {
  readonly name: string;
  readonly offset: number;
  readonly length: number;
  readonly width: 1 | 4;
}

interface Header {
  readonly format: 'variance-authority-source-index';
  readonly version: number;
  readonly sections: readonly Section[];
}

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

  const stringBytes = strings.map((value) => Buffer.from(value, 'utf8'));
  const stringBlob = Buffer.concat(stringBytes);
  const stringOff = offsets(stringBytes.map((value) => value.length));

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

  return sections({
    'strings.blob': stringBlob,
    'strings.off': bytes(stringOff),
    'index.layout': bytes(Uint32Array.of(optionalId(stored.layout, id))),
    'parses.digest': bytes(parseDigest),
    'parses.deleted': bytes(Uint32Array.from(
      [...stored.deletedParses ?? []].sort(order), (digest) => id(digest))),
    'parses.requests': bytes(parseRequests),
    'parses.exports': bytes(parseExports),
    'parses.exports-present': bytes(parseExportPresent),
    'parses.declares': bytes(parseDeclares),
    'parses.declares-present': bytes(parseDeclarePresent),
    'parses.unknown': bytes(parseUnknown),
    'requests.value': bytes(Uint32Array.from(requestValue)),
    'requests.kind': bytes(Uint32Array.from(requestKind)),
    'requests.bindings': bytes(Uint32Array.from(requestBindings)),
    'bindings.imported': bytes(Uint32Array.from(bindingImported)),
    'bindings.local': bytes(Uint32Array.from(bindingLocal)),
    'bindings.type': bytes(Uint8Array.from(bindingType)),
    'exports.exported': bytes(Uint32Array.from(exportExported)),
    'exports.local': bytes(Uint32Array.from(exportLocal)),
    'exports.from': bytes(Uint32Array.from(exportFrom)),
    'exports.imported': bytes(Uint32Array.from(exportImported)),
    'exports.type': bytes(Uint8Array.from(exportType)),
    'declares.name': bytes(Uint32Array.from(declareName)),
    'records.file': bytes(recordFile),
    'records.deleted': bytes(Uint32Array.from(
      [...stored.deletedRecords ?? []].sort(order), (file) => id(file))),
    'records.digest': bytes(recordDigest),
    'records.edges': bytes(recordEdges),
    'records.edges-present': bytes(recordEdgePresent),
    'records.declares': bytes(recordDeclares),
    'records.declares-present': bytes(recordDeclarePresent),
    'records.unresolved': bytes(recordUnresolved),
    'records.unresolved-present': bytes(recordUnresolvedPresent),
    'records.unknown': bytes(recordUnknown),
    'edges.to': bytes(Uint32Array.from(edgeTo)),
    'edges.kind': bytes(Uint32Array.from(edgeKind)),
    'record-declares.name': bytes(Uint32Array.from(recordDeclareName)),
    'unresolved.value': bytes(Uint32Array.from(unresolvedValue)),
  });
}

/** Decode a complete generation. Any malformed reference rejects the whole file. */
export function decodeSourceIndex(input: Uint8Array): StoredSourceIndex {
  const opened = openSections(input);
  const strings = stringReader(opened.u8('strings.blob'), opened.u32('strings.off'));
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

function sections(input: Readonly<Record<string, Buffer>>): Buffer {
  const chunks: Buffer[] = [];
  const index: Section[] = [];
  let offset = 0;
  for (const [name, value] of Object.entries(input)) {
    const width = name.endsWith('.blob') || name.endsWith('.type') || name.endsWith('-present') ? 1 : 4;
    index.push({ name, offset, length: value.length, width });
    chunks.push(value);
    offset += value.length;
    const padding = aligned(offset) - offset;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
    offset += padding;
  }
  const header: Header = { format: 'variance-authority-source-index', version: VERSION, sections: index };
  const encoded = Buffer.from(JSON.stringify(header), 'utf8');
  const headerLength = aligned(4 + encoded.length) - 4;
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32LE(headerLength);
  return Buffer.concat([prefix, encoded, Buffer.alloc(headerLength - encoded.length), ...chunks]);
}

function openSections(input: Uint8Array): {
  u8(name: string): Uint8Array;
  u32(name: string): Uint32Array;
  maybeU32(name: string): Uint32Array;
} {
  const raw = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (raw.length < 4) throw invalid();
  const headerLength = raw.readUInt32LE(0);
  if (headerLength > raw.length - 4) throw invalid();
  let header: Header;
  try {
    header = JSON.parse(raw.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as Header;
  } catch { throw invalid(); }
  if (header.format !== 'variance-authority-source-index' || header.version !== VERSION ||
      !validSections(header.sections, raw.length - 4 - headerLength)) throw invalid();
  const base = 4 + headerLength;
  const found = new Map(header.sections.map((section) => [section.name, section]));
  const section = (name: string, width: 1 | 4): Section => {
    const value = found.get(name);
    if (value === undefined || value.width !== width) throw invalid();
    return value;
  };
  return {
    u8(name) {
      const value = section(name, 1);
      return new Uint8Array(raw.buffer, raw.byteOffset + base + value.offset, value.length);
    },
    u32(name) {
      const value = section(name, 4);
      if (value.length % 4 !== 0) throw invalid();
      return new Uint32Array(raw.buffer, raw.byteOffset + base + value.offset, value.length / 4);
    },
    maybeU32(name) {
      const value = found.get(name);
      if (value === undefined) return new Uint32Array();
      if (value.width !== 4 || value.length % 4 !== 0) throw invalid();
      return new Uint32Array(raw.buffer, raw.byteOffset + base + value.offset, value.length / 4);
    },
  };
}

function stringReader(blob: Uint8Array, off: Uint32Array): (id: number) => string {
  validateOffset(off, blob.length);
  const decoder = new TextDecoder();
  return (id) => {
    const start = off[id]; const end = off[id + 1];
    if (start === undefined || end === undefined) throw invalid();
    return decoder.decode(blob.subarray(start, end));
  };
}

function validateOffset(column: Uint32Array, end: number, rows = column.length - 1): void {
  if (column.length !== rows + 1 || column[0] !== 0 || column[column.length - 1] !== end) throw invalid();
  for (let index = 1; index < column.length; index += 1) if (column[index]! < column[index - 1]!) throw invalid();
}

function sameLength(length: number, columns: readonly { readonly length: number }[]): void {
  if (columns.some((column) => column.length !== length)) throw invalid();
}

function range(offsets: Uint32Array, row: number): number[] {
  const start = offsets[row]; const end = offsets[row + 1];
  if (start === undefined || end === undefined) throw invalid();
  return Array.from({ length: end - start }, (_, index) => start + index);
}

function validSections(sections: readonly Section[], available: number): boolean {
  if (!Array.isArray(sections) || sections.length === 0) return false;
  if (new Set(sections.map((section) => section.name)).size !== sections.length) return false;
  const ordered = [...sections].sort((left, right) => left.offset - right.offset);
  let end = 0;
  for (const section of ordered) {
    if (typeof section.name !== 'string' || !Number.isSafeInteger(section.offset) ||
        !Number.isSafeInteger(section.length) || section.offset < end ||
        section.offset % ALIGNMENT !== 0 || section.length < 0 ||
        section.length > available - section.offset ||
        (section.width !== 1 && section.width !== 4)) return false;
    end = section.offset + section.length;
  }
  return ordered[0]?.offset === 0;
}

function offsets(lengths: readonly number[]): Uint32Array {
  const result = new Uint32Array(lengths.length + 1);
  for (let index = 0; index < lengths.length; index += 1) result[index + 1] = result[index]! + lengths[index]!;
  return result;
}

function optionalId(value: string | undefined, id: (value: string) => number): number {
  return value === undefined ? NONE : id(value);
}

function flag(value: number | undefined): boolean {
  if (value !== 0 && value !== 1) throw invalid();
  return value === 1;
}

function bytes(array: Uint8Array | Uint32Array): Buffer {
  return Buffer.from(array.buffer, array.byteOffset, array.byteLength);
}

function aligned(value: number): number { return Math.ceil(value / ALIGNMENT) * ALIGNMENT; }
function order(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function invalid(): Error { return new Error('not a variance-authority source index'); }
