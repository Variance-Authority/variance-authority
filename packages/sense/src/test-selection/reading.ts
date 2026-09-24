/**
 * What a change to a module does, read from both of its texts before any region
 * of it is charged.
 *
 * A line number says where an edit sits, not what it does. A comment above the
 * imports, a new function, a type, and a changed top-level call all sit in the
 * module's own region, and that region's crossings are every test that loaded
 * the file. The parser can tell them apart given the text on both sides, and
 * the caller already holds the old one: `sourceAt` is how the frame was proved.
 * The new one is that text with the diff's hunks applied (`patch.ts`).
 *
 * The addon answers with one verdict per file, and each charges differently:
 *
 * - `none`: the runtime text is equal. Nothing is charged.
 * - `bodies`: what the module does as it loads is equal, and every binding it
 *   makes holds the same value. The regions the lines map to are charged,
 *   without the module's own region.
 * - `values`: the same, except that some bindings' values moved. The regions,
 *   and every place that reads those values: a function's region for a read
 *   inside it, the module for a read made as it loads, and the same question
 *   one file further for every direct importer of an exported one.
 * - `load`: the load sequence moved, and the module is charged as it always was.
 *
 * A change travels by use and by nothing else. Loading a module is assumed to
 * do nothing but declare what it exports, so an importer that never reads a
 * moved name is not reached by it, and neither is anything behind that
 * importer. A test that loaded the declaring file through no importer the
 * reading followed is not charged either: it is reported as `unseen`, because
 * an edge the graph does not hold is a defect to fix where it is, not a reason
 * to charge every test that loaded the file.
 *
 * A package can say otherwise, in the field every bundler reads for it:
 * `sideEffects`. A changed file its package declares, or an import added or
 * removed whose target's package declares it, makes the verdict `load`, and the
 * reading names the modules that made it so (`effects`). The manifest answers
 * through the resolver the scan uses, from `root`.
 *
 * A file the recording holds no row for — new, or never instrumented — has no
 * regions to charge, so every name it exports counts as moved and its readers
 * answer for it (`readRowless`).
 *
 * A file that could not be read is charged as it always was, and the reading
 * says why.
 */

import { EDGE_KINDS, RUNTIME_EDGES, idOf, nodeAt, type NodeId, type Relations } from '@variance-authority/core/relate';
import { native } from '../addon.js';
import type { NativeModuleReaders } from '../native.js';
import { blocksAround, gapInside, moduleRegion, regionOf } from './blocks-around.js';
import type { LineRange } from './diff-lines.js';
import { frameOf, type Frame } from './frame.js';
import type { TestCoverageView } from './format-view.js';
import { importedAsAsset, type ExecutionNarrowingOptions } from './importers.js';
import { findModules, findTest } from './lookup.js';
import { applied, hunksOf } from './patch.js';
import type { SelectionReason } from './select.js';

/** What the reading made of one changed file, or why it made nothing. */
export type FileReading =
  | {
      readonly file: string;
      readonly verdict: 'none' | 'bodies' | 'values' | 'load';
      /** The bindings whose values moved, for `values`. */
      readonly names: readonly string[];
      /**
       * The tests that loaded the file and reached it through no importer the
       * reading followed. Present when importers were followed: a moved export
       * of a file with a row.
       */
      readonly unseen?: readonly string[];
      /**
       * What turned the verdict to `load`: the file itself, or a source an
       * import started or stopped binding from, whose package declares that
       * loading it does something.
       */
      readonly effects?: readonly string[];
    }
  | {
      readonly file: string;
      readonly verdict?: undefined;
      /**
       * `source`: the caller gave no `sourceAt`, so no old text was proved.
       * `hunk`: a context or removed line is not the recorded text's.
       * `parse`: one of the two texts does not parse.
       * `addon`: no native scanner on this machine.
       */
      readonly unread: 'source' | 'hunk' | 'parse' | 'addon';
    };

