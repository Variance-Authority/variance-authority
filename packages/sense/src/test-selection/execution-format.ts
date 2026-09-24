import { intern } from '@variance-authority/core/segment';
import { blob, column, sections, validSections, type Header, type Section } from './format-layout.js';
import { openBlob, openBytes, openWords, resident, type Bytes } from './columns.js';
import type {
  ExecutionBlock,
  ExecutionCrossing,
  ExecutionIndex,
  ExecutionModule,
  ExecutionTest,
} from './reverse.js';
import { decodeSetExecutionIndex, stoppedColumn, stoppedFrom } from './execution-set-format.js';

/**
 * The execution index as columns, because the JSON spelling of it is the
 * largest file the recorder writes.
 *
 * An `ExecutionIndex` is the same relation the snapshot holds — regions on one
 * axis, the things that entered them on the other — asked at case granularity
 * rather than file granularity. The snapshot stores that relation as interned
 * sets and costs a few hundred bytes a module. This one stored it as JSON
 * objects, one per crossing, and measured **31 to 37 bytes per crossing** on
 * three real projects: twenty-seven megabytes beside a three-hundred-kilobyte
 * snapshot of the same run, which is ninety-four times the file it sits next
 * to. The relation is the product of two axes a suite grows independently, and
 * writing it a pair at a time in a text format prices every crossing twice —
 * once for the field names and once for the digits.
 *
 * So the pairs become columns. A crossing is three parallel rows — the case,
 * the distance, and which of the two kinds of entry it was — and a region names
 * a run of them rather than holding them. Nothing about the model changes:
 * {@link decodeExecutionIndex} returns the same object {@link encodeExecutionIndex}
 * was handed, field for field, which is what `execution-format.test.ts` asserts
 * over every shape the model distinguishes.
 *
 * ## What this is not
 *
 * It is not the snapshot's set pool. A region's crossers there are a *set* and
 * two regions crossed alike name one id; here a crossing carries a distance of
 * its own, so two regions crossed by the same cases at different depths are not
 * the same row. Pooling the triples is available and is not done yet — the
 * columns alone are the large win and they are the one that needs no decision
 * about what a distance means.
 *
 * It is not a view, either. This decodes whole, which is right for a file a
 * reader opens to answer one question about one source file and wrong for the
 * file this will become at a repository's scale. `format-view.ts` is the shape
 * to copy when that day comes; the sections are already laid out for it.
 */

/**
 * The execution file's layout version, which is its own: an execution index and
 * a snapshot share the column machinery and share nothing else, and a reader
 * that confused one for the other would decode a coherent lie.
 *
 * The rows and the set spelling number from one sequence: rows were 1, sets
 * took 2 and 3, and rows are 4 since a region carries its load-time flag
 * ({@link ExecutionBlock.loaded}). Version 1 is still read, as a file that
 * flagged nothing — which it did not, since it credited load time per crossing.
 */
export const EXECUTION_FORMAT = 4;

const UNFLAGGED_ROWS = 1;

/**
 * How a crossing says which of the two kinds of entry it was.
 *
 * `loaded` is optional in the model and its absence is not its falsehood: a
 * producer that does not distinguish evaluation from a call says nothing, and a
 * reader is told nothing rather than told no. Three states, so the round trip
 * keeps the difference.
 */
const UNSAID = 0;
const CALLED = 1;
const LOADED = 2;

/**
 * Write the index as columns: a string dictionary, parallel integer rows, and
 * a run of crossings per region rather than a list held by one.
 *
 * Deterministic for a given index, so two recordings of the same run produce
 * the same bytes.
 */
