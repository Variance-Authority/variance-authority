import { dirname, join, resolve } from 'node:path';
import type { RunReport } from '@variance-authority/report';
import { VANTAGE_VARIABLE } from '@variance-authority/vantage';
import type { VantageReading } from '@variance-authority/vantage/attach';
import type { Crossing } from '../ask-args.js';
import { OperatorError } from '../exit.js';
import { readClaims } from './adjudicate.js';
import { inputFor, invocationOf, questionFor, refuseWords, type Question } from './asking.js';
import { caughtUp, foundNothingAnswer, snapshotLine, unopenedLine } from '@variance-authority/help';
import { discover, grep, intersection, journeyMapTool, orient, search, slowestTests, testCompositionTool, type Help } from '@variance-authority/help/tools';
import { sourceIndexPath } from '@variance-authority/sense';
import type { Taint } from '@variance-authority/sense/taint';
import { repositoryRoot } from '@variance-authority/sense/test-selection';
import { readTree, verbOf, type CostsSubject, type Reviewed, type ReviewTool, type Tool, type Tree } from '@variance-authority/mcp/tools';
import { flagged, type Flagged } from './ask-flagged.js';
import { intersectionInput } from './ask-intersection.js';
import { ASKED, record, recorded } from './ask-previous.js';
import { questions } from './ask-questions.js';
import { type Answering, discoverSource, grepSource, intersectionSource, journeyMapSource, orientSource, readChanged, readSource, readTaint, searchSource, slowestSource, testCompositionSource, wholeSource } from './ask-source.js';
import { readingFor } from './report-source.js';
import type { Here } from './share.js';
import { readVantage } from './watch.js';

export { questions };
export { costsSubject } from './ask-costs.js';

/**
 * `variance ask` — every answer `variance serve` gives an agent, with no agent
 * protocol in the way.
 *
 * The tools in `@variance-authority/mcp` are pure functions from a subject to a
 * paragraph, and the protocol around them is framing. That framing is not free
 * to the person who has to arrange it: an MCP server is a process the client
 * launches, configured in a file that belongs to the client rather than to the
 * project, and a great many of the places this product is useful — a CI job, a
 * sandboxed agent, a container with no editor in it, somebody else's harness —
 * cannot add one. A skill can be a file in the repository, and a skill's hands
 * are the shell.
 *
 * So this command exposes the same set of questions over the same functions.
 * Not a second implementation of them: every answer here is produced by a tool
 * out of `@variance-authority/mcp`, carried on the {@link Question} the reader
 * named, so what an agent reads through a pipe and what an agent reads from a
 * terminal cannot disagree.
 *
 * ## Three subjects, one set of questions
 *
 * A finished run is a file, so a question about it needs nothing arranged. A run
 * that is still going is memory in whatever was listening when it spoke, so a
 * question about it needs `variance watch` to have been listening and an address
 * to reach it at. `--at` is that address, defaulting to the same
 * `VARIANCE_AUTHORITY_VANTAGE` the suite was started with — the reader asks on
 * the string it already had to set.
 *
 * The checkout is the third. The tools `@variance-authority/help` serves read
 * the source tree under the working directory: what each package publishes,
 * who imports a name, where a thing somebody can only describe is declared.
 * `orient` and `slowest-tests` also read the latest recording. No config has
 * to exist, which is why they answer before one is read. They are here because `locate` is here:
 * a reader with a description and no name should not have to know whether the
 * names live in a report or in the code before they can ask.
 *
 * `diff` is the one question in both sets, because it is the same function over
 * either subject: what changed since the last time anybody looked. Pointed at a
 * watcher it is the progress question; pointed at nothing it is the rerun
 * question.
 *
 * ## What is deliberately not the same
 *
 * **The state.** An MCP connection holds the previous invocation's subject in
 * memory, because it is one process for as long as the agent is asking. A
 * command line is a new process per question, so `variance_diff` would have
 * nothing to compare and would answer "first invocation" forever. For a report
 * the subject is recorded beside it, in {@link ASKED}. For a watcher it is held
 * by the watcher, which is a process that already outlives the question. The
 * lifetime is the only thing that changed; the rule is the MCP one, unaltered —
 * one value, replaced after each successful answer, never after a listing or a
 * refusal.
 *
 * **The exit code.** A question is not a verdict. `variance run` and `variance
 * report` exit `1` when something needs review because a CI step reads them, and
 * an agent asking a dozen questions in a row would read a dozen failures. Every
 * answer here exits `0`; the run's verdict stays where it was decided.
 */

