// compass: variance-authority/runtime/attention
/**
 * What the distillation tests read from: coverage rows and a case index
 * written as one record, and a file graph from the edges a fixture names.
 */
import { relationsOf, type Relation, type Relations } from '@variance-authority/core/relate';
import {
  encodeAsSetExecutionIndex,
  encodeTestCoverage,
  withCaseSections,
  type ExecutionIndex,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { distillFile, type FileDistillation, type FileDistillInput } from './file.js';

/** The record a run writes: its coverage rows, layered over nothing, and its case index in the set spelling. */
export function recordOf(coverage: TestCoverage, execution: ExecutionIndex): Uint8Array {
  return withCaseSections(encodeTestCoverage(coverage), { index: encodeAsSetExecutionIndex(execution) });
}

const file = (name: string) => ({ kind: 'file', name }) as const;

/**
 * The file graph of the static imports `edges` names, a file in `republishing`
 * re-exporting every one it writes, and the literal `import()`s `lazy` names.
 */
export function graphOf(
  edges: Readonly<Record<string, readonly string[]>>,
  republishing: readonly string[] = [],
  lazy: Readonly<Record<string, readonly string[]>> = {},
): Relations {
  const relations: Relation[] = [];
  for (const [from, targets] of Object.entries(edges)) {
    const kind = republishing.includes(from) ? 'reexports' : 'imports';
    for (const to of targets) relations.push({ from: file(from), to: file(to), kind });
  }
  for (const [from, targets] of Object.entries(lazy)) {
    for (const to of targets) relations.push({ from: file(from), to: file(to), kind: 'dynamic' });
  }
  return relationsOf({ relations });
}

/** `distillFile` over the record its coverage rows and case index write. */
export function distillOf(
  { coverage, execution, ...input }: Omit<FileDistillInput, 'record'> & { readonly coverage: TestCoverage; readonly execution: ExecutionIndex },
): FileDistillation {
  return distillFile({ ...input, record: recordOf(coverage, execution) });
}