/** What the reading needs from the query it runs inside. */
export interface ReadingContext {
  readonly coverage: TestCoverageView;
  readonly options: ExecutionNarrowingOptions;
  readonly knownAs: (file: string) => readonly string[];
  readonly hunks: ReturnType<typeof hunksOf>;
  /** Charge one block of a module row: every test that crossed it, less those that disowned it. */
  readonly charge: (file: string, block: number, reason: SelectionReason) => void;
  /** Select one test file directly. */
  readonly pick: (test: number, reason: SelectionReason) => void;
}

/** Where a changed value was read: the reason for one charge. */
type Reader = (name: string, at: string, block?: number) => SelectionReason;

/**
 * Read one changed file whose frame was proved, and charge what the verdict
 * says. `charged` is false when the verdict leaves the file to the caller —
 * `load`, or no reading at all — which charges it as a line-mapped change.
 */
export function readChange(
  context: ReadingContext,
  file: string,
  ranges: readonly LineRange[],
  frame: Frame,
  rowsOf: ReadonlyMap<string, readonly number[]>,
): { readonly reading: FileReading; readonly charged: boolean } {
  const scanner = native();
  if (scanner?.moduleVerdict === undefined || scanner.moduleReaders === undefined) {
    return { reading: { file, unread: 'addon' }, charged: false };
  }
  const patched = applied(frame.text, context.hunks.get(file) ?? []);
  if (patched === undefined) return { reading: { file, unread: 'hunk' }, charged: false };
  const verdict = scanner.moduleVerdict(frame.name, frame.text, patched.after);
  if (verdict === null) return { reading: { file, unread: 'parse' }, charged: false };

  const reading = { file, verdict: verdict.kind, names: verdict.names };
  if (verdict.kind === 'load') return { reading, charged: false };
  if (verdict.kind === 'none') return { reading, charged: true };
  const effects = declaredEffects(context, file, verdict.imported);
  if (effects.length > 0) {
    // The lines of a body edit map to the body alone; a declared load is every
    // test that loaded the file.
    chargeModule(context, file, rowsOf, (at, block) => regionOf(context.coverage, at, block));
    return { reading: { file, verdict: 'load', names: [], effects }, charged: true };
  }

  // The regions the lines map to, as 0030 reads them, without the module's own:
  // the verdict proved that what the module does as it loads did not move.
  const { coverage } = context;
  for (const [name, rows] of rowsOf) {
    for (const module of rows) {
      const first = coverage.moduleBlocks.at(module);
      const end = coverage.moduleBlocks.at(module + 1);
      for (const range of ranges) {
        // An insertion no region spans is text between regions. The verdict
        // proved it loads nothing, and a value it moves is charged to its
        // readers below, so nothing recorded ran the text itself.
        if (range.added !== undefined && !gapInside(coverage, first, end, range)) continue;
        for (const block of blocksAround(coverage, first, end, range)) {
          if (!moduleRegion(coverage, block)) context.charge(file, block, regionOf(coverage, name, block));
        }
      }
    }
  }
  if (verdict.kind === 'values') {
    const own = scanner.moduleReaders(frame.name, frame.text, verdict.names, false);
    // The same text parsed a moment ago, so a null is the addon disagreeing
    // with itself, and the module is what is left to say.
    if (own === null) chargeModule(context, file, rowsOf, (at, block) => regionOf(coverage, at, block));
    else {
      const unseen = readValues(context, file, frame, rowsOf, verdict, own);
      if (unseen !== undefined) return { reading: { ...reading, unseen }, charged: true };
    }
  }

  return { reading, charged: true };
}

/**
 * Read a changed module the recording holds no row for, against the text it
 * had at the recorded commit or against nothing when it is new. Nothing ran
 * it that the recording can place, so the question is only who reads what it
 * exports: every export counts as moved, and each importer's readers are
 * charged as they are for a moved value. `undefined` for a file this reading
 * does not apply to — not in the graph, or loaded as an asset, where the
 * import itself is the use — and `charged: false` for a `load` verdict or no
 * reading, which leaves the file to the walk over its importers.
 */
