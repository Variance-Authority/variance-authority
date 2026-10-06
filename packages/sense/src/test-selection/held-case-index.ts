import { respelled, UNHEARD, preconditionStrings, preconditionWords } from './case-precondition-column.js';
import type { CrossingSetsPool } from './crossing-sets.js';
import { durationColumn, stoppedColumn, type SetColumns } from './execution-set-columns.js';
import { moduleAt, openSetColumns, writeSetColumns, type SetExecutionModule } from './execution-set-format.js';
import { below, mergedDictionary } from './format-dictionary.js';
import { NO_DURATION } from './format-layout.js';
import { codeUnitOrder } from './instrumented-modules.js';
import type { ExecutionTest } from './reverse.js';

/**
 * A case index a run is laid over, held as the columns it is stored in.
 *
 * A layer carries almost every case and region of it untouched, and a carried
 * one is integers: its strings are ids into a dictionary sorted by code unit,
 * so the order of two of them is the order of their ids, and they are copied
 * into the output as the bytes they are stored as. A string is decoded only
 * where the layer reasons about it — a test file it asks whether the checkout
 * still holds, a module the run recorded again — and once.
 */
export class HeldIndex {
  readonly columns: SetColumns;
  /** How many strings the dictionary holds. */
  readonly size: number;
  readonly #blob: Buffer;
  readonly #ascends: boolean;
  readonly #decoder = new TextDecoder();
  readonly #strings = new Map<number, string>();
  readonly #respelled = new Map<number, string>();
  readonly #modules = new Map<number, SetExecutionModule>();
  #moduleOfFile: Map<number, number> | undefined;

  /**
   * The index these bytes hold, or nothing when they hold none this can lay a
   * run over: the row spelling, or bytes it did not write — a precondition that
   * does not parse among them, which no case could be read back from.
   */
  static open(bytes: Uint8Array | undefined): HeldIndex | undefined {
    if (bytes === undefined) return undefined;
    try {
      const columns = openSetColumns(bytes);
      return columns === undefined ? undefined : new HeldIndex(columns);
    } catch {
      return undefined;
    }
  }

  private constructor(columns: SetColumns) {
    this.columns = columns;
    this.size = Math.max(columns.strings.offsets.length - 1, 0);
    const blob = columns.strings.blob;
    this.#blob = Buffer.isBuffer(blob) ? blob : Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
    this.#ascends = below(this.#blob);
    // Each distinct spelling once, as the writer spells it: a layer writes the
    // spelling it would write for the case as it reads it.
    for (const word of columns.testPreconditions ?? []) {
      if (word !== UNHEARD && !this.#respelled.has(word)) this.#respelled.set(word, respelled(this.string(word)));
    }
  }

  string(id: number): string {
    let found = this.#strings.get(id);
    if (found === undefined) {
      const { offsets } = this.columns.strings;
      found = this.#decoder.decode(this.#blob.subarray(offsets[id]!, offsets[id + 1]!));
      this.#strings.set(id, found);
    }
    return found;
  }

  /** A held precondition word's string as the output spells it. */
  respelled(word: number): string {
    return this.#respelled.get(word)!;
  }

  /**
   * Where `value` stands among the held strings, as one integer that orders
   * with the ids: `2 * id + 1` for the held string it is, and `2 * n` for one
   * the dictionary lacks, after the `n` held strings below it. Two strings the
   * dictionary lacks between the same two held ones share a key, and only their
   * own text orders them.
   */
  key(value: string): number {
    const { offsets } = this.columns.strings;
    const bytes = Buffer.from(value, 'utf8');
    const byBytes = this.#ascends && below(bytes);
    let low = 0;
    let high = this.size;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const order = byBytes
        ? this.#blob.compare(bytes, 0, bytes.length, offsets[middle]!, offsets[middle + 1]!)
        : codeUnitOrder(this.string(middle), value);
      if (order === 0) return 2 * middle + 1;
      if (order < 0) low = middle + 1;
      else high = middle;
    }
    return 2 * low;
  }

  /** The module stored at `row` as an object, its regions naming the sets they are stored with. */
  module(row: number): SetExecutionModule {
    let found = this.#modules.get(row);
    if (found === undefined) {
      found = moduleAt(this.columns, row, (id) => this.string(id));
      this.#modules.set(row, found);
    }
    return found;
  }

  /** The row of the module named by the string at `file`, the last when the index holds it twice. */
  moduleOf(file: number): number | undefined {
    if (this.#moduleOfFile === undefined) {
      this.#moduleOfFile = new Map();
      for (const [row, named] of this.columns.moduleFile.entries()) this.#moduleOfFile.set(named, row);
    }
    return this.#moduleOfFile.get(file);
  }

  /** Every module row once a file, in code-unit order of path; a file stored twice keeps its last row. */
  moduleRows(): number[] {
    const { moduleFile } = this.columns;
    return Array.from(moduleFile.keys())
      .sort((left, right) => moduleFile[left]! - moduleFile[right]!)
      .filter((row) => this.moduleOf(moduleFile[row]!) === row);
  }
}

/** A held module carried at the regions it was stored with: its sets translated, its load flags given. */
export interface CarriedModule {
  readonly row: number;
  readonly called: Uint32Array;
  readonly loaded: Uint8Array;
}

/** A module of a layer's output: a held one carried as integers, or one built as an object. */
export type LaidModule = CarriedModule | SetExecutionModule;

/** A case of a layer's output: a held row carried as it is stored, or one the run recorded. */
export type LaidTest = number | ExecutionTest;

