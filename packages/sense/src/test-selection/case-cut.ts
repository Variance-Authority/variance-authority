/**
 * The cases a selection lets a run skip, carried from the process that read
 * the selection to the workers that run them.
 *
 * A selection is read once, in the process that loaded the configuration: the
 * Vitest sequencer, the Jest filter. The cases run in workers that process
 * forks, which see the selection through nothing but the disk. So the part of
 * it that names cases is written to one file there, keyed by the absolute path
 * each worker knows its test file by, and the worker marks those cases skipped
 * between collecting the file and running it — through the runner's own task
 * modes, never a name pattern on argv.
 *
 * A file run in part is recorded incomplete, whatever its cases did: the cases
 * it skipped did not record their reach, and a whole record would replace the
 * reach they had with none. See `mergeCoverage`.
 */

// compass: variance-authority.reach

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { projectPath } from './instrumented-modules.js';
import type { SuiteSelection } from './suite-selection.js';

/** Absolute test file to the names of the cases a run skips there, as the case record names them. */
export type CaseCut = ReadonlyMap<string, readonly string[]>;

/**
 * The environment variable that names a Jest run's cut file. A worker forks
 * with the environment the filter left, so the sandbox reads it there.
 */
export const CUT_VARIABLE = 'VARIANCE_AUTHORITY_TEST_SELECTION_CUT';

/** What `selection` cuts of the files a run kept, keyed by the absolute paths the runner gave them. */
export function cutOf(selection: SuiteSelection, kept: readonly string[], root: string): CaseCut {
  const cut = new Map<string, readonly string[]>();
  if (selection.cases === undefined) return cut;
  for (const file of kept) {
    const names = selection.cases.get(projectPath(root, file));
    if (names !== undefined && names.length > 0) cut.set(file, names);
  }
  return cut;
}

/** Put `cut` on disk at `file`, as JSON a worker reads without this module. */
export function writeCut(file: string, cut: CaseCut): void {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(Object.fromEntries(cut)), 'utf8');
}

/** The test files a cut file names; none when there is no file. */
export function cutFiles(file: string | undefined): ReadonlySet<string> {
  if (file === undefined) return new Set();
  try {
    return new Set(Object.keys(JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return new Set();
    throw error;
  }
}

export function removeCut(file: string | undefined): void {
  if (file !== undefined) rmSync(file, { force: true });
}

/**
 * The part of the Vitest case runner that reads the cut at `cutFile` and marks
 * its cases skipped: `cutOf(filepath)` and `skipCut(task, names, skipped)`,
 * for the runner's `onCollected`. It expects `readFileSync` and `getNames`
 * imported where it lands.
 *
 * A worker runs many files, so the cut is read at each file's collection. A
 * test it names is marked skipped, as `it.skip` would have; one the file
 * already skips, or leaves out under `only`, keeps the mode it has. Vitest 2
 * calls a test `run` there and Vitest 3 `queued`. The main process heard of
 * the file before that hook, and Vitest 2 reports nothing for a test it does
 * not run, so the runner sends each skip as a result through its own update.
 */
export function vitestCutSource(cutFile: string | undefined): string {
  return `
const cutFile = ${JSON.stringify(cutFile ?? null)};
const cutOf = (filepath) => {
  if (cutFile === null) return undefined;
  try {
    return JSON.parse(readFileSync(cutFile, 'utf8'))[filepath];
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
};
const skipCut = (task, names, skipped) => {
  if (task.type === 'test' && (task.mode === 'run' || task.mode === 'queued') && names.has(getNames(task).slice(1).join(' > '))) {
    task.mode = 'skip';
    task.result = { state: 'skip' };
    skipped.push([task.id, task.result, task.meta]);
  }
  for (const child of task.tasks ?? []) skipCut(child, names, skipped);
};
`;
}