export function readRowless(
  context: ReadingContext,
  file: string,
): { readonly reading: FileReading; readonly charged: boolean } | undefined {
  const { coverage, options, knownAs } = context;
  const { relations, sourceAt } = options;
  if (relations === undefined || sourceAt === undefined) return undefined;
  const names = knownAs(file);
  const id = firstId(relations, [...names, file]);
  if (id === undefined || importedAsAsset(relations, id)) return undefined;
  const scanner = native();
  if (scanner?.moduleVerdict === undefined || scanner.moduleReaders === undefined) {
    return { reading: { file, unread: 'addon' }, charged: false };
  }

  let frame: Frame = { name: relations.names[id]!, text: '' };
  for (const name of names) {
    const text = sourceAt(name, coverage.commit);
    if (text !== undefined) {
      frame = { name, text };
      break;
    }
  }
  const patched = applied(frame.text, context.hunks.get(file) ?? []);
  if (patched === undefined) return { reading: { file, unread: 'hunk' }, charged: false };
  const verdict = scanner.moduleVerdict(frame.name, frame.text, patched.after);
  const now = scanner.moduleReaders(frame.name, patched.after, [], false);
  if (verdict === null || now === null) return { reading: { file, unread: 'parse' }, charged: false };
  const reading = { file, verdict: verdict.kind, names: verdict.names };
  if (verdict.kind === 'load') return { reading, charged: false };
  if (verdict.kind === 'none') return { reading, charged: true };
  const effects = declaredEffects(context, file, verdict.imported);
  if (effects.length > 0) return { reading: { file, verdict: 'load', names: [], effects }, charged: false };

  const exports = [...new Set([...now.interface, ...verdict.gone])];
  readValues(context, file, frame, new Map(), { ...verdict, exports }, now);
  return { reading, charged: true };
}

/**
 * Charge a changed value to its readers: in the declaring file, and one file
 * deep through every direct importer — further only where an importer hands
 * the value on. Returns the tests that loaded the declaring file through no
 * importer followed, when importers were followed from a file with a row.
 */
