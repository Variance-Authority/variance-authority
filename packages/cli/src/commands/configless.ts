/**
 * The commands that answer before `variance.config.json` is read.
 *
 * `loadConfig` refuses when the file is not there, and it is right to: a run
 * that guessed its subjects would be observing something nobody chose. These
 * are the exceptions, and each is an exception for its own reason rather than
 * as a convenience, so they are collected here where the reasons can be read
 * together instead of accumulating at the top of `dispatch`.
 *
 * They arrive in two shapes and the split is a typing fact as much as a
 * narrative one. `constantAnswer` covers three *arguments* — `comment --marker`,
 * an `ask` with no question, and an `ask` whose question is about the source —
 * whose commands otherwise go on to load a config like any other.
 * `withoutConfig` covers thirteen whole commands, and narrows them out of the
 * union so that what is left in `dispatch` is exactly the set that has a
 * `--config` to read. `usage.ts` states the same fact from
 * the other side: `CONFIGLESS` is what keeps the flag off them, so a command
 * added to one list and not the other is offered a flag it will ignore.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { EXIT_CLEAN, OperatorError, type ExitCode } from '../exit.js';
import type { Parsed } from '../parse.js';
import type { Detach } from './index-follow-ups.js';

/** The thirteen commands that read no project configuration at all. */
export type Configless = Extract<
  Parsed,
  { command: 'watch' | 'distill' | 'covering' | 'coverage' | 'layers' | 'restrictions' | 'review' | 'story' | 'index' | 'select' | 'shards' | 'reach' | 'prune' }
>;

export function withoutConfig(parsed: Parsed): parsed is Configless {
  return (
    parsed.command === 'watch'
    || parsed.command === 'distill'
    || parsed.command === 'covering'
    || parsed.command === 'coverage'
    || parsed.command === 'layers'
    || parsed.command === 'restrictions'
    || parsed.command === 'review'
    || parsed.command === 'story'
    || parsed.command === 'index'
    || parsed.command === 'select'
    || parsed.command === 'shards'
    || parsed.command === 'reach'
    || parsed.command === 'prune'
  );
}

/**
 * What answers before the project is read, for the three arguments that ask it to.
 *
 * Two are constants this build carries rather than readings of anything. The
 * poster needs the marker in exactly the case where there is no body to find it
 * in — a clean run, where the previous docket has to be located and cleared; and
 * an agent finding out what it may ask has not reached a run to ask about, so
 * answering it with the config would be a refusal to hold a conversation on the
 * grounds that there is nothing to say yet.
 *
 * The third is a reading, of the one subject a config says nothing about. A
 * question about the source — what a package publishes, who imports a name —
 * is asked of the checkout under the working directory, and a checkout is
 * there whether or not anybody configured a visual suite in it. Refusing it for
 * want of `variance.config.json` would send a reader to write a file that has
 * no bearing on the answer.
 */
export async function constantAnswer(
  parsed: Parsed,
  streams: { out(text: string): void },
): Promise<ExitCode | undefined> {
  if (parsed.command === 'comment' && parsed.marker) {
    const { COMMENT_MARKER } = await import('./comment.js');
    streams.out(`${COMMENT_MARKER}\n`);
    return EXIT_CLEAN;
  }
  if (parsed.command !== 'ask') return undefined;
  const [{ askSource, questions }, { questionFor }] = await Promise.all([import('./ask.js'), import('./asking.js')]);
  if (parsed.question === undefined) {
    streams.out(questions());
    return EXIT_CLEAN;
  }
  if (questionFor(parsed.question).source !== undefined) {
    streams.out(await askSource({ ...parsed, question: parsed.question }));
    return EXIT_CLEAN;
  }
  return undefined;
}