export { ASKED } from './ask-previous.js';

export interface AskRequest extends Crossing {
  /** The question. Absent asks for the list of them, which is the MCP handshake. */
  readonly question?: string;
  readonly subject?: string;
  readonly subjects?: readonly string[];
  readonly component?: string;
  readonly rule?: string;
  readonly shape?: string;
  /** `--claims <path>`: the declaration, read and validated as `adjudicate` reads it. */
  readonly claims?: string;
  readonly test?: string;
  readonly state?: string;
  /** `--build <id>`: a review build, for the questions about what reviewers decided and flagged. */
  readonly build?: string;
  readonly file?: string;
  readonly files?: readonly string[];
  /** `--area <id>`: the page of the code map `orient` prints. */
  readonly area?: string;
  /** `--name <name>`, `--package <name>`, `--subpath <subpath>`: what the source questions take. */
  readonly name?: string;
  readonly package?: string;
  readonly subpath?: string;
  readonly query?: string;
  /** The relation flags: the words naming what the thing sits by. At most one. */
  readonly under?: string;
  readonly above?: string;
  readonly inside?: string;
  readonly beside?: string;
  readonly leftOf?: string;
  readonly rightOf?: string;
  /** `--on <words>`: the surface a relation question is asked on. */
  readonly on?: string;
  /** `--from <path>`: a path to start at. Answers from what it reaches, before any ranking. */
  readonly from?: string;
  /** `--to <path>`: a path to arrive at. Answers from what reaches it, the other way along the imports. */
  readonly to?: string;
  /** A newline-delimited authoritative changed-file list for source questions. */
  readonly changedFile?: string;
  /** An addition-only Sense taint table for declarative module edges. */
  readonly taintFile?: string;
  /** Use the last published source generation without inspecting the checkout. */
  readonly justAnswer?: boolean;
  readonly limit?: number;
  /** Rows a paged question skips. */
  readonly offset?: number;
  /** `--at <address>`: a running watcher, instead of the last report. */
  readonly at?: string;
  /** `--format json`: the answer as data. Only `search` answers in it. */
  readonly format?: 'json';
  /**
   * The words typed after the question, as typed. A question about a finished
   * run or about costs reads them as reports, through `read` and `costs`; a
   * question that reads no report refuses them.
   */
  readonly reports?: readonly string[];
  /** The configured report. Names the directory the previous subject is kept in, or, when a line is read in its place, the kept copy does. */
  readonly report: string;
  /** The report to answer from — the configured one, or the shards the operator named. */
  readonly read: () => Promise<RunReport>;
  /** Where the share is read from when the configured report is absent. Injected so a test need not move the process. */
  readonly here?: Here;
  /** How a watcher is read. Injected so the live path is testable without a socket. */
  readonly look?: (at: string) => Promise<VantageReading>;
  /** What each subject cost: the mainline's times, or the named reports'. Absent, `costs` is refused. */
  readonly costs?: () => Promise<CostsSubject>;
  /** What a review tool's call names, read from its deployment. Absent, every question about review is refused. */
  readonly review?: <Subject extends Reviewed>(tool: ReviewTool<Subject>, input: Readonly<Record<string, unknown>>) => Promise<Subject>;
  /** How the checkout is read. Injected so the source path is testable without a repository. */
  readonly source?: (root: string, options?: SourceReadOptions) => Promise<Sourced>;
}

/**
 * What a question about the code takes: every flag `ask` accepts, and nothing
 * about a run. Every flag rather than the seven these tools take, so a
 * `--subject` typed at `search` is refused by name like it is everywhere else,
 * instead of being dropped on the way in and answered around.
 */
export type SourceRequest = Flagged & Pick<AskRequest, 'source' | 'changedFile' | 'taintFile' | 'format' | 'reports'> & {
  readonly question: string;
  readonly justAnswer?: boolean;
};

export interface SourceReadOptions {
  readonly changed?: readonly string[];
  readonly taints?: readonly Taint[];
  readonly justAnswer?: boolean;
  readonly tree?: boolean;
  /**
   * Read a generation made now rather than reuse a recent one. Set when a
   * question was refused from a generation older than it, so the refusal is
   * given only once the checkout as it is has been read.
   */
  readonly current?: boolean;
}

/** A workspace, read once, and the tree its scan drew — folded only if a question names a path. */
export interface Sourced {
  readonly help: Help;
  readonly tree?: () => Tree | undefined;
}

