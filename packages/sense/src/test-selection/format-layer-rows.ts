import { codeUnitOrder } from './instrumented-modules.js';
import { settledModule } from './format.js';
import type { TestCoverageView } from './format-view.js';
import type { CrossingSetsView } from './crossing-sets-read.js';
import type { LayeredOrder } from './format-dictionary.js';
import { KINDS, NO_OWNER } from './format-layout.js';
import { writtenLines } from './written-lines.js';
import {
  addressKey,
  addressed,
  crossedBlock,
  crossingsAround,
  lostCrossings,
  recutRows,
  reusableBlock,
  withoutRetired,
} from './merge-carry.js';
import type { CoverageBlock, CoverageModule, CoverageTest, TestCoverage } from './index.js';

/**
 * Which modules the output holds, and in what order.
 *
 * The rows a run re-recorded are folded onto the previous rows they claim, the
 * rows whose text moved are cut again, and everything else keeps the place and
 * the crossings it already had. What comes back is that decision as one
 * integer a row — a previous row number as itself, an object as the ones'
 * complement of its position — which is what the columns are written from.
 *
 * ## Why none of it is asked as a string
 *
 * The rows are in code-unit order and so is the dictionary above them, so a
 * path's place among the strings decides its place among the rows. Both
 * searches here are therefore binary and integer, and the run that dominates
 * the answer — the modules nobody touched — is never decoded, never grouped
 * and never compared. A run that re-recorded ten modules of two hundred
 * thousand asks about ten names.
 */
export interface LayeredRows {
  readonly order: LayeredOrder;
  /** The modules an order entry names by complement, in that numbering. */
  readonly objects: readonly CoverageModule[];
  /** Tests whose crossings this pass lost, which demotes them to incomplete. */
  readonly stale: ReadonlySet<string>;
}

/** The columns {@link layeredRows} reads, which is every one a carried row is made of. */
export interface CarriedColumns {
  readonly modulePath: Uint32Array;
  readonly moduleSource: Uint32Array;
  readonly moduleInstrumented: Uint8Array;
  readonly moduleBlocks: Uint32Array;
  readonly blockOrdinal: Uint32Array;
  readonly blockKind: Uint8Array;
  readonly blockOwner: Uint32Array;
  readonly blockDigest: Uint32Array;
  readonly blockName: Uint32Array;
  readonly blockPath: Uint32Array;
  readonly blockStart: Uint32Array;
  readonly blockEnd: Uint32Array;
  readonly blockSource: Uint8Array;
  readonly blockSet: Uint32Array;
  readonly blockLoadedSet: Uint32Array;
}