/** Run one of them, each of which is about a suite rather than a project. */
export async function answerConfigless(
  parsed: Configless,
  streams: { out(text: string): void; err(text: string): void; detach?: Detach },
): Promise<ExitCode> {
  switch (parsed.command) {
    // A watcher is about a suite, not about a project: it listens, holds what a
    // run says, and answers. Loading a config first would make it unstartable in
    // the directories somebody most wants to start one from — somebody else's
    // repository, a container, a checkout with no visual suite configured at all.
    case 'watch': {
      const { watch, watching: watchingLines } = await import('./watch.js');
      const watching = await watch();
      streams.out(watchingLines(watching.address));
      await watching.until;
      await watching.close();
      return EXIT_CLEAN;
    }

    // Evidence named on the command line, and nothing else consulted: the paths
    // are the whole input, so a project that has never configured this tool can
    // still be handed a pair of files somebody else recorded.
    case 'distill': {
      const { distillFiles, formatDistill } = await import('./distill.js');
      streams.out(formatDistill(await distillFiles(parsed), parsed.format));
      return EXIT_CLEAN;
    }

    // `distill`'s reason again, with the path made optional. The index this
    // reads is written where a recorded run puts it, so the question an agent
    // asks most — which tests entered the line I am about to change — is one
    // flag long and needs nothing configured. Naming the file is still allowed,
    // for the run that happened somewhere else.
    case 'covering': {
      const { coveringAnswer, formatCoveringAnswer } = await import('./covering-suites.js');
      try {
        streams.out(formatCoveringAnswer(await coveringAnswer(parsed), parsed.format));
      } catch (error) {
        // A program reading JSON is told which refusal this is on the stream it
        // parses; the sentence still goes to stderr, for the person.
        if (parsed.format === 'json' && error instanceof OperatorError && error.kind !== undefined) {
          streams.out(`${JSON.stringify({ refused: error.kind })}\n`);
        }
        throw error;
      }
      return EXIT_CLEAN;
    }

    // `covering`'s reason, counted over every region the suites loaded: the
    // records are where the runs put them, and a pull request's base is the
    // one its mainline published. The ratio decides nothing, so the exit is
    // clean whatever it says (ADR-0081).
    // `layers` observes and never gates: the exit is clean whatever moved.
    case 'layers': {
      const { layersOutput } = await import('./layers-command.js');
      streams.out(layersOutput(parsed));
      return EXIT_CLEAN;
    }

    // A fence: the exit is `1` when an import breaks a rule someone wrote.
    case 'restrictions': {
      const { restrictionsOutput } = await import('./restrictions-command.js');
      const said = await restrictionsOutput(parsed);
      streams.out(said.out);
      return said.code;
    }

    case 'coverage': {
      const [{ coverage }, { formatCoverage }] = await Promise.all([import('./coverage.js'), import('./coverage-text.js')]);
      try {
        streams.out(formatCoverage(await coverage(parsed), parsed.format));
      } catch (error) {
        if (parsed.format === 'json' && error instanceof OperatorError && error.kind !== undefined) {
          streams.out(`${JSON.stringify({ refused: error.kind })}\n`);
        }
        throw error;
      }
      return EXIT_CLEAN;
    }

    // `covering`'s reason, asked of the whole change at once and after the
    // suite: the recording and the list of runs beside it are where the run put
    // them. `--out` keeps the answer as files, because a workflow uploads it and
    // comments with it in steps that do not share this process's output.
    case 'review': {
      const [{ reviewWithCoverage }, { REVIEW_ARTIFACT, reviewFromRun }, { formatReview }] = await Promise.all([
        import('./review-evidence.js'),
        import('./review-from-run.js'),
        import('./review-text.js'),
      ]);
      if (parsed.fromRun !== undefined) {
        streams.out(formatReview(await reviewFromRun({ run: parsed.fromRun, artifact: parsed.artifact ?? REVIEW_ARTIFACT, root: parsed.root }), parsed.format));
        return EXIT_CLEAN;
      }
      const answer = await reviewWithCoverage(parsed);
      if (parsed.out !== undefined) {
        await mkdir(parsed.out, { recursive: true });
        // FIXME: review.json is unbounded — every moved region carries its cases in full, and a change that moves
        // most of a suite's regions writes hundreds of megabytes (430 MB on a pull request's CI run).
        await writeFile(join(parsed.out, 'review.json'), formatReview(answer, 'json'));
        await writeFile(join(parsed.out, 'review.md'), formatReview(answer, 'markdown'));
      }
      streams.out(formatReview(answer, parsed.format));
      return EXIT_CLEAN;
    }

    // `covering`'s reason, for one case instead of one line: a run writes the
    // story beside its recording when the variable asks, and whoever reads it
    // may be an agent in a checkout that configured this tool for nothing but
    // its test seam.
    case 'story': {
      const { formatStory, story } = await import('./story.js');
      streams.out(formatStory(story(parsed), parsed.format));
      return EXIT_CLEAN;
    }

    // The step before `select` and `reach`, in the same repository and for the
    // same reason: it publishes what they read, and a pipeline that runs them
    // may have configured this tool for nothing else.
    case 'index': {
      const { followUpsOutput, indexOutput } = await import('./index-command.js');
      const request = { cwd: process.cwd(), ...(parsed.noGit ? { noGit: true } : {}) };
      const waiting = (text: string): void => streams.err(text);
      if (parsed.followUps) streams.out(await followUpsOutput({ ...request, waiting }));
      else streams.out(await indexOutput({ ...request, waiting, ...(parsed.wait || streams.detach === undefined ? {} : { detach: streams.detach }) }));
      return EXIT_CLEAN;
    }

    // `watch`'s reason, one step further out. This one is asked *by somebody
    // else's runner* — a plain `vitest`, a `jest`, a CI shell script — in a
    // repository that may have configured this tool for nothing else, and a
    // refusal to answer without a config would make the execution journal
    // unreachable from exactly the suites it was recorded from.
    //
    // Two streams, and the split is the safety property: stdout carries the skip
    // list and nothing else, so a command substitution cannot pick up a sentence
    // and hand it to a runner as a path; the explanation — including an
    // unmissable one when nothing was skipped — goes to stderr beside whatever
    // the runner prints next. `0` either way. An empty skip list is the answer
    // "run everything", which is a correct answer and not a failure.
    case 'select': {
      const { selectOutput } = await import('./select-command.js');
      const said = await selectOutput({
        cwd: process.cwd(),
        format: parsed.format,
        ...(parsed.since === undefined ? {} : { since: parsed.since }),
        ...(parsed.noGit ? { noGit: true } : {}),
        ...(parsed.execution === undefined ? {} : { execution: parsed.execution }),
        ...(parsed.suite === undefined ? {} : { suite: parsed.suite }),
        ...(parsed.diff === undefined ? {} : { diff: parsed.diff }),
        ...(parsed.atDistance === undefined ? {} : { atDistance: parsed.atDistance }),
      });
      streams.err(said.err);
      streams.out(said.out);
      return EXIT_CLEAN;
    }

    // `select`'s reason: asked by a CI job planning the shards a seam's runner
    // splits by, in a repository that may configure this tool for nothing else.
    case 'shards': {
      const { shardsOutput } = await import('./shards-command.js');
      const { suite, since, setup, budget, max, workers, unrecorded, format } = parsed;
      streams.out(await shardsOutput({
        cwd: process.cwd(),
        setup,
        format,
        ...(suite === undefined ? {} : { suite }),
        ...(since === undefined ? {} : { since }),
        ...(budget === undefined ? {} : { budget }),
        ...(max === undefined ? {} : { max }),
        ...(workers === undefined ? {} : { workers }),
        ...(unrecorded === undefined ? {} : { unrecorded }),
      }));
      return EXIT_CLEAN;
    }

    // `select`'s reason, with the streams carrying opposite risks. A skip list
    // that comes out short costs a suite; this list comes out as the suite, and
    // an empty one piped into `xargs` runs nothing and looks like a fast green
    // build. So `reach` has no short answer: either stdout holds every file the
    // diff reaches — the changed files among them, always — or the command
    // failed and wrote nothing at all.
    case 'reach': {
      const { reachOutput } = await import('./reach-command.js');
      const said = await reachOutput({
        cwd: process.cwd(),
        since: parsed.since,
        format: parsed.format,
        ...(parsed.wholeFiles ? { wholeFiles: true } : {}),
        ...(parsed.noGit ? { noGit: true } : {}),
      });
      streams.err(said.err);
      streams.out(said.out);
      return EXIT_CLEAN;
    }

    // The cache is the repository's, named by its root config or by
    // `VARIANCE_AUTHORITY_CACHE`, and a checkout whose tests another runner
    // records has it whether or not a visual suite is configured.
    case 'prune': {
      const { pruneOutput } = await import('./prune-cache.js');
      const { text, exit } = await pruneOutput();
      streams.out(text);
      return exit;
    }
  }
}