/** One question, answered from the artifact or the watcher. Never re-runs and never renders. */
export async function ask(request: AskRequest): Promise<string> {
  if (request.question === undefined) return questions();

  const question = questionFor(request.question);
  if (question.source !== undefined) return askSource({ ...request, question: request.question });
  if (question.costs !== undefined) {
    const input = inputFor(question.costs, flagged(request));
    if (request.costs === undefined) throw new OperatorError('`costs` needs a config: the times are kept under its project');
    return `${question.costs.run(await request.costs(), input, invocationOf())}\n`;
  }
  if (question.review !== undefined) {
    const input = inputFor(question.review, flagged(request));
    refuseWords(question.tool, request.reports);
    if (request.review === undefined) {
      throw new OperatorError(
        `\`${request.question}\` needs a config: it names the deployment and the share token that reads it`,
      );
    }
    return `${question.review.run(await request.review(question.review, input), input, invocationOf())}\n`;
  }
  if (request.changedFile !== undefined || request.taintFile !== undefined) {
    const flag = request.changedFile !== undefined ? '--changed-file' : '--taint-file';
    throw new OperatorError(`\`${flag}\` supplies source identity and can only be used with a source question`);
  }
  if (request.format === 'json') {
    throw new OperatorError(`\`${request.question}\` answers in text only; \`--format json\` is taken by \`search\``);
  }

  // A question only a watcher answers reads no report, with a watcher or
  // without one, so the word is refused before the missing watcher is.
  if (question.report === undefined) refuseWords(question.tool, request.reports);

  const input = await inputFrom(question, request);
  if (request.at !== undefined && question.live !== undefined) unread(question, request.at, request.reports);

  const answer =
    request.at !== undefined && question.live !== undefined
      ? await live(question.live, request, request.at, input)
      : await finished(question, request, input);

  return `${answer}\n`;
}

/**
 * One question about the code, answered from the checkout under the working
 * directory. Its own entrance because `dispatch` reaches it before a config is
 * read: a repository that has never configured a visual suite still has a
 * source tree, and this is the one set of questions that is about nothing else.
 */
export async function askSource(request: SourceRequest): Promise<string> {
  const tool = questionFor(request.question).source;
  if (tool === undefined) {
    throw new OperatorError(`\`${request.question}\` is about a run, not the source; ask it of a report`);
  }
  // `intersection` is the one source question whose words are its own: each
  // is a whole question, in quotes.
  const crossing = tool.name === intersection.name;
  if (!crossing) refuseWords(tool, request.reports);

  // Refused before anything is read: a question that has no shape to give
  // would otherwise answer in prose to a caller about to parse it.
  if (request.format === 'json' && tool.name !== search.name) {
    throw new OperatorError(`\`${request.question}\` answers in text only; \`--format json\` is taken by \`search\``);
  }
  const input = crossing ? intersectionInput(request.reports ?? [], request.limit) : inputFor(tool, flagged(request));
  const changed = request.changedFile === undefined ? undefined : await readChanged(request.changedFile);
  const taints = request.taintFile === undefined ? undefined : [await readTaint(request.taintFile)];
  if (request.justAnswer === true && (changed !== undefined || taints !== undefined)) {
    throw new OperatorError('`--just-answer` reads the published source generation and cannot be combined with `--changed-file` or `--taint-file`, which request a new generation');
  }
  const reading: SourceReadOptions = {
    ...(changed === undefined ? {} : { changed }),
    ...(taints === undefined ? {} : { taints }),
    ...(request.justAnswer === true ? { justAnswer: true } : {}),
    ...(tool.wants?.(input) === true ? { tree: true } : {}),
  };
  const started = Date.now();
  const answering = await sourceAnswering(request, tool, input, reading);
  // A reading `--just-answer` asked for, or a published search opened at its
  // age, is not compared with the checkout, and every answer from it says so.
  // Every other one is the checkout's as it is by the time it refuses.
  const unseen = request.justAnswer === true || answering.unseen === true;
  // A refusal is the answer here, not a crash. Every one of them names what is
  // there instead — the packages, the doors, the name one letter away — and it
  // is thrown because that is the contract the tool shares with the wire, where
  // the protocol layer turns it into `isError`. Printed as a defect with a stack
  // under it, the one useful line is the one a reader cannot find. A name not
  // found is thrown the same way, so it is read again like a refusal, and is
  // then printed as the answer it is.
  try {
    return rendered(request, answering, unseen);
  } catch (refusal) {
    // A refusal read from what the checkout was before the question is not
    // yet a fact about the checkout: it is read again, brought up to date,
    // and that answer stands.
    // A reading nothing compared with the checkout says so under its refusal,
    // and one that could not be compared says why.
    const caught = unseen ? undefined : await caughtUp(answering.at, started, request.source === undefined ? process.cwd() : undefined, (current) => sourceAnswering(request, tool, input, { ...reading, ...(current ? { current: true } : {}) }));
    const dated = caught?.footer ?? (unseen && answering.at !== undefined ? snapshotLine(answering.at, true) : undefined);
    const footer = [dated, unopenedLine(answering.unopened, !unseen)].filter((line) => line !== undefined).join('\n');
    const said = footer === '' ? '' : `\n\n${footer}`;
    if (caught?.subject === undefined) {
      // A name not found is an answer, dated like any other, once nothing newer can be read.
      const found = foundNothingAnswer(refusal, caught, answering.at, unseen);
      if (found !== undefined) return foundNothing(found, unopenedLine(answering.unopened, !unseen));
      throw refused(refusal, said);
    }
    try {
      return rendered(request, caught.subject, false);
    } catch (still) {
      const found = foundNothingAnswer(still, caught, caught.subject.at, false);
      if (found !== undefined) return foundNothing(found, unopenedLine(caught.subject.unopened, true));
      throw refused(still, said);
    }
  }
}

