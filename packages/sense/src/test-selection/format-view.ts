import {
  openBlob,
  openBytes,
  openWords,
  resident,
  type Blob,
  type ByteColumn,
  type Bytes,
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
  openCrossingSets,
  type CrossingSetsPool,
  type CrossingSetsView,
} from './crossing-sets.js';
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
  /** Which set of tests crossed each region: one row per region, naming a pool entry. */
  readonly blockSet: WordColumn;
  /**
   * The pool those ids name, answering both directions of the relation.
   *
   * Opened, not decoded. A selection asks about the sets of the regions a diff
   * named and nothing else, and each of those decompresses one run of the pool.
   */
  readonly crossings: CrossingSetsView;
  /**
   * Which set of tests had already loaded each region when its test began: one
   * row per region, naming an entry of that same pool. A region nothing loaded
   * names the empty set, which costs an id and no pool.
   */
  readonly blockLoadedSet: WordColumn;
  string(id: number): string;
  /**
   * How many strings the dictionary holds.
   *
   * The dictionary is written in order, so the count is what makes it
   * searchable: a caller holding a path can find the id it was interned under
   * in a handful of decodes ([`lookup.ts`](./lookup.ts)), instead of decoding a
   * column of ids to compare the strings behind them.
   */
  readonly strings: number;
  /**
   * The dictionary as it is stored: every string's bytes end to end, and the
   * offsets that cut them.
   *
   * A layer rewrites a snapshot whose dictionary it mostly keeps, and what it
   * needs of a carried string is where it sorts and what to copy — both of which
   * the UTF-8 already answers. Decoding each one to ask would be the largest
   * cost in the rewrite, and it would be paid to make strings that are
   * immediately encoded back into the bytes they came from.
   *
   * Handed over whole rather than by the row for the same reason the columns
   * are: a caller that wants all of it wants one decompression and a pair of
   * integers per string, not a subarray per string. It aliases the snapshot's
   * own memory, so a caller copies out of it rather than keeping it.
   */
  dictionary(): { readonly blob: Uint8Array; readonly offsets: Uint32Array };
  /**
   * The set pool as it is stored, for the caller that carries all of it.
   *
   * A layer keeps the sets of every region it did not re-record, and what it
   * needs of a carried set is its members — which the stored bytes answer
   * without a decode per region. Aliases the snapshot's memory, like
   * {@link TestCoverageView.dictionary}.
   */
  crossingPool(): CrossingSetsPool;
}

/**
 * Open typed-array views over a snapshot; only the small section index is parsed.
 *
 * Takes the file's bytes, or the file. Which one matters at a repository's
 * scale: a selection reads about one twentieth of a snapshot and a query that
 * touches nothing reads half a percent of it, so handing this a buffer is
 * handing it seventy-odd megabytes it will not look at. A caller that already
 * holds the bytes — a run that just encoded them, a merge about to fold them —
 * passes them as it always did. See `openCoverageFile` for the other one.
 */
