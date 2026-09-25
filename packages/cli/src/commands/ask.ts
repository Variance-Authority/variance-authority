import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { RunReport } from '@variance-authority/report';
import { VANTAGE_VARIABLE } from '@variance-authority/vantage';
import type { VantageReading } from '@variance-authority/vantage/attach';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';
import { readClaims } from './adjudicate.js';
import {
  inputFor,
  questionFor,
  questionOf,
  takes,
  wrap,
  type Asked,
  type Question,
} from './asking.js';
import { HELP_TOOLS, grep, search, type Help } from '@variance-authority/help/tools';
import { sourceIndexPath } from '@variance-authority/sense';
import type { Taint } from '@variance-authority/sense/taint';
import {
  TOOLS,
  VANTAGE_TOOLS,
  readTree,
  type Tool,
  type Tree,
} from '@variance-authority/mcp/tools';
import { grepSource, readChanged, readSource, readTaint, searchSource, wholeSource } from './ask-source.js';
import { readVantage } from './watch.js';

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
 * The checkout is the third. `search`, `grep`, `symbol`, `uses`, `entrypoint`,
 * `packages` and `gaps` are the tools `@variance-authority/help` serves, and
 * they read the source tree under the working directory: what each package
 * publishes, who imports a name, where a thing somebody can only describe is
 * declared. No run has to have happened and no config has to exist, which is
 * why they answer before one is read. They are here because `locate` is here:
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

/**
 * Where the subject of the previous answer is kept, beside the report it is about.
 *
 * In the report's directory rather than a cache of this tool's own, because it is
 * a fact about *that artifact* and it should disappear with it. It is derived and
 * disposable: deleting it costs the next `diff` its comparison and nothing else.
 */
export const ASKED = 'asked.json';

export interface AskRequest {
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
  readonly file?: string;
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
  /** `--at <address>`: a running watcher, instead of the last report. */
  readonly at?: string;
  /** `--format json`: the answer as data. Only `search` answers in it. */
  readonly format?: 'json';
  /** The configured report. Names the directory the previous subject is kept in. */
  readonly report: string;
  /** The report to answer from — the configured one, or the shards the operator named. */
  readonly read: () => Promise<RunReport>;
  /** How a watcher is read. Injected so the live path is testable without a socket. */
  readonly look?: (at: string) => Promise<VantageReading>;
  /** How the checkout is read. Injected so the source path is testable without a repository. */
  readonly source?: (root: string, options?: SourceReadOptions) => Promise<Sourced>;
}

/** The flags every question is spelled with, whichever subject answers it. */
type Flagged = Pick<
  AskRequest,
  | 'subject' | 'subjects' | 'component' | 'rule' | 'shape' | 'test' | 'state' | 'file'
  | 'name' | 'package' | 'subpath' | 'query'
  | 'under' | 'above' | 'inside' | 'beside' | 'leftOf' | 'rightOf' | 'on'
  | 'from' | 'to' | 'limit'
>;

/**
 * What a question about the code takes: every flag `ask` accepts, and nothing
 * about a run. Every flag rather than the seven these tools take, so a
 * `--subject` typed at `search` is refused by name like it is everywhere else,
 * instead of being dropped on the way in and answered around.
 */
export type SourceRequest = Flagged & Pick<AskRequest, 'source' | 'changedFile' | 'taintFile' | 'format'> & {
  readonly question: string;
  readonly justAnswer?: boolean;
};

export interface SourceReadOptions {
  readonly changed?: readonly string[];
  readonly taints?: readonly Taint[];
  readonly justAnswer?: boolean;
  readonly tree?: boolean;
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
  if (request.changedFile !== undefined || request.taintFile !== undefined) {
    const flag = request.changedFile !== undefined ? '--changed-file' : '--taint-file';
    throw new OperatorError(`\`${flag}\` supplies source identity and can only be used with a source question`);
  }
  if (request.format === 'json') {
    throw new OperatorError(`\`${request.question}\` answers in text only; \`--format json\` is taken by \`search\``);
  }

  const input = await inputFrom(question, request);

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

  // Refused before anything is read: a question that has no shape to give
  // would otherwise answer in prose to a caller about to parse it.
  if (request.format === 'json' && tool.name !== search.name) {
    throw new OperatorError(`\`${request.question}\` answers in text only; \`--format json\` is taken by \`search\``);
  }
  const input = inputFor(tool, flagged(request));
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
  // `search` opens its own published file in place rather than the whole
  // value, which is most of what a large repository's question costs. The
  // answer is the tool's, over the same generation.
  const answering =
    request.source !== undefined ? await wholeSource(request.source, tool, input, reading)
    : tool.name === search.name ? await searchSource(process.cwd(), input, reading)
    : tool.name === grep.name ? await grepSource(process.cwd(), input)
    : await wholeSource(readSource, tool, input, reading);
  // A refusal is the answer here, not a crash. Every one of them names what is
  // there instead — the packages, the doors, the name one letter away — and it
  // is thrown because that is the contract the tool shares with the wire, where
  // the protocol layer turns it into `isError`. Printed as a defect with a stack
  // under it, the one useful line is the one a reader cannot find.
  try {
    const at = answering.at;
    if (request.format === 'json') {
      // The generation is carried as a field rather than a footer line, and is
      // absent when the reading could not say when it was made.
      const data = answering.data?.();
      return `${JSON.stringify({ ...data, ...(at === undefined ? {} : { generatedAt: at }) }, undefined, 2)}\n`;
    }
    const answer = answering.answer();
    return `${at === undefined ? answer : `${answer}\nSnapshot ${at}.`}\n`;
  } catch (refusal) {
    throw new OperatorError(refusal instanceof Error ? refusal.message : String(refusal), { cause: refusal });
  }
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
  return tool.run(
    reading.state,
    input,
    reading.previous === undefined ? {} : { previous: reading.previous },
  );
}

