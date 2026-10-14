/**
 * Records read once by the addon for `distill`: every test file of a scope, or
 * one test file, against its cases, and with the file graph the import behind
 * each module no case entered.
 *
 * A distillation of a whole suite asks every test file which modules it loaded
 * and which its cases entered; read as objects, that is every crossing of the
 * record expanded, which a suite of tens of thousands of test files cannot
 * afford. The addon reads the coverage rows and the case index into what that
 * question needs and answers in columns (`native/src/distill_gather.rs`), and
 * `@variance-authority/distill` turns them into the shapes it publishes.
 */

import { EDGE_KINDS, type EdgeKind, type Relations } from '@variance-authority/core/relate';
import { native, nativeRefusal } from '../addon.js';
import type { NativeDistillCause, NativeDistillFile, NativeDistillGraph, NativeDistillRecords, NativeDistillRegion, NativeDistillScope } from '../native-distill.js';
import { caseSectionsOf, withCaseSections } from './case-record.js';
import { decodeExecutionIndex, decodeExecutionTests, isRowSpelledExecutionIndex } from './execution-format.js';
import { encodeAsSetExecutionIndex } from './execution-set-format.js';
import { RecordWithoutCoverage } from './format-validation.js';
import { flatten } from './journey-native.js';
import type { ExecutionTest } from './reverse.js';

export type { NativeDistillCause, NativeDistillFile, NativeDistillRegion, NativeDistillScope } from '../native-distill.js';

/** Records read for distillation; each question is answered without reading them again. */
export interface DistillRecords {
  /**
   * Every test file the records hold under `within`, a directory from the
   * repository root without a trailing `/` (absent, all of them), record by
   * record, each record's in code-unit order. Given `relations`, each spill is
   * the import that brought its modules in.
   */
  scope(within: string | undefined, relations?: Relations): NativeDistillScope;
  /** One test file, as the first record that holds it reads it; given `relations`, each unentered module's cause. */
  file(file: string, relations?: Relations): NativeDistillFile;
  /** The cases of `file`, as the case index of the record that holds it names them, in its order. */
  cases(file: string): readonly ExecutionTest[];
  /**
   * The regions the record that holds `file` keeps for `importer`, in its
   * order, read against `file`'s cases; none when it keeps no module for it.
   */
  regions(file: string, importer: string): readonly NativeDistillRegion[];
}

/** The edges a runtime evaluates a module through on load, and the one a literal `import()` leaves. */
const LOADING = (['imports', 'reexports', 'asset'] as const satisfies readonly EdgeKind[]).map((kind) => EDGE_KINDS.indexOf(kind));
const LAZY = [EDGE_KINDS.indexOf('dynamic')];
const REEXPORTS = EDGE_KINDS.indexOf('reexports');

const graphs = new WeakMap<Relations, NativeDistillGraph>();

/** The graph as the addon reads it, flattened once however many questions ask it. */
function graphOf(relations: Relations | undefined): NativeDistillGraph | undefined {
  if (relations === undefined) return undefined;
  let graph = graphs.get(relations);
  if (graph === undefined) {
    graphs.set(relations, (graph = { graph: flatten(relations), loading: LOADING, lazy: LAZY, reexports: REEXPORTS }));
  }
  return graph;
}

/** What the addon refuses a record holding cases and no coverage rows with: `WITHOUT_COVERAGE` in `coverage_rows.rs`. */
const WITHOUT_COVERAGE = 'the record holds no coverage rows';

/**
 * `record` with its case index in the set spelling, the one the addon reads. A
 * record written before the set spelling carries it as rows; it is converted
 * here, as it is read, rather than refused, so nobody records a suite again to
 * read it. A crossing made while its module loaded becomes the region's load
 * flag, which names no case, and a crossing's depth is dropped: `distill`
 * reads none.
 */
function setSpelled(record: Uint8Array): Uint8Array {
  if (!isRowSpelledExecutionIndex(record)) return record;
  const rows = decodeExecutionIndex(record);
  // The set spelling has no place for a depth and refuses an index that keeps one; `distill` reads none, so it is zeroed.
  const modules = rows.modules.map((module) => ({
    ...module,
    blocks: module.blocks.map((block) => ({ ...block, crossings: block.crossings.map((crossing) => ({ ...crossing, distance: 0 })) })),
  }));
  return withCaseSections(record, { ...caseSectionsOf(record), index: encodeAsSetExecutionIndex({ ...rows, modules }) });
}

/**
 * Coverage records, each with its case index, read for distillation.
 *
 * A record with no coverage rows throws `RecordWithoutCoverage`, as reading
 * its coverage would; one whose case index is in the row spelling is read as
 * its set-spelled conversion; and without the addon, distillation is refused
 * with why it did not load.
 */
export function readDistillRecords(given: readonly Uint8Array[]): DistillRecords {
  const read = native()?.readDistillRecords;
  if (read === undefined) {
    throw new Error(`distill reads its records with the native addon, which is unavailable: ${nativeRefusal() || 'it has no distillation'}`);
  }
  const records = given.map(setSpelled);
  let handle: NativeDistillRecords;
  try {
    handle = read(records.map((bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
  } catch (error) {
    throw error instanceof Error && error.message === WITHOUT_COVERAGE ? new RecordWithoutCoverage() : error;
  }
  // A record's cases are decoded once, without a region, however many files ask.
  const tests = new Map<number, readonly ExecutionTest[]>();
  const testsOf = (record: number) => {
    let found = tests.get(record);
    if (found === undefined) tests.set(record, (found = decodeExecutionTests(records[record]!)));
    return found;
  };
  return {
    scope: (within, relations) => handle.scope(within, graphOf(relations)),
    file: (file, relations) => handle.file(file, graphOf(relations)),
    cases: (file) => {
      const record = handle.holder(file);
      return record === null ? [] : testsOf(record).filter((test) => test.file === file);
    },
    regions: (file, importer) => handle.regions(file, importer),
  };
}

/**
 * The places of `causes` in the one order a scope's spills are read in, for
 * the groups of one test file: imports, then the shared, then the unseen; the
 * heaviest first; then by importer, an eager import first, then by what is
 * imported.
 */
export function rankDistillCauses(causes: readonly NativeDistillCause[]): readonly number[] {
  const rank = native()?.rankDistillCauses;
  if (rank === undefined) {
    throw new Error(`distill reads its records with the native addon, which is unavailable: ${nativeRefusal() || 'it has no distillation'}`);
  }
  return rank([...causes]);
}
