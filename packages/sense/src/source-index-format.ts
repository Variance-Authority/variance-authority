import {
  flagOf,
  NONE,
  openSegment,
  rangeOf,
  sameLength as sameLengthOf,
  stringReader as openStrings,
  validateOffsets,
} from '@variance-authority/core/segment';
import type { Digest } from '@variance-authority/core/format';
import type { FileRecord } from '@variance-authority/core/relate';
import type { Parsed, ParseKey } from './cache.js';
import type { DeclaredRole, Export } from './read.js';
import { native, nativeRefusal } from './addon.js';
import type { NativeScanner } from './native.js';
import { openHarvest } from './source-index-harvest.js';
import { openMembers } from './source-index-members.js';
import { openMocks } from './source-index-mocks.js';
import { openSize } from './source-index-size.js';
import { packageOf } from './specifier.js';

/**
 * One durable generation of source facts, as bytes, and its reader.
 *
 * The writer is the addon's (`native/src/generation.rs`); this file hands it
 * documents and reads back what it wrote. The segment arithmetic is not here
 * either: [`core/segment`](../../core/src/segment/index.ts) owns sections,
 * alignment and the checks a decode runs before it believes a file.
 *
 * What stays is the part that is about *source*: which columns exist, which of
 * them is a list, and the two absences this format has to keep apart — a parse
 * that recorded no exports against one that was never asked for them.
 */
const FORMAT = 'variance-authority-source-index';
const VERSION = 17;
const WHAT = 'source index';
/** Rows per document: a few megabytes of JSON, far under any string limit. */
const ROWS = 4096;