export function encodeExecutionIndex(index: ExecutionIndex): Buffer {
  const { strings, id } = intern(dictionary(index));

  const encoded = strings.map((value) => Buffer.from(value, 'utf8'));
  const stringOffsets = new Uint32Array(strings.length + 1);
  let offset = 0;
  for (const [at, bytes] of encoded.entries()) {
    stringOffsets[at] = offset;
    offset += bytes.length;
  }
  stringOffsets[strings.length] = offset;

  const blockCount = index.modules.reduce((total, module) => total + module.blocks.length, 0);
  const crossingCount = index.modules.reduce(
    (total, module) => total + module.blocks.reduce((held, block) => held + block.crossings.length, 0),
    0,
  );

  const moduleFile = new Uint32Array(index.modules.length);
  const moduleBlocks = new Uint32Array(index.modules.length + 1);
  const blockKind = new Uint32Array(blockCount);
  const blockName = new Uint32Array(blockCount);
  const blockPath = new Uint32Array(blockCount);
  const blockStart = new Uint32Array(blockCount);
  const blockEnd = new Uint32Array(blockCount);
  const blockSource = new Uint8Array(blockCount);
  const blockLoaded = new Uint8Array(blockCount);
  const blockCrossings = new Uint32Array(blockCount + 1);
  const crossingTest = new Uint32Array(crossingCount);
  const crossingDistance = new Uint32Array(crossingCount);
  const crossingLoaded = new Uint8Array(crossingCount);

  let block = 0;
  let crossing = 0;
  for (const [at, module] of index.modules.entries()) {
    moduleFile[at] = id(module.file);
    moduleBlocks[at] = block;
    for (const held of module.blocks) {
      blockKind[block] = id(held.kind);
      blockName[block] = id(held.name);
      blockPath[block] = id(held.path);
      blockStart[block] = held.startLine;
      blockEnd[block] = held.endLine;
      blockSource[block] = held.source ? 1 : 0;
      blockLoaded[block] = held.loaded === true ? 1 : 0;
      blockCrossings[block] = crossing;
      for (const entered of held.crossings) {
        crossingTest[crossing] = entered.test;
        crossingDistance[crossing] = entered.distance;
        crossingLoaded[crossing] =
          entered.loaded === undefined ? UNSAID : entered.loaded ? LOADED : CALLED;
        crossing += 1;
      }
      block += 1;
    }
  }
  moduleBlocks[index.modules.length] = block;
  blockCrossings[blockCount] = crossing;

  return sections(
    {
      'strings.blob': blob(Buffer.concat(encoded), stringOffsets),
      'strings.off': column(stringOffsets),
      'tests.id': column(Uint32Array.from(index.tests, (test) => id(test.id))),
      'tests.file': column(Uint32Array.from(index.tests, (test) => id(test.file))),
      'tests.name': column(Uint32Array.from(index.tests, (test) => id(test.name))),
      'tests.stopped': column(stoppedColumn(index.tests)),
      'modules.file': column(moduleFile),
      'modules.blocks': column(moduleBlocks),
      'blocks.kind': column(blockKind),
      'blocks.name': column(blockName),
      'blocks.path': column(blockPath),
      'blocks.start': column(blockStart),
      'blocks.end': column(blockEnd),
      'blocks.source': column(blockSource),
      'blocks.loaded': column(blockLoaded),
      'blocks.crossings': column(blockCrossings),
      'crossings.test': column(crossingTest),
      'crossings.distance': column(crossingDistance),
      'crossings.loaded': column(crossingLoaded),
    },
    EXECUTION_FORMAT,
  );
}

/** The bytes an execution index starts with, which a JSON one never does. */
export function isEncodedExecutionIndex(bytes: Uint8Array): boolean {
  // A JSON index opens with whitespace or `{`. A column one opens with the
  // little-endian length of its header, and a header is never that short.
  return bytes.length > 4 && bytes[0] !== 0x7b && bytes[0] !== 0x20 && bytes[0] !== 0x0a;
}

/**
 * Read a column-encoded index back, whole.
 *
 * Returns the index {@link encodeExecutionIndex} was handed, field for field,
 * the optional `loaded` included. Throws on a file this did not write, on a
 * layout version it does not know, and on a bound that does not agree with the
 * column it indexes.
 */
