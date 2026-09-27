/**
 * What each recorded test file cost, as its runner reported it.
 *
 * Read from the snapshot a recorded run published, the way `recordedCases`
 * reads the per-case index: the nearest layer holding one answers, for each
 * suite the root config declares. Nothing here runs a test or times one. A
 * duration is the runner's figure, stored when the file was recorded, and a
 * file whose runner reported none is counted as untimed rather than as free.
 */

// compass: variance-authority.reach

import { existsSync } from 'node:fs';
import { layeredFiles, repositoryLayers } from './test-selection/cache-layers.js';
import { askCoverageFile } from './test-selection/coverage-file.js';
import { NO_DURATION } from './test-selection/format-layout.js';
import { recordPath } from './test-selection/record-location.js';
import { declaredSuites } from './test-selection/suites.js';

/** One test file and the milliseconds its runner reported for it. */
export interface TimedTestFile {
  readonly file: string;
  readonly duration: number;
}

/** One suite's slowest recorded files, or why there is no recording to read. */
export type RecordedDurations =
  | {
      readonly suite?: string;
      readonly recording: string;
      /** The slowest first, at most the limit asked for. */
      readonly slowest: readonly TimedTestFile[];
      /** Every file the recording holds a duration for. */
      readonly timed: number;
      /** Recorded files whose runner reported no duration, or that a recording older than durations holds. */
      readonly untimed: number;
    }
  | { readonly suite?: string; readonly recording: string; readonly unread: string };

/**
 * For each suite the root config declares, or the one record of a repository
 * that declares none: the `limit` test files its latest recording says took
 * longest, slowest first, with ties in code-unit order of path.
 */
export function recordedDurations(root: string, limit: number): readonly RecordedDurations[] {
  const suites = declaredSuites(root)?.map((suite) => suite.name) ?? [undefined];
  const layers = repositoryLayers(root);
  return suites.map((suite) => {
    const named = suite === undefined ? {} : { suite };
    const candidates = layeredFiles(layers, recordPath(root, suite));
    const recording = candidates.find((candidate) => existsSync(candidate));
    if (recording === undefined) return { ...named, recording: candidates[0]!, unread: 'nothing is recorded there' };
    try {
      return { ...named, recording, ...askCoverageFile(recording, (view) => {
        const paths = view.testPath.all();
        const durations = view.testDuration?.all();
        const timed: TimedTestFile[] = [];
        for (let test = 0; test < paths.length; test += 1) {
          const duration = durations?.[test] ?? NO_DURATION;
          if (duration !== NO_DURATION) timed.push({ file: view.string(paths[test]!), duration });
        }
        timed.sort((left, right) =>
          right.duration - left.duration || (left.file < right.file ? -1 : left.file > right.file ? 1 : 0),
        );
        return { slowest: timed.slice(0, limit), timed: timed.length, untimed: paths.length - timed.length };
      }) };
    } catch (error) {
      return { ...named, recording, unread: error instanceof Error ? error.message : String(error) };
    }
  });
}