/**
 * Write a layer's output: what {@link encodeSetExecutionIndex} writes for the
 * same cases and modules, every carried string copied as stored bytes rather
 * than decoded and interned again. `modules` come in code-unit order of path.
 */
export function writeLaid(
  held: HeldIndex,
  tests: readonly LaidTest[],
  modules: readonly LaidModule[],
  sets: CrossingSetsPool,
): Buffer {
  const columns = held.columns;
  const marked = new Uint8Array(held.size);
  const fresh = new Set<string>();
  const objects: ExecutionTest[] = [];
  for (const test of tests) {
    if (typeof test === 'number') {
      marked[columns.testId[test]!] = 1;
      marked[columns.testFile[test]!] = 1;
      marked[columns.testName[test]!] = 1;
      const word = columns.testPreconditions?.[test] ?? UNHEARD;
      if (word !== UNHEARD) fresh.add(held.respelled(word));
      continue;
    }
    objects.push(test);
    fresh.add(test.id);
    fresh.add(test.file);
    fresh.add(test.name);
  }
  for (const text of preconditionStrings(objects)) fresh.add(text);
  let blockCount = 0;
  for (const module of modules) {
    if ('row' in module) {
      marked[columns.moduleFile[module.row]!] = 1;
      for (let block = columns.moduleBlocks[module.row]!; block < columns.moduleBlocks[module.row + 1]!; block += 1) {
        marked[columns.blockKind[block]!] = 1;
        marked[columns.blockName[block]!] = 1;
        marked[columns.blockPath[block]!] = 1;
      }
      blockCount += module.called.length;
      continue;
    }
    if (module.called.length !== module.blocks.length || module.loaded.length !== module.blocks.length) {
      throw new Error('journey set columns do not match the region inventory');
    }
    fresh.add(module.file);
    for (const block of module.blocks) {
      fresh.add(block.kind);
      fresh.add(block.name);
      fresh.add(block.path);
    }
    blockCount += module.blocks.length;
  }
  const dictionary = mergedDictionary({ ...columns.strings, marked, fresh, string: (id) => held.string(id) });
  const { remap, id } = dictionary;

  const objectStopped = stoppedColumn(objects);
  const objectDuration = durationColumn(objects);
  const objectPreconditions = preconditionWords(objects, id);
  const testId = new Uint32Array(tests.length);
  const testFile = new Uint32Array(tests.length);
  const testName = new Uint32Array(tests.length);
  const testStopped = new Uint8Array(tests.length);
  const testDuration = new Uint32Array(tests.length);
  const testPreconditions = new Uint32Array(tests.length);
  for (let at = 0, object = 0; at < tests.length; at += 1) {
    const test = tests[at]!;
    if (typeof test === 'number') {
      testId[at] = remap[columns.testId[test]!]!;
      testFile[at] = remap[columns.testFile[test]!]!;
      testName[at] = remap[columns.testName[test]!]!;
      testStopped[at] = columns.testStopped?.[test] ?? 0;
      testDuration[at] = columns.testDuration?.[test] ?? NO_DURATION;
      const word = columns.testPreconditions?.[test] ?? UNHEARD;
      testPreconditions[at] = word === UNHEARD ? UNHEARD : id(held.respelled(word));
      continue;
    }
    testId[at] = id(test.id);
    testFile[at] = id(test.file);
    testName[at] = id(test.name);
    testStopped[at] = objectStopped[object]!;
    testDuration[at] = objectDuration[object]!;
    testPreconditions[at] = objectPreconditions[object]!;
    object += 1;
  }

  const moduleFile = new Uint32Array(modules.length);
  const moduleBlocks = new Uint32Array(modules.length + 1);
  const blockKind = new Uint32Array(blockCount);
  const blockName = new Uint32Array(blockCount);
  const blockPath = new Uint32Array(blockCount);
  const blockStart = new Uint32Array(blockCount);
  const blockEnd = new Uint32Array(blockCount);
  const blockSource = new Uint8Array(blockCount);
  const blockCalled = new Uint32Array(blockCount);
  const blockLoaded = new Uint8Array(blockCount);
  let block = 0;
  for (const [at, module] of modules.entries()) {
    moduleBlocks[at] = block;
    blockCalled.set(module.called, block);
    blockLoaded.set(module.loaded, block);
    if ('row' in module) {
      moduleFile[at] = remap[columns.moduleFile[module.row]!]!;
      for (let from = columns.moduleBlocks[module.row]!; from < columns.moduleBlocks[module.row + 1]!; from += 1) {
        blockKind[block] = remap[columns.blockKind[from]!]!;
        blockName[block] = remap[columns.blockName[from]!]!;
        blockPath[block] = remap[columns.blockPath[from]!]!;
        blockStart[block] = columns.blockStart[from]!;
        blockEnd[block] = columns.blockEnd[from]!;
        blockSource[block] = columns.blockSource[from] === 1 ? 1 : 0;
        block += 1;
      }
      continue;
    }
    moduleFile[at] = id(module.file);
    for (const region of module.blocks) {
      blockKind[block] = id(region.kind);
      blockName[block] = id(region.name);
      blockPath[block] = id(region.path);
      blockStart[block] = region.startLine;
      blockEnd[block] = region.endLine;
      blockSource[block] = region.source ? 1 : 0;
      block += 1;
    }
  }
  moduleBlocks[modules.length] = block;

  return writeSetColumns({
    strings: { blob: dictionary.blob, offsets: dictionary.offsets },
    testId, testFile, testName, testStopped, testDuration, testPreconditions,
    moduleFile, moduleBlocks,
    blockKind, blockName, blockPath, blockStart, blockEnd, blockSource, blockCalled, blockLoaded,
  }, sets);
}
