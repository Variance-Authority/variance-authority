/**
 * What each story executed, recorded for the next run's selection.
 *
 * The instrument is the one `@variance-authority/sense` already uses; only the
 * transport differs, which is the rule
 * [spec 0028](../../../docs/specs/0028-the-instrument.md) states. The preview is
 * built with `testSelectionProbes()`, the page counts block crossings, and this
 * closes one window per story and joins them at the end of the run.
 *
 * A story is its own owner. Storybook is an execution surface this tool drives
 * one subject at a time, so — unlike a test runner, where the file is the
 * smallest thing a runner can be asked to execute — the crossings of one story
 * belong to that story and to nothing else.
 */

import { readFile } from 'node:fs/promises';
import {
  drainExecution,
  preconditionOf,
  recordExecution,
  type EvaluatingPage,
  type ObservedSubject,
} from '@variance-authority/sense/journal';
import { parseStoryIndex } from '@variance-authority/storybook';
import { resolve } from 'node:path';

/** Where a story run's execution evidence is joined, read and kept. */
export interface StoryExecutionOptions {
  /** Repository root the recorded paths are relative to. Defaults to the cwd. */
  readonly root?: string;
  /** Matches the `label` the build's `testSelectionProbes()` used. Defaults to `build`. */
  readonly label?: string;
  /** Where the build wrote its block records. Defaults to the user cache. */
  readonly cacheRoot?: string;
  /** Coverage index. Defaults to the repository-keyed cache the runner seams share. */
  readonly coverageFile?: string;
}

/** One run's accumulation: a window per story, written once at the end. */
export interface StoryRecorder {
  /**
   * Close one story's window.
   *
   * `complete` is false for a story this run refused. A refused story still
   * executed code, so its crossings are kept — what it may never do is justify
   * excluding itself from a later run.
   */
  readonly note: (page: EvaluatingPage, subjectId: string, complete: boolean) => Promise<void>;
  /** Merge the run into the index, or say on stderr why it could not. */
  readonly close: () => Promise<void>;
}

export async function createStoryRecorder(
  index: string,
  options: StoryExecutionOptions,
): Promise<StoryRecorder> {
  const root = resolve(options.root ?? process.cwd());
  const storyFiles = await storyFilesFrom(index);
  const observed: ObservedSubject[] = [];
  let seen = false;

  return {
    note: async (page, subjectId, complete) => {
      const journal = await drainExecution(page);
      if (journal === undefined) return;
      seen = true;
      const storyId = subjectId.replace(/^story:/, '');
      const file = storyFiles.get(storyId);
      const precondition = file === undefined ? undefined : await preconditionOf(root, file);
      observed.push({
        owner: subjectId,
        journal,
        complete,
        ...(precondition === undefined ? {} : { preconditions: [precondition] }),
      });
    },

    close: async () => {
      if (!seen) {
        process.stderr.write(
          'variance-authority: `tests` is on and the Storybook preview has no execution ' +
            'collector in it — build it with `testSelectionProbes()` from ' +
            '`@variance-authority/sense/journal`, or the next `--since` will run ' +
            'everything\n',
        );
        return;
      }
      // A refusal is written and the run continues. Recording is an addition to
      // a visual run: losing it costs the *next* selection its narrowing, which
      // is a full suite — the safe direction — while failing the run over it
      // would cost this one its baselines, which is not.
      //
      // That holds for a throw as much as for a refusal. The recorder reports
      // what it declined in `because`, but it is a file format, a lock and a
      // filesystem underneath, and any of them can raise something it has no
      // sentence for. Letting that escape ends the run *after* every subject
      // has been rendered and compared — the most expensive possible moment to
      // lose a set of baselines, and over the half of the work that was only
      // ever an addition.
      let record: Awaited<ReturnType<typeof recordExecution>>;
      try {
        record = await recordExecution({
          root,
          subjects: observed,
          ...(options.label === undefined ? {} : { label: options.label }),
          ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
          ...(options.coverageFile === undefined ? {} : { coverageFile: options.coverageFile }),
        });
      } catch (error) {
        process.stderr.write(
          'variance-authority: recorded no story execution — the recorder failed with ' +
            `${error instanceof Error ? error.message : String(error)}; this run is ` +
            'unaffected and the next `--since` will run everything\n',
        );
        return;
      }
      if (!record.recorded) {
        process.stderr.write(
          `variance-authority: recorded no story execution — ${record.because}\n`,
        );
      }
    },
  };
}

/**
 * Story id to the file that declares it, from the index the run is driving.
 *
 * The one route from a subject back to a file, and the reason a story's own
 * `.stories` file can select it: nothing *enters* a story file the way execution
 * enters a module, so without this a commit that edits one selects nothing.
 */
async function storyFilesFrom(index: string): Promise<Map<string, string>> {
  const parsed = parseStoryIndex(JSON.parse(await readFile(index, 'utf8')), index);
  return new Map(parsed.stories.map((story) => [story.id, story.importPath]));
}
