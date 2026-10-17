/**
 * What each story executed, recorded for the next run's selection.
 *
 * The instrument is the one `@variance-authority/sense` already uses; only the
 * transport differs, which is the rule
 * [spec 0028](https://github.com/Variance-Authority/variance-authority/blob/main/docs/specs/0028-the-instrument.md) states. The preview is
 * built with the package's addon, which adds the probes whichever builder runs
 * it ([`preset.ts`](./preset.ts)), the page counts block crossings, and this
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
  createSubjectRecorder,
  preconditionOf,
  type EvaluatingPage,
  type SubjectNote,
  type SubjectRecording,
} from '@variance-authority/sense/journal';
import { parseStoryIndex, type StoryTiming } from '@variance-authority/storybook';
import { storyIdOf } from './parameters.js';

/**
 * Where a story run's execution evidence is joined, read and kept: the shared
 * recording, with `root` also the directory a story's `importPath` is read
 * from, because it is relative to the directory Storybook ran in.
 */
export type StoryExecutionOptions = Omit<SubjectRecording, 'heads'>;

/** One run's accumulation: a window per story, written once at the end. */
export interface StoryRecorder {
  /**
   * Close one story's window.
   *
   * `complete` is false for a story this run refused. A refused story still
   * executed code, so its crossings are kept — what it may never do is justify
   * excluding itself from a later run.
   *
   * `timing` is where the page spent the story: the preview's load is the
   * story's `prepare`, 0 for a story the preview switched to, its file's
   * import its `collect`, its render its `cases`.
   */
  readonly note: (
    page: EvaluatingPage,
    subjectId: string,
    complete: boolean,
    timing?: StoryTiming,
  ) => Promise<void>;
  /**
   * Merge the run into the index, or say on stderr why it could not.
   *
   * `costs` is the run's own time for each story, by subject id: first
   * collection to decision, the figure `variance ask costs` answers and the
   * next run shards on. It is recorded as the story's duration, on its row and
   * on its case, rather than timed a second time here. A story the run did not
   * time is recorded without one.
   */
  readonly close: (costs?: ReadonlyMap<string, number>) => Promise<void>;
}

export async function createStoryRecorder(
  index: string,
  options: StoryExecutionOptions,
): Promise<StoryRecorder> {
  const ran = resolve(options.root ?? process.cwd());
  const recorder = createSubjectRecorder(
    {
      subject: 'story',
      uninstrumented:
        '`tests` is on and the Storybook preview has no execution ' +
        "collector in it — add `addons: ['@variance-authority/storybook-collector']` " +
        'to its `.storybook/main.js` and build it with `storybook build --test`, or the ' +
        'next `--since` will run everything',
    },
    options,
  );
  const root = recorder.root;
  const storyFiles = await storyFilesFrom(index, ran, root);

  return {
    note: async (page, subjectId, complete, timing) => {
      // A story read at several widths is one declaration and several cases:
      // each width executed the story on its own, and a hook that reads the
      // width took a different branch at each.
      const widened = subjectId.replace(/^story:/, '');
      const storyId = storyIdOf(subjectId);
      const story = storyFiles.get(storyId);
      const precondition =
        story === undefined ? undefined : await preconditionOf(root, story.file);
      // The index names a story by where it is declared, which is the same
      // coordinate a person reads in the sidebar and the same one a diff
      // touches. A story the driving index does not know — a subject named on
      // the command line, a preview rebuilt since — has no file to be a case
      // in, and contributes to the file-level record only.
      //
      // FIXME: the row is owned by `story:<id>` and the case by `story.file`,
      // and the case index retires the cases of a file a run finished, read off
      // the rows. No row names a story file, so no case is ever retired by a
      // run: a story removed or renamed keeps its case until its file is
      // deleted.
      await recorder.note(page, subjectId, complete, {
        ...(precondition === undefined ? {} : { preconditions: [precondition] }),
        ...(story === undefined
          ? {}
          : {
              case: {
                file: story.file,
                name: `${story.title}/${story.name}${widened.slice(storyId.length)}`,
                id: widened,
              },
            }),
        ...phasesOf(timing),
      });
    },
    close: recorder.close,
  };
}

/** A story's timing under the names the record gives a test file's phases. */
function phasesOf(timing: StoryTiming | undefined): Pick<SubjectNote, 'phases'> {
  if (timing === undefined) return {};
  const phases = {
    ...(timing.ready === undefined ? {} : { prepare: timing.ready }),
    ...(timing.collect === undefined ? {} : { collect: timing.collect }),
    ...(timing.cases === undefined ? {} : { cases: timing.cases }),
  };
  return Object.keys(phases).length === 0 ? {} : { phases };
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
