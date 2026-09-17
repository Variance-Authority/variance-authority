import { TOOLS, VANTAGE_TOOLS, type Tool } from '@variance-authority/mcp/tools';
import { OperatorError } from '../exit.js';

/**
 * The catalogue behind `variance ask`: which questions exist, what each takes,
 * and how a reader is told when they have typed one wrong.
 *
 * Its own module because it is the half that must not be *written*. Every fact
 * here is read off the tools themselves — the set of questions, the flags each
 * accepts, which of them are required, whether a question is about a finished
 * run or a running one — so a tool added to `@variance-authority/mcp` arrives on
 * the command line already asked, already documented, and already refusing the
 * arguments it does not take.
 *
 * The alternative was a table, and a table is short by one the day a tool is
 * added: the CLI would keep working and would quietly be a smaller product than
 * the connection, in the direction nobody checks. The only thing declared here
 * is how a placeholder is spelled, which is cosmetic — a property nobody has
 * spelled yet prints `<value>` and still works.
 */

const PREFIX = 'variance_';

/** The part of a tool this module reads. Not `Tool`, which would drag a subject in. */
export type Asked = Pick<Tool, 'name' | 'description' | 'inputSchema'>;

/**
 * The question a tool answers, as somebody types it.
 *
 * One rule for all of them rather than a table, so a tool added to the MCP set
 * arrives here already asked, and no second list can be short by one.
 */
export function questionOf(tool: Asked): string {
  return tool.name.slice(PREFIX.length).replace(/_/g, '-');
}

/** A tool that answers about a suite still running, as `VANTAGE_TOOLS` types it. */
type LiveTool = (typeof VANTAGE_TOOLS)[number];

/**
 * One question, and the tool that answers it about each subject.
 *
 * Two fields rather than one enum, because `diff` is genuinely both: the same
 * function compares a report with the last report read and a watcher with the
 * last reading taken, and which one a reader means is decided by whether they
 * pointed at a watcher. Every other question is one or the other.
 *
 * They hold the tools rather than flags saying a tool exists, so the check that
 * routes a question is the same check that produces its answer. A question with
 * no `report` cannot be looked up against a report by mistake, because there is
 * nothing there to look up.
 */
export interface Question {
  readonly tool: Asked;
  /** Asked of a run that finished, or absent when nothing answers that about it. */
  readonly report?: Tool;
  /** Asked of a suite that is still running, or absent when it is not that kind of question. */
  readonly live?: LiveTool;
}

/** Every question, each knowing which subjects it answers about. */
export const QUESTIONS: readonly Question[] = questionsOf();

function questionsOf(): readonly Question[] {
  const found = new Map<string, Question>();

  for (const tool of TOOLS) found.set(tool.name, { tool, report: tool });
  for (const tool of VANTAGE_TOOLS) {
    const already = found.get(tool.name)?.report;
    found.set(tool.name, { tool, ...(already === undefined ? {} : { report: already }), live: tool });
  }

  return [...found.values()];
}

/** The question by that name, or the refusal naming the ones that exist. */
export function questionFor(asked: string): Question {
  const found = QUESTIONS.find((question) => questionOf(question.tool) === asked);
  if (found !== undefined) return found;

  throw new OperatorError(
    `\`${asked}\` is not a question; there is ` +
      `${QUESTIONS.map((question) => questionOf(question.tool)).join(', ')}. Run \`variance ask\` ` +
      'with no question for what each one answers.',
  );
}

/** One argument a question takes, in the spelling a reader has to type. */
export interface Argument {
  readonly flag: string;
  readonly property: string;
  readonly placeholder: string;
  readonly required: boolean;
  /** How the text on the command line becomes the value the tool is given. */
  readonly kind: 'text' | 'list' | 'number';
}

/**
 * How each argument is spelled in a synopsis.
 *
 * The one declared thing in this module, and deliberately keyed by property
 * rather than by tool: two questions taking a `subject` are taking the same kind
 * of thing, and a reader who has seen `<id>` once should not have to decide
 * whether the second one means something else. A property nobody has listed
 * falls back to its type, so this being out of date costs a word and not a flag.
 */
