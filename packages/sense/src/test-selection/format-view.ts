import {
  openBlob,
  openBytes,
  openWords,
  type ByteColumn,
  type RunCheck,
  type WordColumn,
} from './columns.js';
import {
  bits,
  csr,
  extents,
  ids,
  invalid,
  kinds,
  owners,
  presence,
  validateCoverageShape,
} from './format-validation.js';
import {
  FORMAT,
  KINDS,
  NAMES,
  NO_OWNER,
  validSections,
  type Header,
  type Section,
} from './format-layout.js';

/**
 * Opening a snapshot: the section index is parsed, and nothing else is.
 *
 * Which is why the checks live here rather than at the door. Shape — the row
 * counts agreeing with each other — is settled on the way in, from the index.
 * Values are settled by the column that holds them, when it is read, and a
 * column nobody reads is never proven because nothing it holds was believed.
 */

/**
 * A snapshot's columns, each read by the row or read whole.
 *
 * A column is stored as runs and a run decompresses when something in it is
 * asked for, so which of the two a caller picks is the difference between
 * reading a repository's regions and reading one module's. Selection asks by
 * the row — the blocks of the files a diff names, and nothing else — and a full
 * decode asks for the column.
 */
export interface TestCoverageView {
  readonly instrumentation: string;
  /** The commit this snapshot was recorded at; absent when it has no position. */
  readonly commit: string | undefined;
  readonly testPath: WordColumn;
  readonly testComplete: ByteColumn;
  readonly testPreconditions: WordColumn;
  readonly preconditionName: WordColumn;
  readonly preconditionDigest: WordColumn;
  readonly modulePath: WordColumn;
  readonly moduleSource: WordColumn;
  readonly moduleInstrumented: ByteColumn;
  readonly moduleBlocks: WordColumn;
  readonly blockOrdinal: WordColumn;
  readonly blockKind: ByteColumn;
  readonly blockOwner: WordColumn;
  readonly blockDigest: WordColumn;
  readonly blockName: WordColumn;
  readonly blockPath: WordColumn;
  readonly blockStart: WordColumn;
  readonly blockEnd: WordColumn;
  readonly blockSource: ByteColumn;
  readonly blockTests: WordColumn;
  readonly crossingTest: WordColumn;
  readonly blockLoaded: WordColumn;
  readonly loadedTest: WordColumn;
  string(id: number): string;
}