export function openTestCoverage(input: Uint8Array | Bytes): TestCoverageView {
  const file = input instanceof Uint8Array ? resident(input) : input;
  if (file.length < 4) throw invalid();
  const headerLength = buffered(file.read(0, 4)).readUInt32LE(0);
  if (headerLength > file.length - 4) throw invalid();
  const head = buffered(file.read(0, 4 + headerLength));
  const header = JSON.parse(head.toString('utf8', 4, 4 + headerLength).replace(/\0+$/, '')) as Header;
  if (header.version !== FORMAT) throw new Error(`unsupported test coverage version: ${header.version}`);
  const base = 4 + headerLength;
  if (!validSections(header.sections, file.length - base)) throw invalid();
  const found = new Map(header.sections.map((section) => [section.name, section]));
  const at = (name: string): Section => {
    const value = found.get(name);
    if (value === undefined) throw invalid();
    return value;
  };
  /** One section as its own range of the file, so a column addresses runs inside it. */
  const stored = (name: string): Bytes => {
    const section = at(name);
    const from = base + section.offset;
    return { length: section.length, read: (first, last) => file.read(from + first, from + last) };
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
  const setCount = rows['sets.off']! - 1;
  const testCount = rows['tests.path']!;
  const blockCount = rows['blocks.ordinal']!;

  /**
   * A column stored as it is, wrapped in the same door a run-coded one answers
   * through. Its values are checked the first time any of them is read, which
   * for a column small enough not to be worth run coding is the whole of it.
   *
   * The bytes are taken on that first read rather than at the door, because a
   * snapshot that is not resident would otherwise read every plain section to
   * answer a question about one of them. How many rows it holds is known
   * without reading any of it, which is what `snapshot.commit` asks.
   */
  const plain = <T extends Uint32Array | Uint8Array>(
    length: number,
    make: () => T,
    check?: RunCheck<T>,
  ): {
    length: number;
    at(index: number): number;
    all(): T;
  } => {
    let values: T | undefined;
    const all = (): T => {
      if (values === undefined) {
        values = make();
        check?.(values, 0);
      }
      return values;
    };
    return {
      length,
      at: (index) => {
        if (index < 0 || index >= length) throw invalid();
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

  /** A whole section's bytes, which for a file on disk is a read of it. */
  const whole = (name: string): Uint8Array => {
    const section = at(name);
    return file.read(base + section.offset, base + section.offset + section.length);
  };
  const words = (name: string, check?: RunCheck<Uint32Array>): WordColumn => {
    const section = at(name);
    if (section.rows !== undefined) return openWords(stored(name), section.rows, check);
    if (section.length % 4 !== 0) throw invalid();
    return plain(
      section.length / 4,
      () => {
        const bytes = whole(name);
        return new Uint32Array(bytes.buffer, bytes.byteOffset, section.length / 4);
      },
      check,
    );
  };
  const flags = (name: string, check: RunCheck<Uint8Array>): ByteColumn => {
    const section = at(name);
    if (section.rows !== undefined) return openBytes(stored(name), section.rows, check);
    return plain(section.length, () => whole(name), check);
  };

  const stringOffsets = settled(words('strings.off'), (values) =>
    csr(values, rows['strings.blob']!),
  );
  // The offsets go in as a column and not as an array: a name is three offsets,
  // and asking this one for all of them decompressed 7.6 MB of `strings.off` to
  // answer the first `string(id)` of every query the format has.
  const blobBytes = at('strings.blob').rows === undefined
    ? wholeBlob(() => whole('strings.blob'), stringOffsets)
    : openBlob(stored('strings.blob'), stringOffsets);
  const decoder = new TextDecoder();
  const stringAt = (id: number): string => {
    if (id < 0 || id >= strings) throw invalid();
    return decoder.decode(blobBytes(id));
  };

  const setOffsets = settled(words('sets.off'), (values) => csr(values, rows['sets.blob']!));
  const setBytes = at('sets.blob').rows === undefined
    ? wholeBlob(() => whole('sets.blob'), setOffsets)
    : openBlob(stored('sets.blob'), setOffsets);
  const crossings = openCrossingSets({
    size: setCount,
    testCount,
    bytes: (set) => setBytes(set),
  });

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
    blockSet: words('blocks.set', (values) => ids(values, setCount)),
    crossings,
    blockLoadedSet: words('blocks.loadedSet', (values) => ids(values, setCount)),
    string: stringAt,
    strings,
    dictionary: () => ({ blob: blobBytes.all(), offsets: stringOffsets.all() }),
    crossingPool: () => ({ bytes: setBytes.all(), offsets: setOffsets.all(), testCount }),
  };
}

/** The same door onto a blob small enough to have been stored as it is. */
function wholeBlob(bytes: () => Uint8Array, offsets: Pick<WordColumn, 'at'>): Blob {
  let held: Uint8Array | undefined;
  const body = (): Uint8Array => (held ??= bytes());
  const read = (id: number): Uint8Array => {
    const start = offsets.at(id);
    const end = offsets.at(id + 1);
    const whole = body();
    if (end < start || end > whole.length) throw invalid();
    return whole.subarray(start, end);
  };
  return Object.assign(read, { all: body });
}

/** A `Buffer` over bytes that may be a slice of the file or a read of it. */
function buffered(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/**
 * The snapshot, or nothing when it is not one this build can read.
 *
 * Opening parses the index and proves nothing else, so every column is
 * materialized here — where a refusal still means "there was no index to merge
 * with" — rather than in the middle of a write that has already begun.
 */
export function wholeCoverage(bytes: Uint8Array):
  { view: TestCoverageView; columns: ReturnType<typeof allColumns> } | undefined {
  try {
    const view = openTestCoverage(bytes);
    void view.instrumentation;
    return { view, columns: allColumns(view) };
  } catch {
    return undefined;
  }
}

/** Every column of a snapshot, decompressed once and read as arrays from here on. */
export function allColumns(view: TestCoverageView) {
  return {
    testPath: view.testPath.all(),
    testComplete: view.testComplete.all(),
    testPreconditions: view.testPreconditions.all(),
    preconditionName: view.preconditionName.all(),
    preconditionDigest: view.preconditionDigest.all(),
    modulePath: view.modulePath.all(),
    moduleSource: view.moduleSource.all(),
    moduleInstrumented: view.moduleInstrumented.all(),
    moduleBlocks: view.moduleBlocks.all(),
    blockOrdinal: view.blockOrdinal.all(),
    blockKind: view.blockKind.all(),
    blockOwner: view.blockOwner.all(),
    blockDigest: view.blockDigest.all(),
    blockName: view.blockName.all(),
    blockPath: view.blockPath.all(),
    blockStart: view.blockStart.all(),
    blockEnd: view.blockEnd.all(),
    blockSource: view.blockSource.all(),
    blockSet: view.blockSet.all(),
    crossings: view.crossingPool(),
    blockLoadedSet: view.blockLoadedSet.all(),
  };
}