function refused(refusal: unknown, footer: string): OperatorError {
  return new OperatorError(`${refusal instanceof Error ? refusal.message : String(refusal)}${footer}`, { cause: refusal });
}

/** A name the last reading did not find, written as `rendered` writes an answer: the text, then the lines under it. */
function foundNothing(answer: string, said: string | undefined): string {
  return `${said === undefined ? answer : `${answer}\n${said}`}\n`;
}

/** The reader each source question is answered from. */
async function sourceAnswering(request: SourceRequest, tool: Tool<Help>, input: Readonly<Record<string, unknown>>, reading: SourceReadOptions): Promise<Answering> {
  // `search` opens its own published file in place rather than the whole
  // value, which is most of what a large repository's question costs. The
  // answer is the tool's, over the same generation.
  return request.source !== undefined ? await wholeSource(request.source, tool, input, reading)
    : tool.name === search.name ? await searchSource(process.cwd(), input, reading)
    : tool.name === grep.name ? await grepSource(process.cwd(), input)
    : tool.name === discover.name ? await discoverSource(process.cwd(), input)
    : tool.name === intersection.name ? await intersectionSource(process.cwd(), input, reading)
    : tool.name === orient.name ? orientSource(process.cwd(), input)
    : tool.name === slowestTests.name ? slowestSource(process.cwd(), input)
    : tool.name === journeyMapTool.name ? journeyMapSource(process.cwd(), input)
    : tool.name === testCompositionTool.name ? testCompositionSource(process.cwd(), input)
    : await wholeSource(readSource, tool, input, reading);
}

function rendered(request: SourceRequest, answering: Answering, unseen: boolean): string {
  const at = answering.at;
  if (request.format === 'json') {
    // The generation is carried as a field rather than a footer line, and is
    // absent when the reading could not say when it was made.
    const data = answering.data?.();
    const unopened = answering.unopened === undefined ? {} : { unopened: answering.unopened };
    return `${JSON.stringify({ ...data, ...(at === undefined ? {} : { generatedAt: at, ...(unseen ? { compared: false } : {}) }), ...unopened }, undefined, 2)}\n`;
  }
  const answer = answering.answer();
  const dated = at === undefined ? answer : `${answer}\n${snapshotLine(at, unseen)}`;
  const said = unopenedLine(answering.unopened, !unseen);
  return `${said === undefined ? dated : `${dated}\n${said}`}\n`;
}

/**
 * The workspace, through the same scan index a run's selection writes.
 *
 * The arrows the reading draws are kept for a question that names a path, so
 * `search --from` folds a tree from what was already scanned rather than walking
 * the repository a second time — the same arrangement the standalone
 * `variance-authority-help` binary makes, from the same cache.
 */