export function layeredRows(input: {
  readonly view: TestCoverageView;
  readonly columns: CarriedColumns;
  readonly previousSets: CrossingSetsView;
  readonly previousTestRows: readonly CoverageTest[];
  readonly currentTests: ReadonlyMap<string, CoverageTest>;
  readonly retired: ReadonlySet<string>;
  readonly current: TestCoverage;
  readonly onDisk: ReadonlyMap<string, string>;
}): LayeredRows {
  const { view, previousSets, previousTestRows, currentTests, retired, current, onDisk } = input;
  const {
    modulePath, moduleSource, moduleInstrumented, moduleBlocks,
    blockOrdinal, blockKind, blockOwner, blockDigest, blockName, blockPath,
    blockStart, blockEnd, blockSource, blockSet, blockLoadedSet,
  } = input.columns;

  const moduleCount = modulePath.length;

  // Where a name sorts, asked once and answered in integers from there on.
  //
  // The dictionary is in code-unit order and so are the module rows, so a
  // path's position among the strings decides its position among the rows, and
  // the two searches below compose. Which is what keeps this side of the layer
  // off the snapshot's axis: a run that re-recorded ten modules of two hundred
  // thousand asks about ten names, and the other 199,990 rows are never
  // decoded, grouped or compared as text.
  const stringBound = (value: string): number => {
    let low = 0;
    let high = view.strings;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (codeUnitOrder(view.string(middle), value) < 0) low = middle + 1;
      else high = middle;
    }
    return low;
  };
  /** The string a path was interned under, or nothing if this file never held it. */
  const interned = (value: string): number | undefined => {
    const id = stringBound(value);
    return id < view.strings && view.string(id) === value ? id : undefined;
  };
  /** The first module row whose path sorts at or after this string. */
  const moduleBound = (id: number): number => {
    let low = 0;
    let high = moduleCount;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (modulePath[middle]! < id) low = middle + 1;
      else high = middle;
    }
    return low;
  };

  // Every row a path has, in row order, and not merely the first of them: two
  // builds reading one path are two rows, each built from its own text and
  // crossed by its own suite. A re-recorded row claims the previous row of its
  // own build — matched by the text it was built from, and otherwise the next
  // unclaimed row of the path, which is that path's one row wherever only one
  // build read it. Rows nobody claims are carried below, because a run that
  // re-recorded one build observed nothing about the other, and dropping its
  // row would leave its crossers whole with nothing recorded against the
  // module they entered. The merge decides it this way; this is that decision
  // spelled in columns.
  const claimed = new Uint8Array(moduleCount);
  const claim = (module: CoverageModule): number | undefined => {
    const path = interned(module.file);
    if (path === undefined) return undefined;
    const digest = interned(module.sourceDigest);
    let first: number | undefined;
    let exact: number | undefined;
    for (let row = moduleBound(path); row < moduleCount && modulePath[row] === path; row += 1) {
      if (claimed[row] === 1) continue;
      if (first === undefined) first = row;
      if (exact === undefined && digest !== undefined && moduleSource[row] === digest) exact = row;
    }
    const row = exact ?? first;
    if (row !== undefined) claimed[row] = 1;
    return row;
  };

  /** What a previous region's two crossing lists hold, as the fold reads them. */
  interface Carried {
    readonly files: readonly string[];
    readonly loaded: readonly string[];
  }

  /** The tests that entered a previous region before their own file began. */
  const loadedOf = (at: number): readonly string[] => {
    const files: string[] = [];
    for (const test of previousSets.members(blockLoadedSet[at]!)) {
      files.push(previousTestRows[test]!.file);
    }
    return files;
  };

  /** One previous region as the object model holds it, crossings and all. */
  const blockAt = (at: number): CoverageBlock => {
    const testFiles: string[] = [];
    for (const test of previousSets.members(blockSet[at]!)) {
      testFiles.push(previousTestRows[test]!.file);
    }
    const loadedBy = loadedOf(at);
    return {
      ...(loadedBy.length === 0 ? {} : { loadedBy }),
      ordinal: blockOrdinal[at]!,
      kind: KINDS[blockKind[at]!]!,
      ...(blockOwner[at] === NO_OWNER ? {} : { owner: blockOwner[at]! }),
      digest: view.string(blockDigest[at]!),
      name: view.string(blockName[at]!),
      path: view.string(blockPath[at]!),
      ...writtenLines(blockStart[at]!, blockEnd[at]!),
      source: blockSource[at] === 1,
      testFiles,
    };
  };
  const moduleAt = (at: number): CoverageModule => {
    const blocks: CoverageBlock[] = [];
    for (let block = moduleBlocks[at]!; block < moduleBlocks[at + 1]!; block += 1) {
      blocks.push(blockAt(block));
    }
    return {
      file: view.string(modulePath[at]!),
      sourceDigest: view.string(moduleSource[at]!),
      instrumented: moduleInstrumented[at] === 1,
      blocks,
    };
  };

  // The modules this run re-recorded: the crossings the previous rows still
  // carry, folded onto the rows that came in.
  const stale = new Set<string>();
  const rerecorded = current.modules.map((module): CoverageModule => {
    const at = claim(module);
    const byAddress = new Map(addressed(module.blocks));
    const surviving = new Map<CoverageBlock, Carried>();
    if (at !== undefined) {
      const instrumented = moduleInstrumented[at] === 1;
      const seen = new Map<string, number>();
      for (let before = moduleBlocks[at]!; before < moduleBlocks[at + 1]!; before += 1) {
        const address = `${view.string(blockName[before]!)}\0${view.string(blockPath[before]!)}`;
        const key = addressKey(address, seen);
        const block = byAddress.get(key);
        if (
          block !== undefined && module.instrumented && instrumented &&
          reusableBlock(block, { kind: KINDS[blockKind[before]!]! })
        ) {
          const files: string[] = [];
          for (const test of previousSets.members(blockSet[before]!)) {
            files.push(previousTestRows[test]!.file);
          }
          surviving.set(block, { files, loaded: loadedOf(before) });
          continue;
        }
        for (const test of previousSets.members(blockSet[before]!)) {
          const file = previousTestRows[test]!.file;
          if (!currentTests.has(file)) stale.add(file);
        }
      }
    }
    const kept = (test: string): boolean => !retired.has(test);
    // A region this run cut that the columns never held reads its carried
    // crossings off the region around it, as it does in `mergeCoverage`.
    const around = crossingsAround(module.blocks, (block) => {
      const held = surviving.get(block);
      if (held === undefined) return undefined;
      return { testFiles: held.files.filter(kept), loadedBy: held.loaded.filter(kept) };
    });
    return {
      file: module.file,
      sourceDigest: module.sourceDigest,
      instrumented: module.instrumented,
      blocks: module.blocks.map((block) => {
        const held = around(block);
        return crossedBlock(
          block,
          [...held.testFiles, ...block.testFiles],
          [...held.loadedBy, ...(block.loadedBy ?? [])],
        );
      }),
    };
  });

  // Text that moved is the one reason a carried module becomes an object: its
  // rows are lines of text nobody has any more, and they are cut again. The
  // map holds only the files whose text moved, so the rows to re-cut are found
  // from it rather than by asking every row whether it is one of them.
  const objects: CoverageModule[] = [...rerecorded];
  const recuts = new Map<number, number>();
  for (const [file, now] of onDisk) {
    const path = interned(file);
    if (path === undefined) continue;
    for (let row = moduleBound(path); row < moduleCount && modulePath[row] === path; row += 1) {
      // A row a re-recorded row claimed has been folded into it. Every other
      // row is one this run did not re-record, whether or not another build of
      // the same path was, and is carried with the crossings it holds.
      if (claimed[row] === 1) continue;
      const held = moduleAt(row);
      const recut = recutRows(held, now, current.instrumentation);
      const lost = recut === 'mislaid'
        ? [...new Set(held.blocks.flatMap((block) => block.testFiles))]
        : recut === undefined ? [] : lostCrossings(held, recut);
      for (const test of lost) if (!currentTests.has(test)) stale.add(test);
      if (recut === undefined || recut === 'mislaid') continue;
      recuts.set(row, objects.push(settledModule(withoutRetired(recut, retired))) - 1);
    }
  }

  // The output's module order, as one integer a row.
  //
  // A carried row keeps the place it already had — the previous rows are in
  // code-unit order and a re-cut one is still the same path — so the order is
  // the rows as they stand with the re-recorded modules spliced in where their
  // paths sort. That is the same order sorting the whole list by path produces,
  // arrived at without a string per module to sort on: at two hundred thousand
  // modules the sort alone was six hundred thousand comparisons over strings
  // this function otherwise never decodes.
  const spliced = rerecorded
    .map((module, at) => at)
    .sort((left, right) =>
      codeUnitOrder(rerecorded[left]!.file, rerecorded[right]!.file) || left - right);
  const splicedAt = rerecorded.map((module) => moduleBound(stringBound(module.file)));
  let carriedCount = 0;
  for (let row = 0; row < moduleCount; row += 1) if (claimed[row] === 0) carriedCount += 1;
  const order = new Int32Array(rerecorded.length + carriedCount);
  let placed = 0;
  let fresh = 0;
  for (let row = 0; row <= moduleCount; row += 1) {
    while (fresh < spliced.length && splicedAt[spliced[fresh]!]! <= row) {
      order[placed++] = ~spliced[fresh]!;
      fresh += 1;
    }
    if (row === moduleCount || claimed[row] === 1) continue;
    const recut = recuts.get(row);
    order[placed++] = recut === undefined ? row : ~recut;
  }
  return { order, objects, stale };
}