const PLACEHOLDER: Readonly<Record<string, string>> = {
  subject: '<id>',
  subjects: '<id>[,...]',
  component: '<name>',
  rule: '<id>',
  shape: '<digest>',
  claims: '<path>',
  test: '<id>',
  state: '<state>',
  file: '<text>',
  query: '<words>',
  from: '<path>',
  to: '<path>',
  limit: '<n>',
};

/** What a question takes, read off its own schema. */
export function argumentsOf(tool: Asked): readonly Argument[] {
  const declared = tool.inputSchema['properties'];
  if (typeof declared !== 'object' || declared === null) return [];
  const wanted = requiredOf(tool);

  return Object.entries(declared).map(([property, schema]) => {
    const kind = kindOf(schema);
    return {
      flag: `--${property.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`)}`,
      property,
      placeholder: PLACEHOLDER[property] ?? fallback(kind),
      required: wanted.includes(property),
      kind,
    };
  });
}

function kindOf(schema: unknown): Argument['kind'] {
  const type =
    typeof schema === 'object' && schema !== null
      ? (schema as Record<string, unknown>)['type']
      : undefined;
  if (type === 'array') return 'list';
  if (type === 'integer' || type === 'number') return 'number';
  return 'text';
}

function fallback(kind: Argument['kind']): string {
  if (kind === 'list') return '<value>[,...]';
  return kind === 'number' ? '<n>' : '<value>';
}

function requiredOf(tool: Asked): readonly string[] {
  const declared = tool.inputSchema['required'];
  return Array.isArray(declared) ? declared.filter((entry) => typeof entry === 'string') : [];
}

/** What a question accepts, as it appears after the question in a listing. */
export function takes(tool: Asked): string {
  const flags = argumentsOf(tool).map((argument) =>
    argument.required
      ? `${argument.flag} ${argument.placeholder}`
      : `[${argument.flag} ${argument.placeholder}]`,
  );
  return flags.length === 0 ? '' : `  ${flags.join(' ')}`;
}

/**
 * The arguments this question takes, refusing the ones it does not.
 *
 * Refused rather than ignored, for the reason the flag parser refuses an unknown
 * flag: `variance ask summary --subject story:card` reads, to whoever typed it,
 * as a question about that subject, and answering the whole suite instead is the
 * failure that survives review because the output looks right.
 *
 * `given` is keyed by property rather than by flag so the caller can resolve a
 * value however it needs to — one of these is a file that has to be read and
 * validated before it is an argument at all.
 */
export function inputFor(
  tool: Asked,
  given: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const accepted = argumentsOf(tool);
  const input: Record<string, unknown> = {};

  for (const [property, value] of Object.entries(given)) {
    if (value === undefined) continue;
    const argument = accepted.find((entry) => entry.property === property);
    if (argument === undefined) {
      throw new OperatorError(
        `\`--${property}\` is not an argument \`variance ask ${questionOf(tool)}\` takes; it ` +
          `takes ${accepted.length === 0 ? 'none' : accepted.map((entry) => entry.flag).join(', ')}`,
      );
    }
    input[property] = value;
  }

  const missing = accepted.filter(
    (argument) => argument.required && input[argument.property] === undefined,
  );
  if (missing.length > 0) {
    throw new OperatorError(
      `\`variance ask ${questionOf(tool)}\` needs ` +
        `${missing.map((argument) => argument.flag).join(' and ')}. Ask \`summary\` or ` +
        '`changes` first for a finished run, or `run-signals` for one still going; each prints ' +
        'the ids the narrower questions take.',
    );
  }

  return input;
}

/** Greedy, on spaces, and nothing else. The descriptions are prose, not layout. */
export function wrap(text: string, width: number): readonly string[] {
  const lines: string[] = [];

  for (const word of text.split(/\s+/)) {
    const last = lines[lines.length - 1];
    if (last === undefined || last.length + 1 + word.length > width) lines.push(word);
    else lines[lines.length - 1] = `${last} ${word}`;
  }

  return lines;
}
