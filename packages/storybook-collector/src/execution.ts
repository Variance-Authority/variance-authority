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
import { relative, resolve, sep } from 'node:path';
import {
  drainExecution,
  preconditionOf,
  recordExecution,
  type EvaluatingPage,
  type InstrumentMode,
  type ObservedCase,
  type ObservedSubject,
} from '@variance-authority/sense/journal';
import { parseStoryIndex } from '@variance-authority/storybook';
import { repositoryRoot } from '@variance-authority/sense/test-selection';

/** Where a story run's execution evidence is joined, read and kept. */
export interface StoryExecutionOptions {
  /**
   * A directory inside the repository; defaults to the cwd. Recorded paths are
   * relative to the checkout it sits in, never to it. A story's `importPath` is
   * read from here, because it is relative to the directory Storybook ran in.
   */
  readonly root?: string;
  /** Matches the `label` the build's `testSelectionProbes()` used. Defaults to `build`. */
  readonly label?: string;
  /** Where the build wrote its block records. Defaults to the repository's cache. */
  readonly cacheRoot?: string;
  /** Coverage index. Defaults to the repository-keyed cache the runner seams share. */
  readonly coverageFile?: string;
  /**
   * Where the execution index — which individual story entered which region —
   * goes. Defaults beside the snapshot, as the Vitest seam's does.
   *
   * A story is the case this costs nothing to name: the driver shows one at a
   * time, so the per-case grain a unit runner needs a custom runner for is
   * already here.
   */
  readonly executionFile?: string;
  /**
   * The probe recipe the preview was built with, matching
   * `testSelectionProbes()`'s `mode`. `presence` when absent, as it is there.
   *
   * Both sides answer the same or neither works: a journal cut by one recipe
   * and folded as another is refused, and a snapshot a runner seam also writes
   * under a different recipe has each run retire the other's evidence.
   */
  readonly mode?: InstrumentMode;
  /**
   * Files whose contents are preconditions of every story this run recorded.
   *
   * A `.storybook/preview` file, a theme module every decorator reads — a
   * story *file* is already a precondition of its own stories, and this is for
   * the ones no story declares and nothing enters.
   */
  readonly preconditions?: readonly string[];
  /**
   * Other builds this same run drove, by the label each instrumented under.
   *
   * A preview and the application behind it are two builds of overlapping
   * source, and a story that reaches both is one observation. Their stores
   * join this recording rather than getting one of their own.
   */
  readonly heads?: readonly string[];
  /**
   * Where this recording stands. Defaults to the checkout's `HEAD`, which is
   * the answer in every case except a caller that already knows better.
   */
  readonly commit?: string;
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
  const ran = resolve(options.root ?? process.cwd());
  const root = repositoryRoot(ran);
  const storyFiles = await storyFilesFrom(index, ran, root);
  const observed: ObservedSubject[] = [];
  const cases: ObservedCase[] = [];
  let seen = false;

  return {
    note: async (page, subjectId, complete) => {
      const journal = await drainExecution(page);
      if (journal === undefined) return;
      seen = true;
      const storyId = subjectId.replace(/^story:/, '');
      const story = storyFiles.get(storyId);
      const precondition =
        story === undefined ? undefined : await preconditionOf(root, story.file);
      observed.push({
        owner: subjectId,
        journal,
        complete,
        ...(precondition === undefined ? {} : { preconditions: [precondition] }),
      });
      // The index names a story by where it is declared, which is the same
      // coordinate a person reads in the sidebar and the same one a diff
      // touches. A story the driving index does not know — a subject named on
      // the command line, a preview rebuilt since — has no file to be a case
      // in, and contributes to the file-level record only.
      if (story !== undefined) {
        cases.push({ file: story.file, name: `${story.title}/${story.name}`, id: storyId, journal });
      }
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
          // Against `root`, as the runner seams resolve them, never the checkout.
          ...(options.coverageFile === undefined
            ? {}
            : { coverageFile: resolve(ran, options.coverageFile) }),
          ...(options.mode === undefined ? {} : { mode: options.mode }),
          ...(options.preconditions === undefined
            ? {}
            : { preconditions: options.preconditions }),
          ...(options.heads === undefined || options.heads.length === 0
            ? {}
            : { heads: options.heads }),
          ...(options.commit === undefined ? {} : { commit: options.commit }),
          ...(cases.length === 0 ? {} : { cases }),
          ...(options.executionFile === undefined
            ? {}
            : { executionFile: resolve(ran, options.executionFile) }),
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
 * Story id to where it is declared, from the index the run is driving.
 *
 * The one route from a subject back to a file, and the reason a story's own
 * `.stories` file can select it: nothing *enters* a story file the way execution
 * enters a module, so without this a commit that edits one selects nothing. The
 * title and the name come along because the execution index names a case by its
 * declaration rather than by the id Storybook slugged from it.
 *
 * Storybook writes `importPath` from the directory it ran in, `./` and all. A
 * diff names files from the checkout, so the path is resolved from `ran` and
 * named from `root`; in a workspace the two are a package apart.
 */
async function storyFilesFrom(
  index: string,
  ran: string,
  root: string,
): Promise<Map<string, StoryCoordinate>> {
  const parsed = parseStoryIndex(JSON.parse(await readFile(index, 'utf8')), index);
  return new Map(
    parsed.stories.map((story) => [
      story.id,
      {
        file: relative(root, resolve(ran, story.importPath)).split(sep).join('/'),
        title: story.title,
        name: story.name,
      },
    ]),
  );
}

/** Where a story is declared and what it is called there. */
interface StoryCoordinate {
  readonly file: string;
  readonly title: string;
  readonly name: string;
}
