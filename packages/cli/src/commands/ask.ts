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
import { TOOLS, VANTAGE_TOOLS } from '@variance-authority/mcp/tools';
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
 * ## Two subjects, one set of questions
 *
 * A finished run is a file, so a question about it needs nothing arranged. A run
 * that is still going is memory in whatever was listening when it spoke, so a
 * question about it needs `variance watch` to have been listening and an address
 * to reach it at. `--at` is that address, defaulting to the same
 * `VARIANCE_AUTHORITY_VANTAGE` the suite was started with — the reader asks on
 * the string it already had to set.
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
  readonly query?: string;
  /** `--from <words>`: where to look, narrowing the suite before any ranking. */
  readonly from?: string;
  readonly limit?: number;
  /** `--at <address>`: a running watcher, instead of the last report. */
  readonly at?: string;
  /** The configured report. Names the directory the previous subject is kept in. */
  readonly report: string;
  /** The report to answer from — the configured one, or the shards the operator named. */
  readonly read: () => Promise<RunReport>;
  /** How a watcher is read. Injected so the live path is testable without a socket. */
  readonly look?: (at: string) => Promise<VantageReading>;
}

/** One question, answered from the artifact or the watcher. Never re-runs and never renders. */
export async function ask(request: AskRequest): Promise<string> {
  if (request.question === undefined) return questions();

  const question = questionFor(request.question);
  const input = await inputFrom(question, request);

  const answer =
    request.at !== undefined && question.live !== undefined
      ? await live(question.live, request, request.at, input)
      : await finished(question, request, input);

  return `${answer}\n`;
}

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
  const answer = tool.run(report, input, previous === undefined ? {} : { previous });

  // After the answer and only after it, which is the MCP rule verbatim: a
  // refused call must not become the thing the next diff compares against.
  await record(asked, report);
  return answer;
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
    subject: request.subject,
    subjects: request.subjects,
    component: request.component,
    rule: request.rule,
    shape: request.shape,
    test: request.test,
    state: request.state,
    file: request.file,
    query: request.query,
    from: request.from,
    limit: request.limit,
    // The one argument that is a file rather than a word, read through the same
    // validation `variance adjudicate` reads it through — an agent that declared
    // its intent badly is told so once, in one wording.
    claims: request.claims === undefined ? undefined : await readClaims(request.claims),
  });
}

/**
 * The questions, each with what it takes and what it answers.
 *
 * The tool descriptions, unedited. They are the same paragraphs an MCP client
 * puts in front of a model at `tools/list`, and a shorter gloss written here for
 * a human would be a second opinion about when to reach for each one.
 *
 * Split by subject rather than listed flat, because the two halves are not
 * alternatives a reader chooses between on taste: one needs a file that already
 * exists and the other needs a process that has to have been started first, and
 * a reader who does not know which half they are in asks the right question of
 * the wrong thing.
 *
 * Each half is printed straight off the set it mirrors rather than off
 * {@link QUESTIONS}, so a section is in the order that set chose — `self` leads
 * the live half because a reader who has just found a watcher should ask what it
 * is holding before asking anything of it.
 */
export function questions(): string {
  return [
    'Ask a question about a visual run. Each answer is the answer `variance serve` gives',
    'an MCP client for the same question, from the same function, without the client.',
    '',
    'ABOUT THE LAST RUN',
    '',
    ...TOOLS.flatMap(entry),
    'ABOUT A SUITE THAT IS STILL RUNNING',
    '',
    ...VANTAGE_TOOLS.flatMap(entry),
    'The report is the configured one unless report paths are named.',
    '`--config` and sharded reports work as they do on `variance report`.',
    `Live questions need \`--at <address>\`, which defaults to \`${VANTAGE_VARIABLE}\`;`,
    '`variance watch` starts a watcher and prints both.',
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
