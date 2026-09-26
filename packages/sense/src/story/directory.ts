/**
 * Where stories go, and whether a run asked for them.
 *
 * One variable on the command line, read by every seam when it configures the
 * run: `VARIANCE_AUTHORITY_STORY=1` tapes every case the run runs, and
 * narrowing is the runner's job — `-t`, a file argument, whatever the runner
 * already has. A story is written for somebody reading one case, so a run
 * without the variable pays nothing for it.
 *
 * Stories sit beside the record the run writes, `coverage.stories/` next to
 * `coverage.bin`, the way its runs log and case index do. A story is named
 * through that record's regions, so the directory carries which record that is:
 * a repository that declares suites keeps one per suite, and a story taped by
 * the unit suite is read through the unit suite's record. The record is in this
 * checkout's own cache layer, so a worktree writes its own stories and never
 * reads the primary checkout's: a story is the last run of a case here, and one
 * from another checkout is a run of other code.
 */

import { resolve } from 'node:path';
import { declaredSuites } from '../test-selection/suites.js';
import { testCoverageFile } from '../test-selection/record-location.js';

/** Set to `1` to write a story for every case the run runs. */
export const STORY_VARIABLE = 'VARIANCE_AUTHORITY_STORY';

const SUFFIX = '.stories';

/** The story directory beside the record at `recordFile`, whether or not anything has been written there. */
export function storyDirectory(recordFile: string): string {
  const stem = recordFile.endsWith('.bin') ? recordFile.slice(0, -'.bin'.length) : recordFile;
  return `${stem}${SUFFIX}`;
}

/** The record the stories in `directory` were taped beside, and are named through. */
export function recordOfStories(directory: string): string {
  return `${directory.slice(0, -SUFFIX.length)}.bin`;
}

/** This checkout's story directories: beside its one record, or beside each declared suite's. */
export function storyDirectories(root: string): string[] {
  const suites = declaredSuites(root);
  const records = suites === undefined
    ? [testCoverageFile(root)]
    : suites.map(({ name }) => testCoverageFile(root, { suite: name }));
  return records.map((record) => resolve(storyDirectory(record)));
}

/** The story directory beside `recordFile` when the environment asks for stories. */
export function askedForStories(recordFile: string, environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const asked = environment[STORY_VARIABLE];
  return asked === undefined || asked === '' || asked === '0' ? undefined : storyDirectory(recordFile);
}
