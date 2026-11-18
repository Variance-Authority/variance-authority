/** Follow changed values through their readers and charge the recorded regions. */
// compass: variance-authority.reach.selection
import { NOTHING, WHOLE, idOf, nodeAt, lookupNodes, type NodeId, type Relations } from '@variance-authority/core/relate';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { native } from '../addon.js';
import type { NativeModuleReaders } from '../native-module-reads.js';
import { blocksAround, moduleRegion, regionOf } from './blocks-around.js';
import { arrivedFrame, frameOf, type Frame } from './frame.js';
import { walkImporters } from './importer-walk.js';
import { findModules, findTest } from './lookup.js';
import { hunksFor } from './patch.js';
import type { SelectionReason } from './narrowing.js';
import type { ReadingContext } from './reading.js';

/** Where a changed value was read: the reason for one charge. */
type Reader = (name: string, at: string, block?: number) => Extract<SelectionReason, { readonly kind: 'reader' }>;

/**
 * Charge a changed value to its readers: in the declaring file, and one file
 * deep through every direct importer — further only where an importer hands
 * the value on, and back into the declaring file where an import brings it
 * there. Returns the tests that loaded the declaring file through no importer
 * followed, when importers were followed from a file with a row.
 */
export function readValues(
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

  // The declaring file, asked as an importer of its own names, speaks for no
  // test: every test that loaded it crossed its rows, whatever edge it came by.
  const covered = new Set<number>();
  const declaring = nodeAt(relations, id)?.name;
  walkImporters(relations, id, moved, (importer, carried) => {
    const audience = importer === declaring ? new Set<number>() : covered;
    if (carried !== WHOLE) return readImporter(context, importer, carried, verdict.gone, reader, audience);
    // It reads the file, not a name: every name in it moved for it.
    answerWhole(context, importer, measured(context, importer, audience), (at, block) => reader(first!, at, block));
    return NOTHING;
  });

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
  return [...unseen].sort(codeUnitOrder);
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
  const { rowsOf, test } = measured(context, importer, covered);
  const origin = (name: string): string => moved.get(name) ?? name;
  const [first] = moved.keys();
  // A file with no row charges nothing by its line numbers: it is read as the
  // change leaves it.
  const rowed = rowsOf.size === 0 ? undefined : frameOf(coverage, knownAs(importer), rowsOf, options.sourceAt, options.keptText);
  const frame = rowed ?? arrivedFrame(coverage, [importer], hunksFor(context.hunks, importer), options.sourceAt);
  const text = typeof frame === 'object' ? frame.text : undefined;
  const found = text === undefined ? null : native()!.moduleReaders!(importer, text, [...moved.keys()], true);

  if (found === null) {
    // Not proved, no text, or not parsed: the importer as a whole is what can be said.
    answerWhole(context, importer, { rowsOf, test }, (at, block) => reader(origin(first!), at, block));
    return new Map();
  }
  if (rowsOf.size === 0 && test === undefined) return readUnmeasured(found, moved);

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

/** An importer's instrumented rows under each of its names, and its test when it is one, marked `covered`. */
function measured(context: ReadingContext, importer: string, covered: Set<number>) {
  const { coverage, knownAs } = context;
  const rowsOf = new Map<string, readonly number[]>();
  let test: number | undefined;
  for (const name of knownAs(importer)) {
    test ??= findTest(coverage, name);
    const rows = findModules(coverage, name).filter((module) => coverage.moduleInstrumented.at(module) === 1);
    if (rows.length > 0) rowsOf.set(name, rows);
  }
  if (test !== undefined) covered.add(test);
  for (const rows of rowsOf.values()) {
    for (const module of rows) {
      for (let block = coverage.moduleBlocks.at(module); block < coverage.moduleBlocks.at(module + 1); block += 1) {
        for (const entered of coverage.crossings.members(coverage.blockSet.at(block))) covered.add(entered);
      }
    }
  }
  return { rowsOf, test };
}

/**
 * An importer answered as a whole: every test that loaded its row, the test it
 * is, or — with neither — every test the graph says loaded it.
 */
function answerWhole(
  context: ReadingContext,
  importer: string,
  { rowsOf, test }: ReturnType<typeof measured>,
  reason: (at: string, block?: number) => ReturnType<Reader>,
): void {
  if (rowsOf.size > 0) chargeModule(context, importer, rowsOf, reason);
  else if (test === undefined) context.whole(importer, reason(importer));
  else context.pick(test, reason(importer));
}

/**
 * An importer with no row and no test, read: nothing it runs can be charged, so
 * a read of a moved name anywhere in it moves every name it exports, and its
 * own importers are asked in turn. One that reads none of them hands on only
 * what it re-exports. One that could not be read is answered whole instead, by
 * every test that loaded it, and hands on nothing: what imports it loads it.
 */
function readUnmeasured(found: NativeModuleReaders, moved: ReadonlyMap<string, string>): ReadonlyMap<string, string> {
  const passed = new Map<string, string>();
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
export function chargeModule(
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

/** The first of these names the graph holds as a file. */
export function firstId(relations: Relations, names: readonly string[]): NodeId | undefined {
  if ('native' in relations) return lookupNodes(relations, names.map((name) => ({kind:'file', name}))).find((node) => node !== null)?.id;
  for (const name of names) {
    const id = idOf(relations, 'file', name);
    if (id !== undefined) return id;
  }
  return undefined;
}