/** A record, and the directories whose contents could still change its edges. */
export interface IndexedRecord {
  readonly record: FileRecord;
  /** Repo-relative directories, sorted ([`witness.ts`](./witness.ts)). */
  readonly witnesses: readonly string[];
  /** Resolved target for each request in the matching parse, preserving order. */
  readonly targets?: readonly (string | undefined)[];
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

/**
 * One generation as bytes, written by the addon (`encode_source_index` in
 * `native/src/graph_index.rs`) from {@link sourceIndexDocuments}. It is the only
 * encoder: a cold build's closure is encoded on that side, and a warm save's
 * delta crosses to it rather than keep a second copy of the layout here.
 */
export function encodeSourceIndex(stored: StoredSourceIndex): Buffer {
  return encoder().encodeSourceIndex(sourceIndexDocuments(stored));
}

function encoder(): NativeScanner {
  const addon = native();
  if (addon === undefined) {
    throw new Error(`the ${WHAT} is encoded by the native addon, which did not load: ${nativeRefusal()}`);
  }
  return addon;
}

/**
 * `stored` as the JSON documents the addon reads it from (`Delta` in
 * `native/src/generation.rs`): what it deletes and its configuration first,
 * then its rows, at most {@link ROWS} to a document.
 *
 * Several and not one, because one is a string the size of the whole index,
 * and V8 refuses a string past half a gigabyte: the records and parses of a
 * hundred thousand files were 290 MB of it already. An absent target crosses
 * as `null`, which the addon reads as absent.
 */
export function sourceIndexDocuments(stored: StoredSourceIndex): string[] {
  const documents = [JSON.stringify({
    ...(stored.config === undefined ? {} : { config: stored.config }),
    deletedParses: [...stored.deletedParses ?? []],
    deletedRecords: [...stored.deletedRecords ?? []],
    deletedDirectories: [...stored.deletedDirectories ?? []],
  })];
  const rows = (name: string, entries: Iterable<readonly [string, unknown]>): void => {
    let batch: (readonly [string, unknown])[] = [];
    for (const entry of entries) {
      batch.push(entry);
      if (batch.length < ROWS) continue;
      documents.push(JSON.stringify({ [name]: batch }));
      batch = [];
    }
    if (batch.length > 0) documents.push(JSON.stringify({ [name]: batch }));
  };
  rows('directories', stored.directories);
  rows('records', stored.records);
  rows('parses', stored.parses);
  return documents;
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
  const parseHarvested = opened.u8('parses.harvested');
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
  const exportTags = opened.u8('exports.tags');
  const declareName = opened.u32('declares.name');
  const harvest = openHarvest(opened, text, parseKey.length, exportExported.length);
  const mocksOf = openMocks(opened, text, parseKey.length);
  const membersOf = openMembers(opened, text, parseKey.length);
  const sizeOf = openSize(opened, parseKey.length);
  validateOffset(parseRequests, requestValue.length, parseKey.length);
  validateOffset(parseExports, exportExported.length, parseKey.length);
  validateOffset(parseDeclares, declareName.length, parseKey.length);
  sameLength(parseKey.length, [parseExportPresent, parseDeclarePresent, parseUnknown, parseHarvested, parseWay]);
  if (deletedParseIds.length !== deletedParseWays.length) throw invalid();
  sameLength(requestValue.length, [requestKind, requestLine]);
  validateOffset(requestBindings, bindingImported.length, requestValue.length);
  sameLength(bindingImported.length, [bindingLocal, bindingType, bindingLine]);
  sameLength(exportExported.length, [exportLocal, exportFrom, exportImported, exportType, exportLine, exportTags]);

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
      const signature = harvest.exportSignature(entry);
      const doc = harvest.exportDoc(entry);
      const roles = declaredRoles(exportTags[entry]!);
      return {
        ...(exported === undefined ? {} : { exported }),
        ...(local === undefined ? {} : { local }),
        ...(from === undefined ? {} : { from }),
        ...(imported === undefined ? {} : { imported }),
        type: flag(exportType[entry]),
        line: exportLine[entry]!,
        ...(signature === undefined ? {} : { signature }),
        ...(doc === undefined ? {} : { doc }),
        ...(roles.length === 0 ? {} : { roles }),
      };
    });
    const symbols = harvest.symbols(row);
    const declares = range(parseDeclares, row).map((entry) => text(declareName[entry]!));
    const unknown = optional(parseUnknown[row]!);
    const mocks = mocksOf(row);
    const key = joinedKey(text(parseKey[row]!), text(parseWay[row]!));
    if (parses.has(key)) throw invalid();
    parses.set(key, {
      requests,
      ...(flag(parseExportPresent[row]) ? { exports: published } : {}),
      ...(symbols.length === 0 ? {} : { symbols }),
      ...(flag(parseHarvested[row]) ? { harvested: true } : {}),
      ...(flag(parseDeclarePresent[row]) ? { declares } : {}),
      ...(mocks === undefined ? {} : { mocks }),
      ...membersOf(row, requests.length),
      ...(unknown === undefined ? {} : { unknown }),
      ...sizeOf(row),
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
  const recordPackages = opened.u32('records.packages');
  const recordPackagePresent = opened.u8('records.packages-present');
  const recordUnresolved = opened.u32('records.unresolved');
  const recordUnresolvedPresent = opened.u8('records.unresolved-present');
  const recordUnknown = opened.u32('records.unknown');
  const recordWitnesses = opened.u32('records.witnesses');
  const recordTargets = opened.u32('records.targets');
  const recordTargetPresent = opened.u8('records.targets-present');
  const witnessDirectory = opened.u32('witnesses.directory');
  const targetPath = opened.u32('targets.path');
  const edgeTo = opened.u32('edges.to');
  const edgeKind = opened.u32('edges.kind');
  const recordDeclareName = opened.u32('record-declares.name');
  const unresolvedValue = opened.u32('unresolved.value');
  const packageTo = opened.u32('packages.to');
  const packageKind = opened.u32('packages.kind');
  validateOffset(recordEdges, edgeTo.length, recordFile.length);
  validateOffset(recordDeclares, recordDeclareName.length, recordFile.length);
  validateOffset(recordUnresolved, unresolvedValue.length, recordFile.length);
  validateOffset(recordPackages, packageTo.length, recordFile.length);
  validateOffset(recordWitnesses, witnessDirectory.length, recordFile.length);
  validateOffset(recordTargets, targetPath.length, recordFile.length);
  sameLength(recordFile.length, [recordDigest, recordEdgePresent, recordDeclarePresent,
    recordPackagePresent, recordUnresolvedPresent, recordUnknown, recordTargetPresent]);
  sameLength(edgeTo.length, [edgeKind]);
  sameLength(packageTo.length, [packageKind]);

  const records = new Map<string, IndexedRecord>();
  for (let row = 0; row < recordFile.length; row += 1) {
    const file = text(recordFile[row]!);
    const digest = optional(recordDigest[row]!) as Digest | undefined;
    const edges = range(recordEdges, row).map((edge) => ({
      to: text(edgeTo[edge]!),
      kind: text(edgeKind[edge]!) as NonNullable<FileRecord['edges']>[number]['kind'],
    }));
    const declares = range(recordDeclares, row).map((entry) => text(recordDeclareName[entry]!));
    const packages = range(recordPackages, row).map((edge) => ({
      to: packageName(text(packageTo[edge]!)),
      kind: text(packageKind[edge]!) as NonNullable<FileRecord['edges']>[number]['kind'],
    }));
    const unresolved = range(recordUnresolved, row).map((entry) => text(unresolvedValue[entry]!));
    const unknown = optional(recordUnknown[row]!);
    const witnesses = range(recordWitnesses, row).map((entry) => text(witnessDirectory[entry]!));
    const targets = range(recordTargets, row).map((entry) => optional(targetPath[entry]!));
    if (records.has(file)) throw invalid();
    records.set(file, {
      record: {
        file,
        ...(digest === undefined ? {} : { digest }),
        ...(flag(recordEdgePresent[row]) ? { edges } : {}),
        ...(flag(recordDeclarePresent[row]) ? { declares } : {}),
        ...(flag(recordPackagePresent[row]) ? { packages } : {}),
        ...(flag(recordUnresolvedPresent[row]) ? { unresolved } : {}),
        ...(unknown === undefined ? {} : { unknown }),
      },
      witnesses,
      ...(flag(recordTargetPresent[row]) ? { targets } : {}),
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

function validateOffset(column: Uint32Array, end: number, rows = column.length - 1): void {
  validateOffsets(column, end, rows, invalid);
}

function sameLength(length: number, columns: readonly { readonly length: number }[]): void {
  sameLengthOf(length, columns, invalid);
}

function range(offsets: Uint32Array, row: number): number[] {
  return rangeOf(offsets, row, invalid);
}

/** A stored package name is one `packageOf` produces; anything else is a column read through the wrong dictionary. */
function packageName(name: string): string {
  if (packageOf(name) !== name) throw invalid();
  return name;
}

/** The roles a stored bitset names, in bit order: `native/src/declared_role.rs`. */
function declaredRoles(tags: number): DeclaredRole[] {
  const roles: DeclaredRole[] = [];
  if ((tags & 1) !== 0) roles.push('testOnly');
  if ((tags & 2) !== 0) roles.push('production');
  return roles;
}

function flag(value: number | undefined): boolean {
  return flagOf(value, invalid);
}

/** A parse key from its content digest and the way it was read; the default way adds nothing. */
function joinedKey(digest: string, way: string): ParseKey {
  return way === '' ? digest : `${digest}\u0000${way}`;
}

function invalid(): Error { return new Error(`not a variance-authority ${WHAT}`); }