/** A question about a run that finished, asked of the report it left. */
async function finished(
  question: Question,
  request: AskRequest,
  input: Readonly<Record<string, unknown>>,
): Promise<string> {
  const tool = question.report;
  if (tool === undefined) throw noWatcher(question);

  const asked = join(dirname(request.report), ASKED);
  const report = await request.read();
  const previous = await recorded(asked);
  // A path is a fact about a tree, and this is the one side of the product that
  // is already standing in one. Read only for the questions that say they need
  // it — `wants` is the tool's answer about its own arguments — because it is a
  // walk of the repository and most questions name no path at all.
  const tree = tool.wants?.(input) === true ? await sourceTree() : undefined;
  const answer = tool.run(report, input, {
    ...(previous === undefined ? {} : { previous }),
    ...(tree === undefined ? {} : { tree }),
  });

  // After the answer and only after it, which is the MCP rule verbatim: a
  // refused call must not become the thing the next diff compares against.
  await record(asked, report);
  return answer;
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
    `\`${questionOf(question.tool)}\` is about a suite that is still running, and needs a ` +
      'watcher to ask. Start one with `variance watch`, start the suite with the ' +
      `\`${VANTAGE_VARIABLE}\` line it prints, then ask again — with \`--at <address>\`, or ` +
      `with \`${VANTAGE_VARIABLE}\` set in this shell too.`,
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

/**
 * The flags, and only the flags, off a request. Named one by one rather than
 * spread, because a request also carries what it is *about* — a report path, a
 * watcher address, a reader — and `inputFor` refuses every property it does
 * not recognise, which is the right rule for a flag and the wrong one for a
 * subject.
 */
function flagged(request: Flagged): Readonly<Record<string, unknown>> {
  return {
    subject: request.subject,
    subjects: request.subjects,
    component: request.component,
    rule: request.rule,
    shape: request.shape,
    test: request.test,
    state: request.state,
    file: request.file,
    name: request.name,
    package: request.package,
    subpath: request.subpath,
    query: request.query,
    under: request.under,
    above: request.above,
    inside: request.inside,
    beside: request.beside,
    leftOf: request.leftOf,
    rightOf: request.rightOf,
    on: request.on,
    from: request.from,
    to: request.to,
    limit: request.limit,
  };
}

/**
 * The questions, each with what it takes and what it answers.
 *
 * The tool descriptions, unedited. They are the same paragraphs an MCP client
 * puts in front of a model at `tools/list`, and a shorter gloss written here for
 * a human would be a second opinion about when to reach for each one.
 *
 * Split by subject rather than listed flat, because the three parts are not
 * alternatives a reader chooses between on taste: one needs a file that already
 * exists, one needs a process that has to have been started first, and one
 * needs only a checkout, and a reader who does not know which part they are in
 * asks the right question of the wrong thing.
 *
 * Each half is printed straight off the set it mirrors rather than off
 * {@link QUESTIONS}, so a section is in the order that set chose — `self` leads
 * the live half because a reader who has just found a watcher should ask what it
 * is holding before asking anything of it.
 */
export function questions(): string {
  return [
    'Ask about a visual run, a running suite, or the code.',
    '',
    'ABOUT THE LAST RUN',
    '',
    ...TOOLS.flatMap(entry),
    'ABOUT A SUITE THAT IS STILL RUNNING',
    '',
    ...VANTAGE_TOOLS.flatMap(entry),
    'ABOUT THE WORKSPACE SOURCE',
    '',
    ...(HELP_TOOLS as readonly Tool<Help>[]).flatMap(entry),
    'The report is the configured one unless report paths are named.',
    '`--config` and sharded reports work as they do on `variance report`.',
    `Live questions need \`--at <address>\`, which defaults to \`${VANTAGE_VARIABLE}\`;`,
    '`variance watch` starts a watcher and prints both.',
    'Source questions read the checkout under the working directory and need no config.',
    '',
  ].join('\n');
}

function entry(tool: Asked): readonly string[] {
  return [
    `${questionOf(tool)}${takes(tool)}`,
    ...wrap(tool.description, 76).map((line) => `    ${line}`),
    '',
  ];
}

/**
 * The subject of the previous answer, or nothing.
 *
 * Unreadable is the same as absent here, and only here. It is a derived file in
 * the run's own output directory, not evidence: the state it holds was written
 * by this command and can be reproduced by asking again, so refusing to answer
 * because a cache is malformed would withhold the report over the one file in
 * this system that nobody has to keep.
 */
async function recorded(path: string): Promise<RunReport | undefined> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as RunReport;
  } catch {
    return undefined;
  }
}

/**
 * Record what this answer was read from, or say that it could not be.
 *
 * Loud rather than best-effort. A silent failure here does not spoil this
 * answer; it spoils the *next* `diff`, which would then report that nothing has
 * changed since a run it never saw — and that answer arrives with nothing
 * attached to say it was built on a write that did not happen.
 */
async function record(path: string, report: RunReport): Promise<void> {
  try {
    await writeFile(path, `${JSON.stringify(report)}\n`, 'utf8');
  } catch (error) {
    throw new OperatorError(
      `the answer could not be recorded to \`${path}\`: ${messageOf(error)}. Each answer ` +
        'replaces the state `ask diff` compares against, so leaving it unwritten would let a ' +
        'later diff answer from a run nobody read.',
    );
  }
}