/** A question about a suite that is still going, asked of the process holding it. */
async function live(
  tool: NonNullable<Question['live']>,
  request: AskRequest,
  at: string,
  input: Readonly<Record<string, unknown>>,
): Promise<string> {
  // The watcher rotates its own previous reading as it hands this one over, so
  // there is nothing to record here and nothing left behind when this exits.
  const reading = await (request.look ?? readVantage)(at);
  // `file` is a path, and a terminal, unlike the watcher, has a directory `./x` is read from.
  const file = input['file'];
  const asked = typeof file === 'string' && file !== '' ? { ...input, file: resolve(file) } : input;
  return tool.run(reading.state, asked, invocationOf({
    ...(reading.previous === undefined ? {} : { previous: reading.previous }),
    root: repositoryRoot(process.cwd()),
  }));
}

/** A question about a run that finished, asked of the report it left. */
async function finished(
  question: Question,
  request: AskRequest,
  input: Readonly<Record<string, unknown>>,
): Promise<string> {
  const tool = question.report;
  if (tool === undefined) throw noWatcher(question);

  // Read first: a report fetched from the share keeps its subject beside the
  // fetched copy, never beside `config.report`, where it would outlive nothing.
  const { report, path, says } = await readingFor(request, input);
  const asked = join(dirname(path), ASKED);
  const previous = await recorded(asked);
  // A path is a fact about a tree, and this is the one side of the product that
  // is already standing in one. Read only for the questions that say they need
  // it — `wants` is the tool's answer about its own arguments — because it is a
  // walk of the repository and most questions name no path at all.
  const tree = tool.wants?.(input) === true ? await sourceTree() : undefined;
  const answer = tool.run(report, input, invocationOf({
    ...(previous === undefined ? {} : { previous }),
    ...(tree === undefined ? {} : { tree }),
  }));

  // After the answer and only after it, which is the MCP rule verbatim: a
  // refused call must not become the thing the next diff compares against.
  await record(asked, report);
  return says === undefined ? answer : `${says}\n\n${answer}`;
}

/**
 * The tree under the working directory, through the run's own scan index.
 *
 * The same index a run's selection scan writes, so a question asked after a run
 * costs a map lookup per unchanged file rather than a parse of the repository.
 *
 * A tree that cannot be read is not fatal here: `scopeOf` refuses a start point
 * it has no tree for, in the sentence a reader can act on, and the questions
 * that name no path are unaffected. What must never happen is the other thing —
 * falling back to the paths the run recorded and answering as though a tree had
 * been read.
 */
async function sourceTree(): Promise<Tree | undefined> {
  const root = process.cwd();
  try {
    return await readTree({ root, index: sourceIndexPath(root) });
  } catch {
    return undefined;
  }
}

/**
 * A live question asked with nowhere to ask it.
 *
 * The one refusal on this path, because a live question that reached the report
 * arm reached it for one reason: no address. Being told what is missing is the
 * whole of the help — nothing about `run-signals` says it needs a process to
 * have been started before the suite was, and a reader who has only ever asked
 * about reports has no reason to expect it.
 */
function noWatcher(question: Question): OperatorError {
  return new OperatorError(
    `\`${verbOf(question.tool)}\` is about a suite that is still running, and needs a ` +
      'watcher to ask. Start one with `variance watch`, start the suite with the ' +
      `\`${VANTAGE_VARIABLE}\` line it prints, then ask again — with \`--at <address>\`, or ` +
      `with \`${VANTAGE_VARIABLE}\` set in this shell too.`,
  );
}

/**
 * Refuse a report typed after a question a watcher answers, when the question
 * also reads a finished run — `diff`, which would read the word as a report
 * without the watcher — so the refusal says the watcher is why it went unread.
 */
function unread(question: Question, at: string, reports: readonly string[] | undefined): void {
  const word = reports?.[0];
  if (word === undefined) return;
  throw new OperatorError(
    `\`${word}\` is a report, and \`variance ask ${verbOf(question.tool)}\` was asked of the ` +
      `watcher at \`${at}\`, which reads none. Ask without \`--at\`, and without ` +
      `\`${VANTAGE_VARIABLE}\` set, to read the report.`,
  );
}

/** The flags the reader gave, keyed as the tool's schema names them. */
async function inputFrom(
  question: Question,
  request: AskRequest,
): Promise<Readonly<Record<string, unknown>>> {
  return inputFor(question.tool, {
    ...flagged(request),
    // The one argument that is a file rather than a word, read through the same
    // validation `variance adjudicate` reads it through — an agent that declared
    // its intent badly is told so once, in one wording.
    claims: request.claims === undefined ? undefined : await readClaims(request.claims),
  });
}