/** Open typed-array views over a snapshot; only the small section index is parsed. */
export function openTestCoverage(input: Uint8Array): TestCoverageView {
  const raw = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (raw.length < 4) throw invalid();
  const headerLength = raw.readUInt32LE(0);
  if (headerLength > raw.length - 4) throw invalid();
  const header = JSON.parse(raw.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as Header;
  if (header.version !== FORMAT) throw new Error(`unsupported test coverage version: ${header.version}`);
  const base = 4 + headerLength;
  if (!validSections(header.sections, raw.length - base)) throw invalid();
  const found = new Map(header.sections.map((section) => [section.name, section]));
  const at = (name: string): Section => {
    const value = found.get(name);
    if (value === undefined) throw invalid();
    return value;
  };
  const stored = (name: string): Uint8Array => {
    const section = at(name);
    return new Uint8Array(raw.buffer, raw.byteOffset + base + section.offset, section.length);
  };

  const rows: Record<string, number> = {};
  for (const name of NAMES) {
    const section = at(name);
    if (section.rows !== undefined) rows[name] = section.rows;
    else {
      if (section.length % section.width !== 0) throw invalid();
      rows[name] = section.length / section.width;
    }
  }
  validateCoverageShape(rows);
  const strings = rows['strings.off']! - 1;
  const testCount = rows['tests.path']!;
  const blockCount = rows['blocks.ordinal']!;

  /**
   * A column stored as it is, wrapped in the same door a run-coded one answers
   * through. Its values are checked the first time any of them is read, which
   * for a column small enough not to be worth run coding is the whole of it.
   */
  const plain = <T extends Uint32Array | Uint8Array>(values: T, check?: RunCheck<T>): {
    length: number;
    at(index: number): number;
    all(): T;
  } => {
    let checked = false;
    const all = (): T => {
      if (!checked) {
        check?.(values, 0);
        checked = true;
      }
      return values;
    };
    return {
      length: values.length,
      at: (index) => {
        if (index < 0 || index >= values.length) throw invalid();
        return all()[index]!;
      },
      all,
    };
  };

  /**
   * A column whose values are only true of it as a whole — offsets that begin at
   * zero and end at the length of whatever they cut, an owner that names an
   * ordinal of the module it belongs to. No single run holds all of either, so
   * the check runs when the column materializes and not before.
   *
   * A row read goes straight through, on the bargain the crossings already make:
   * what a bad bound could do to a reader walking rows is refused by the column
   * the bound indexes, and a pair that runs backwards is a loop that does not
   * execute.
   */
  const settled = (column: WordColumn, check: (values: Uint32Array) => void): WordColumn => {
    let checked = false;
    return {
      length: column.length,
      at: (index) => column.at(index),
      all: () => {
        const values = column.all();
        if (!checked) {
          check(values);
          checked = true;
        }
        return values;
      },
    };
  };

  const words = (name: string, check?: RunCheck<Uint32Array>): WordColumn => {
    const section = at(name);
    if (section.rows !== undefined) return openWords(stored(name), section.rows, check);
    return plain(
      new Uint32Array(raw.buffer, raw.byteOffset + base + section.offset, section.length / 4),
      check,
    );
  };
  const flags = (name: string, check: RunCheck<Uint8Array>): ByteColumn => {
    const section = at(name);
    if (section.rows !== undefined) return openBytes(stored(name), section.rows, check);
    return plain(
      new Uint8Array(raw.buffer, raw.byteOffset + base + section.offset, section.length),
      check,
    );
  };

  const stringOffsets = settled(words('strings.off'), (values) =>
    csr(values, rows['strings.blob']!),
  );
  const blobBytes = at('strings.blob').rows === undefined
    ? wholeBlob(stored('strings.blob'), () => stringOffsets.all())
    : openBlob(stored('strings.blob'), () => stringOffsets.all());
  const decoder = new TextDecoder();
  const stringAt = (id: number): string => {
    if (id < 0 || id >= strings) throw invalid();
    return decoder.decode(blobBytes(id));
  };

  const instrumentation = words('snapshot.instrumentation', (values) => ids(values, strings));
  const commit = words('snapshot.commit', (values) => ids(values, strings));
  const moduleBlocks = settled(words('modules.blocks'), (values) => csr(values, blockCount));
  const blockOrdinal = words('blocks.ordinal');
  const blockKind = flags('blocks.kind', (values) => kinds(values, KINDS.length));
  const blockStart = words('blocks.start');

  return {
    get instrumentation() {
      const value = instrumentation.at(0);
      return stringAt(value);
    },
    get commit() {
      return commit.length === 0 ? undefined : stringAt(commit.at(0));
    },
    testPath: words('tests.path', (values) => ids(values, strings)),
    testComplete: flags('tests.complete', bits),
    testPreconditions: settled(words('tests.preconditions'), (values) =>
      csr(values, rows['preconditions.name']!),
    ),
    preconditionName: words('preconditions.name', (values) => ids(values, strings)),
    preconditionDigest: words('preconditions.digest', (values) => ids(values, strings)),
    modulePath: words('modules.path', (values) => ids(values, strings)),
    moduleSource: words('modules.source', (values) => ids(values, strings)),
    moduleInstrumented: flags('modules.instrumented', (values, from) => {
      bits(values);
      presence(values, from, (module) => moduleBlocks.at(module));
    }),
    moduleBlocks,
    blockOrdinal,
    blockKind,
    blockOwner: settled(words('blocks.owner'), (values) =>
      owners({
        moduleBlocks: moduleBlocks.all(),
        blockOrdinal: blockOrdinal.all(),
        blockKind: blockKind.all(),
        blockOwner: values,
        noOwner: NO_OWNER,
      }),
    ),
    blockDigest: words('blocks.digest', (values) => ids(values, strings)),
    blockName: words('blocks.name', (values) => ids(values, strings)),
    blockPath: words('blocks.path', (values) => ids(values, strings)),
    blockStart,
    // An extent is a pair and this is the half that completes it. Nothing reads
    // a region's last line without its first, and the first is read by the row
    // so that proving one run of ends does not decode the column of starts.
    blockEnd: words('blocks.end', (values, from) =>
      extents(values, from, (block) => blockStart.at(block)),
    ),
    blockSource: flags('blocks.source', bits),
    // No CSR check: selection reads two of these rows per region it was asked
    // about, and what a bound could corrupt is refused by the column it indexes.
    blockTests: words('blocks.tests'),
    crossingTest: words('crossings.test', (values) => ids(values, testCount)),
    blockLoaded: words('blocks.loaded'),
    loadedTest: words('loaded.test', (values) => ids(values, testCount)),
    string: stringAt,
  };
}

/** The same door onto a blob small enough to have been stored as it is. */
function wholeBlob(whole: Uint8Array, offsets: () => Uint32Array): (id: number) => Uint8Array {
  return (id) => {
    const at = offsets();
    const start = at[id];
    const end = at[id + 1];
    if (start === undefined || end === undefined || end > whole.length) throw invalid();
    return whole.subarray(start, end);
  };
}
