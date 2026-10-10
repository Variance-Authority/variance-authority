/**
 * What the Jest reporter does about a test file several projects ran: read each
 * journal with the project that wrote it, match each project's result to its
 * own, and fold the per-project rows of one path into the one row the record
 * keys by path.
 */

import journalFormat from './journal-format.cjs';
import journalNames from './jest-journal-name.cjs';
import { readNamed, type ReadJournal } from './instrumented-modules.js';
import type { CoverageTest } from './index.js';

/** A test file's journal, and the project whose sandbox wrote it; no project for one without a name. */
export interface ProjectJournal {
  readonly journal: ReadJournal;
  readonly project?: string;
}

/** Every journal in a run directory, in the order `readWritten` gives, each with its project. */
export async function readProjectJournals(directory: string): Promise<readonly ProjectJournal[]> {
  return (await readNamed(directory)).map(({ name, bytes }) => {
    const project = journalNames.projectOfJournal(name);
    return { journal: journalFormat.decodeJournal(bytes), ...(project === undefined ? {} : { project }) };
  });
}

/**
 * The name a Jest `displayName` gives a project, a string or `{ name, color }`;
 * absent when it has none, which is the name a case of it carries. Read of the
 * configuration by `withTestSelection` and of each file's result here.
 */
export function projectNamed(displayName: unknown): string | undefined {
  const name = typeof displayName === 'object' && displayName !== null
    ? (displayName as { name?: unknown }).name
    : displayName;
  return typeof name === 'string' && name !== '' ? name : undefined;
}

/** The journals the project that ran a result wrote; none when that project wrote none. */
export function journalsOf(journals: readonly ProjectJournal[], project: string | undefined): readonly ReadJournal[] {
  return journals.filter((written) => written.project === project).map((written) => written.journal);
}

/**
 * One row per test file, however many projects ran it, as `oneRowPerFile` folds
 * Vitest's: the record's unit is a path, so a file is whole only where every
 * project that ran it was, its preconditions are each project's, and its cost is
 * the sum, unknown when any project did not say.
 */
export function oneTestPerFile(tests: readonly CoverageTest[]): CoverageTest[] {
  const byFile = new Map<string, CoverageTest>();
  for (const test of tests) {
    const seen = byFile.get(test.file);
    if (seen === undefined) {
      byFile.set(test.file, test);
      continue;
    }
    const preconditions = new Map(seen.preconditions.map((precondition) => [precondition.name, precondition]));
    for (const precondition of test.preconditions) {
      if (!preconditions.has(precondition.name)) preconditions.set(precondition.name, precondition);
    }
    const duration = seen.duration === undefined || test.duration === undefined ? undefined : seen.duration + test.duration;
    byFile.set(test.file, {
      file: test.file,
      complete: seen.complete && test.complete,
      preconditions: [...preconditions.values()],
      ...(duration === undefined ? {} : { duration }),
    });
  }
  return [...byFile.values()];
}
