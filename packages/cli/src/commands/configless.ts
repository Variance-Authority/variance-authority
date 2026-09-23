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
 * `withoutConfig` covers five whole commands, and narrows them out of the
 * union so that what is left in `dispatch` is exactly the set that has a
 * `--config` to read. `usage.ts` states the same fact from
 * the other side: `CONFIGLESS` is what keeps the flag off them, so a command
 * added to one list and not the other is offered a flag it will ignore.
 */

import { EXIT_CLEAN, type ExitCode } from '../exit.js';
import type { Parsed } from '../parse.js';
import { askSource, questions } from './ask.js';
import { questionFor } from './asking.js';
import { COMMENT_MARKER } from './comment.js';
import { covering, formatCovering } from './covering.js';
import { distillFiles, formatDistill } from './distill.js';
import { reachOutput } from './reach-command.js';
import { selectOutput } from './select-command.js';
import { watch, watching as watchingLines } from './watch.js';

/** The five commands that read no project configuration at all. */
export type Configless = Extract<
  Parsed,
  { command: 'watch' | 'distill' | 'covering' | 'select' | 'reach' }
>;

export function withoutConfig(parsed: Parsed): parsed is Configless {
  return (
    parsed.command === 'watch'
    || parsed.command === 'distill'
    || parsed.command === 'covering'
    || parsed.command === 'select'
    || parsed.command === 'reach'
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
    streams.out(`${COMMENT_MARKER}\n`);
    return EXIT_CLEAN;
  }
  if (parsed.command === 'ask' && parsed.question === undefined) {
    streams.out(questions());
    return EXIT_CLEAN;
  }
  if (
    parsed.command === 'ask' &&
    parsed.question !== undefined &&
    questionFor(parsed.question).source !== undefined
  ) {
    streams.out(await askSource({ ...parsed, question: parsed.question }));
    return EXIT_CLEAN;
  }
  return undefined;
}

/** Run one of the three, each of which is about a suite rather than a project. */
export async function answerConfigless(
  parsed: Configless,
  streams: { out(text: string): void; err(text: string): void },
): Promise<ExitCode> {
  switch (parsed.command) {
    // A watcher is about a suite, not about a project: it listens, holds what a
    // run says, and answers. Loading a config first would make it unstartable in
    // the directories somebody most wants to start one from — somebody else's
    // repository, a container, a checkout with no visual suite configured at all.
    case 'watch': {
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
      streams.out(formatDistill(await distillFiles(parsed), parsed.format));
      return EXIT_CLEAN;
    }

    // `distill`'s reason again, with the path made optional. The index this
    // reads is written where a recorded run puts it, so the question an agent
    // asks most — which tests entered the line I am about to change — is one
    // flag long and needs nothing configured. Naming the file is still allowed,
    // for the run that happened somewhere else.
    case 'covering': {
      streams.out(formatCovering(await covering(parsed), parsed.format));
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
      const said = await selectOutput({
        cwd: process.cwd(),
        format: parsed.format,
        ...(parsed.since === undefined ? {} : { since: parsed.since }),
        ...(parsed.noGit ? { noGit: true } : {}),
        ...(parsed.execution === undefined ? {} : { execution: parsed.execution }),
        ...(parsed.diff === undefined ? {} : { diff: parsed.diff }),
      });
      streams.err(said.err);
      streams.out(said.out);
      return EXIT_CLEAN;
    }

    // `select`'s reason, with the streams carrying opposite risks. A skip list
    // that comes out short costs a suite; this list comes out as the suite, and
    // an empty one piped into `xargs` runs nothing and looks like a fast green
    // build. So `reach` has no short answer: either stdout holds every file the
    // diff reaches — the changed files among them, always — or the command
    // failed and wrote nothing at all.
    case 'reach': {
      const said = await reachOutput({
        cwd: process.cwd(),
        since: parsed.since,
        format: parsed.format,
        ...(parsed.noGit ? { noGit: true } : {}),
      });
      streams.err(said.err);
      streams.out(said.out);
      return EXIT_CLEAN;
    }
  }
}