export function decodeExecutionIndex(bytes: Uint8Array): ExecutionIndex {
  const file = resident(bytes);
  if (bytes.length < 4) throw invalid();
  const headerLength = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).readUInt32LE(0);
  if (headerLength <= 0 || headerLength + 4 > bytes.length) throw invalid();
  const header = JSON.parse(
    Buffer.from(bytes.buffer, bytes.byteOffset + 4, headerLength)
      .toString('utf8')
      .replace(/\0+$/u, ''),
  ) as Header;
  // The set spelling owns every other version, and refuses one it did not write.
  if (header.version !== EXECUTION_FORMAT && header.version !== UNFLAGGED_ROWS) {
    return decodeSetExecutionIndex(bytes);
  }
  const base = 4 + headerLength;
  if (!validSections(header.sections, bytes.length - base)) throw invalid();
  const found = new Map(header.sections.map((section) => [section.name, section]));

  const at = (name: string): Section => {
    const section = found.get(name);
    if (section === undefined) throw invalid();
    return section;
  };
  /** One section as its own range of the file, so a column addresses runs inside it. */
  const stored = (name: string): Bytes => {
    const section = at(name);
    const from = base + section.offset;
    return { length: section.length, read: (first, last) => file.read(from + first, from + last) };
  };
  const whole = (name: string): Uint8Array => {
    const section = at(name);
    return file.read(base + section.offset, base + section.offset + section.length);
  };
  // A section is run coded only when the runs came out smaller than the column,
  // which for a small index is never. Both spellings are on the wire, and
  // `rows` is what says which one this is.
  const words = (name: string): Uint32Array => {
    const section = at(name);
    if (section.rows !== undefined) return openWords(stored(name), section.rows).all();
    if (section.length % 4 !== 0) throw invalid();
    const held = whole(name);
    return new Uint32Array(held.buffer, held.byteOffset, section.length / 4);
  };
  const flags = (name: string): Uint8Array => {
    const section = at(name);
    return section.rows === undefined ? whole(name) : openBytes(stored(name), section.rows).all();
  };

  const stringOffsets = words('strings.off');
  const blobSection = at('strings.blob');
  const blobBytes =
    blobSection.rows === undefined ? whole('strings.blob') : openBlob(stored('strings.blob'), () => stringOffsets).all();
  const decoder = new TextDecoder();
  const strings: string[] = [];
  for (let id = 0; id + 1 < stringOffsets.length; id += 1) {
    const from = stringOffsets[id]!;
    const to = stringOffsets[id + 1]!;
    if (to < from || to > blobBytes.length) throw invalid();
    strings.push(decoder.decode(blobBytes.subarray(from, to)));
  }
  const string = (id: number): string => {
    const value = strings[id];
    if (value === undefined) throw invalid();
    return value;
  };

  const testId = words('tests.id');
  const testFile = words('tests.file');
  const testName = words('tests.name');
  // Written since a case carries how it settled; a file without it says nothing.
  const testStopped = found.has('tests.stopped') ? flags('tests.stopped') : undefined;
  if (testFile.length !== testId.length || testName.length !== testId.length) throw invalid();
  const tests: ExecutionTest[] = [];
  for (let at = 0; at < testId.length; at += 1) {
    tests.push({
      id: string(testId[at]!),
      file: string(testFile[at]!),
      name: string(testName[at]!),
      ...stoppedFrom(testStopped, at),
    });
  }

  const moduleFile = words('modules.file');
  const moduleBlocks = words('modules.blocks');
  const blockKind = words('blocks.kind');
  const blockName = words('blocks.name');
  const blockPath = words('blocks.path');
  const blockStart = words('blocks.start');
  const blockEnd = words('blocks.end');
  const blockSource = flags('blocks.source');
  const blockLoaded = header.version === UNFLAGGED_ROWS ? new Uint8Array(blockKind.length) : flags('blocks.loaded');
  const blockCrossings = words('blocks.crossings');
  const crossingTest = words('crossings.test');
  const crossingDistance = words('crossings.distance');
  const crossingLoaded = flags('crossings.loaded');
  if (moduleBlocks.length !== moduleFile.length + 1) throw invalid();
  if (blockCrossings.length !== blockKind.length + 1) throw invalid();
  if (blockLoaded.length !== blockKind.length) throw invalid();

  const modules: ExecutionModule[] = [];
  for (let module = 0; module < moduleFile.length; module += 1) {
    const first = moduleBlocks[module]!;
    const last = moduleBlocks[module + 1]!;
    if (last < first || last >= blockCrossings.length) throw invalid();
    const blocks: ExecutionBlock[] = [];
    for (let block = first; block < last; block += 1) {
      const from = blockCrossings[block]!;
      const to = blockCrossings[block + 1]!;
      if (to < from || to > crossingTest.length) throw invalid();
      const crossings: ExecutionCrossing[] = [];
      for (let crossing = from; crossing < to; crossing += 1) {
        const loaded = crossingLoaded[crossing]!;
        crossings.push({
          test: crossingTest[crossing]!,
          distance: crossingDistance[crossing]!,
          ...(loaded === UNSAID ? {} : { loaded: loaded === LOADED }),
        });
      }
      blocks.push({
        kind: string(blockKind[block]!),
        name: string(blockName[block]!),
        path: string(blockPath[block]!),
        startLine: blockStart[block]!,
        endLine: blockEnd[block]!,
        source: blockSource[block] === 1,
        ...(blockLoaded[block] === 1 ? { loaded: true as const } : {}),
        crossings,
      });
    }
    modules.push({ file: string(moduleFile[module]!), blocks });
  }
  return { tests, modules };
}

function invalid(): Error {
  return new Error('not a variance-authority execution index');
}

/**
 * Every string the index names, once. `intern` sorts them and numbers them.
 *
 * Sorted because an ordered blob compresses as runs of shared prefixes — the
 * paths of one directory land together — and because a sorted dictionary makes
 * the id itself a sort key for anything that later wants one.
 */
function dictionary(index: ExecutionIndex): ReadonlySet<string> {
  const held = new Set<string>();
  for (const test of index.tests) {
    held.add(test.id);
    held.add(test.file);
    held.add(test.name);
  }
  for (const module of index.modules) {
    held.add(module.file);
    for (const block of module.blocks) {
      held.add(block.kind);
      held.add(block.name);
      held.add(block.path);
    }
  }
  return held;
}

/**
 * The index as the named file should hold it: columns, unless the name says
 * JSON.
 *
 * The extension is the contract because the file has a reader on the other
 * side and nothing else tells it which one to be. A default run writes
 * `<coverage file>.cases.bin`; an operator who names a `.json` path has said
 * they want to open it with something that reads JSON, and gets what they
 * asked for at the size it costs.
 */
export function executionIndexBytes(file: string, index: ExecutionIndex): Buffer {
  return file.endsWith('.json')
    ? Buffer.from(JSON.stringify(index), 'utf8')
    : encodeExecutionIndex(index);
}
