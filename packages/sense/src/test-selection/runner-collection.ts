/**
 * Which test files a Vitest run's configuration collects, as Vitest answers it.
 *
 * A record outlives the configuration it was recorded under. A suite narrowed
 * under a record — split into slices, an include tightened — leaves rows for
 * files that are still on disk and that no run of the suite will observe
 * again, and a landing asks this to let them go. The globs are Vitest's to
 * match: a second reading of `include`, `exclude` and `includeSource` here
 * would be a second answer to its question, wrong wherever the two part.
 *
 * Only a run that collects what its configuration does can answer. A command
 * line that excludes files or picks projects narrows the run, not the suite,
 * and `vitest $(variance select --format vitest)` hands every skipped file over
 * as `--exclude`. Such a run answers nothing, and nothing leaves.
 */

import type { Collects } from './commit-runs.js';

/** A Vitest 2 workspace project, or a Vitest 3 and 4 test project, as far as collection reads it. */
interface CollectingProject {
  /** Vitest 3 and 4. */
  readonly matchesTestGlob?: (file: string) => boolean;
  /** Vitest 2 and 3. */
  readonly isTargetFile?: (file: string) => Promise<boolean>;
}

/** The runner as a reporter's `onInit` hands it over, as far as collection reads it. */
export interface CollectingRunner {
  readonly projects?: readonly CollectingProject[];
  /** The resolved configuration, command line merged in. */
  readonly config?: { readonly cliExclude?: unknown; readonly project?: unknown };
  /** What the run changed since it started: watch mode's `p` picks projects here. */
  readonly configOverride?: { readonly project?: unknown };
}

/**
 * The runner's answer to whether the suite collects a file, read when the run
 * lands: `--project` can be picked again in watch mode after `onInit`.
 *
 * A file is the suite's when any project collects it, and leaves only when
 * every project says it does not. A project with neither method, and a source
 * file Vitest cannot read for in-source tests, answer `undefined`.
 */
// FIXME: `--dir` on the command line narrows the run the same way and is merged
// into `config.dir` indistinguishably from the configuration's own, so a run
// given one drops the record's files outside it. Each then runs at the next
// selection and is recorded again.
export function collectionOf(runner: () => CollectingRunner | undefined): Collects {
  return async (file) => {
    const context = runner();
    if (context === undefined || narrowed(context)) return undefined;
    const projects = context.projects ?? [];
    if (projects.length === 0) return undefined;
    for (const project of projects) {
      let collected: boolean | undefined;
      try {
        collected = project.matchesTestGlob !== undefined
          ? project.matchesTestGlob(file)
          : await project.isTargetFile?.(file);
      } catch {
        return undefined;
      }
      if (collected !== false) return collected;
    }
    return false;
  };
}

/** Whether the command line narrowed what the run collects. */
function narrowed(context: CollectingRunner): boolean {
  const given = (value: unknown): boolean =>
    value !== undefined && value !== null && (!Array.isArray(value) || value.length > 0);
  return given(context.config?.cliExclude) || given(context.config?.project) ||
    given(context.configOverride?.project);
}
