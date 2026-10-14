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
import type { NativeDistillFile, NativeDistillGraph, NativeDistillRecords, NativeDistillScope } from '../native-distill.js';
import { caseSectionsOf, recordedCases, withCaseSections } from './case-record.js';
import { decodeExecutionIndex } from './execution-format.js';
import { encodeAsSetExecutionIndex, SET_EXECUTION_FORMAT } from './execution-set-format.js';
import { framedHeader } from './format-layout.js';
import { openTestCoverage } from './format-view.js';
import { flatten } from './journey-native.js';
import type { ExecutionBlock, ExecutionIndex } from './reverse.js';

export type { NativeDistillFile, NativeDistillScope } from '../native-distill.js';

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

/**
 * The record with its case index in the set spelling, which is the one the
 * addon reads. An index written in the row spelling is spelled again, once per
 * read, without the depth of its crossings, which a distillation does not ask:
 * a case entered a module or did not. A record that carries no index is handed
 * on to be refused.
 */
function setSpelled(record: Uint8Array): Uint8Array {
  const index = recordedCases(record);
  if (index === record || framedHeader(index)?.version === SET_EXECUTION_FORMAT) return record;
  const { tests, modules } = decodeExecutionIndex(index);
  const flat: ExecutionIndex = {
    tests,
    modules: modules.map((module) => ({
      ...module,
      blocks: module.blocks.map((block) => ({ ...block, crossings: shallow(block.crossings) })),
    })),
  };
  return withCaseSections(record, { ...caseSectionsOf(record), index: encodeAsSetExecutionIndex(flat) });
}

/** Each case's crossings of a region as one at depth 0: a load if any of them was one, a call otherwise. */
function shallow(crossings: ExecutionBlock['crossings']): ExecutionBlock['crossings'] {
  const called = new Set<number>();
  const loaded = new Set<number>();
  for (const { test, loaded: load } of crossings) (load === true ? loaded : called).add(test);
  return [
    ...[...called].map((test) => ({ test, distance: 0 })),
    ...[...loaded].filter((test) => !called.has(test)).map((test) => ({ test, distance: 0, loaded: true })),
  ];
}

/**
 * Coverage records that carry their case index, read for distillation.
 *
 * A record with no coverage rows throws `RecordWithoutCoverage`, as reading
 * its coverage would; one without the addon is refused with why it did not load.
 */
export function readDistillRecords(records: readonly Uint8Array[]): DistillRecords {
  for (const bytes of records) openTestCoverage(bytes);
  const read = native()?.readDistillRecords;
  if (read === undefined) {
    throw new Error(`distill reads its records with the native addon, which is unavailable: ${nativeRefusal() || 'it has no distillation'}`);
  }
  const handle: NativeDistillRecords = read(records.map(setSpelled).map((bytes) => Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)));
  return {
    scope: (within, relations) => handle.scope(within, graphOf(relations)),
    file: (file, relations) => handle.file(file, graphOf(relations)),
  };
}