function readValues(
  context: ReadingContext,
  file: string,
  frame: Frame,
  rowsOf: ReadonlyMap<string, readonly number[]>,
  verdict: { readonly names: readonly string[]; readonly exports: readonly string[]; readonly gone: readonly string[] },
  own: NativeModuleReaders,
): readonly string[] | undefined {
  const { coverage, options } = context;
  const reader: Reader = (name, at, block) => ({
    kind: 'reader',
    name,
    file,
    reader: at,
    ...(block === undefined ? {} : { region: regionOf(coverage, at, block) }),
  });
  chargeReads(context, file, rowsOf, own, reader);

  // Exported names whose value moved: those the verdict named, and those
  // holding a value the readers saw move.
  const moved = new Map<string, string>();
  for (const name of verdict.exports) if (!name.startsWith('* ')) moved.set(name, name);
  for (const { name, origin } of own.exported) if (!moved.has(name)) moved.set(name, origin);
  if (moved.size === 0) return undefined;
  const [first] = moved.values();

  const { relations } = options;
  const id = relations === undefined ? undefined : firstId(relations, [frame.name, ...rowsOf.keys(), file]);
  if (relations === undefined || id === undefined) {
    // Nobody to ask who imports it, so every test that loaded it is an
    // audience the reading cannot rule out.
    chargeModule(context, file, rowsOf, (at, block) => reader(first!, at, block));
    return undefined;
  }

  const covered = new Set<number>();
  const visited = new Set<NodeId>([id]);
  let wave: Array<{ readonly id: NodeId; readonly moved: ReadonlyMap<string, string> }> = [{ id, moved }];
  while (wave.length > 0) {
    const next: typeof wave = [];
    for (const step of wave) {
      for (const importer of directImporters(relations, step.id)) {
        const node = nodeAt(relations, importer);
        if (node === undefined || node.kind !== 'file' || visited.has(importer)) continue;
        visited.add(importer);
        const passed = readImporter(context, node.name, step.moved, verdict.gone, reader, covered);
        if (passed.size > 0) next.push({ id: importer, moved: passed });
      }
    }
    wave = next;
  }

  // A test that loaded the declaring file through no importer the reading
  // followed reached it by an edge the graph does not hold. It is named, not
  // charged: charging it would select every such test for every change.
  if (rowsOf.size === 0) return undefined;
  const unseen = new Set<string>();
  for (const rows of rowsOf.values()) {
    for (const module of rows) {
      for (let block = coverage.moduleBlocks.at(module); block < coverage.moduleBlocks.at(module + 1); block += 1) {
        if (!moduleRegion(coverage, block)) continue;
        for (const test of coverage.crossings.members(coverage.blockSet.at(block))) {
          if (!covered.has(test)) unseen.add(coverage.string(coverage.testPath.at(test)));
        }
      }
    }
  }
  return [...unseen].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * One importer: where it reads the moved names, and the names it hands on.
 * Every test that crossed a row of it, and the importer itself when it is a
 * test, is `covered`: the reading spoke for it whether or not it charged it.
 */
function readImporter(
  context: ReadingContext,
  importer: string,
  moved: ReadonlyMap<string, string>,
  gone: readonly string[],
  reader: Reader,
  covered: Set<number>,
): ReadonlyMap<string, string> {
  const { coverage, options, knownAs } = context;
  const rowsOf = new Map<string, readonly number[]>();
  let test: number | undefined;
  for (const name of knownAs(importer)) {
    test ??= findTest(coverage, name);
    const rows = findModules(coverage, name).filter((module) => coverage.moduleInstrumented.at(module) === 1);
    if (rows.length > 0) rowsOf.set(name, rows);
  }
  if (rowsOf.size === 0 && test === undefined) return readUnmeasured(importer, moved, options, coverage.commit);
  if (test !== undefined) covered.add(test);
  for (const rows of rowsOf.values()) {
    for (const module of rows) {
      for (let block = coverage.moduleBlocks.at(module); block < coverage.moduleBlocks.at(module + 1); block += 1) {
        for (const entered of coverage.crossings.members(coverage.blockSet.at(block))) covered.add(entered);
      }
    }
  }

  const origin = (name: string): string => moved.get(name) ?? name;
  const [first] = moved.keys();
  // A test file carries no row, so its text needs no frame: nothing is charged
  // by its line numbers, only the test itself.
  const frame = rowsOf.size === 0 ? undefined : frameOf(coverage, knownAs(importer), rowsOf, options.sourceAt);
  const text =
    frame === undefined ? options.sourceAt?.(importer, coverage.commit) : typeof frame === 'string' ? undefined : frame.text;
  const found = text === undefined ? null : native()!.moduleReaders!(importer, text, [...moved.keys()], true);

  if (found === null) {
    // Not proved, or not parsed: the importer as a whole is what can be said.
    if (rowsOf.size === 0) context.pick(test!, reader(origin(first!), importer));
    else chargeModule(context, importer, rowsOf, (at, block) => reader(origin(first!), at, block));
    return new Map();
  }

  // An import of a name the declaring file no longer exports fails at load.
  const loads = [
    ...found.load,
    ...found.imports.filter((name) => gone.includes(name)),
    ...(found.untraced ? [first!] : []),
  ];
  if (rowsOf.size === 0) {
    const read = found.reads[0]?.name ?? loads[0];
    if (read !== undefined) context.pick(test!, reader(origin(read), importer));
  } else {
    chargeReads(context, importer, rowsOf, found, (name, at, block) => reader(origin(name), at, block));
    if (loads.length > 0) chargeModule(context, importer, rowsOf, (at, block) => reader(origin(loads[0]!), at, block));
  }

  const passed = new Map<string, string>();
  for (const { name, origin: from } of [...found.exported, ...found.passed]) {
    if (!passed.has(name)) passed.set(name, origin(from));
  }
  return passed;
}

/**
 * An importer with no row and no test: nothing it runs can be charged, so a
 * read of a moved name anywhere in it moves every name it exports, and its
 * own importers are asked in turn. One that reads none of them hands on only
 * what it re-exports. A text that cannot be had or parsed hands on nothing, and
 * the tests behind it are left to `unseen`.
 */
function readUnmeasured(
  importer: string,
  moved: ReadonlyMap<string, string>,
  options: ExecutionNarrowingOptions,
  commit: TestCoverageView['commit'],
): ReadonlyMap<string, string> {
  const text = options.sourceAt?.(importer, commit);
  const found = text === undefined ? null : native()!.moduleReaders!(importer, text, [...moved.keys()], true);
  const passed = new Map<string, string>();
  if (found === null) return passed;
  const origin = (name: string): string => moved.get(name) ?? name;
  const read = found.reads[0]?.name ?? found.load[0] ?? (found.untraced ? [...moved.keys()][0] : undefined);
  if (read !== undefined) for (const name of found.interface) passed.set(name, origin(read));
  for (const { name, origin: from } of [...found.exported, ...found.passed]) {
    if (!passed.has(name)) passed.set(name, origin(from));
  }
  return passed;
}

/** Each read inside a function, charged to the regions around its line without the module's own. */
function chargeReads(
  context: ReadingContext,
  file: string,
  rowsOf: ReadonlyMap<string, readonly number[]>,
  found: NativeModuleReaders,
  reason: Reader,
): void {
  const { coverage } = context;
  for (const [name, rows] of rowsOf) {
    for (const module of rows) {
      const first = coverage.moduleBlocks.at(module);
      const end = coverage.moduleBlocks.at(module + 1);
      for (const read of found.reads) {
        for (const block of blocksAround(coverage, first, end, { start: read.line, end: read.line })) {
          if (!moduleRegion(coverage, block)) context.charge(file, block, reason(read.name, name, block));
        }
      }
    }
  }
  if (found.load.length > 0) chargeModule(context, file, rowsOf, (at, block) => reason(found.load[0]!, at, block));
}

/** The module's own region, under every name: every test that loaded the file. */
function chargeModule(
  context: ReadingContext,
  file: string,
  rowsOf: ReadonlyMap<string, readonly number[]>,
  reason: (at: string, block: number) => SelectionReason,
): void {
  const { coverage } = context;
  for (const [name, rows] of rowsOf) {
    for (const module of rows) {
      for (let block = coverage.moduleBlocks.at(module); block < coverage.moduleBlocks.at(module + 1); block += 1) {
        if (moduleRegion(coverage, block)) context.charge(file, block, reason(name, block));
      }
    }
  }
}

/**
 * Of a changed file and the sources it started or stopped importing from,
 * those whose package declares that loading them does something. Nothing is
 * asked without a `root`, which leaves the assumption that loading a module
 * only declares what it exports.
 */
function declaredEffects(context: ReadingContext, file: string, imported: readonly string[]): readonly string[] {
  const { root } = context.options;
  const scanner = native();
  if (root === undefined || scanner?.declaredEffects === undefined) return [];
  return scanner.declaredEffects(root, file, [...imported]);
}

/** The first of these names the graph holds as a file. */
function firstId(relations: Relations, names: readonly string[]): NodeId | undefined {
  for (const name of names) {
    const id = idOf(relations, 'file', name);
    if (id !== undefined) return id;
  }
  return undefined;
}

/** The files that load this one at runtime, one edge away: a type-only import loads nothing. */
function directImporters(relations: Relations, id: NodeId): readonly NodeId[] {
  const { offset, target, kind } = relations.dependents;
  const importers: NodeId[] = [];
  for (let edge = offset[id]!; edge < offset[id + 1]!; edge += 1) {
    if (LOADS[kind[edge]!] === 1 && target[edge] !== id) importers.push(target[edge]!);
  }
  return importers;
}

const LOADS = new Uint8Array(EDGE_KINDS.length);
for (const kind of RUNTIME_EDGES) LOADS[EDGE_KINDS.indexOf(kind)] = 1;
