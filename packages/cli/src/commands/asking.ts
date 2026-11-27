import { didYouMean } from '@variance-authority/core';
import { HELP_TOOLS, type Help } from '@variance-authority/help/tools';
import {
  COSTS_TOOLS,
  REVIEW_TOOLS,
  TOOLS,
  VANTAGE_TOOLS,
  flagOf,
  verbOf,
  type CostsSubject,
  type ReviewTool,
  type Tool,
  type ToolInvocation,
} from '@variance-authority/mcp/tools';
import type { Unknown } from '../args.js';
import { OperatorError } from '../exit.js';
import { PLACEHOLDER } from '../placeholder.js';

/**
 * The catalogue behind `variance ask`: which questions exist, what each takes,
 * and how a reader is told when they have typed one wrong.
 *
 * Its own module because it is the half that must not be *written*. Every fact
 * here is read off the tools themselves — the set of questions, the flags each
 * accepts, which of them are required, whether a question is about a finished
 * run, a running one or the source tree — so a tool added to
 * `@variance-authority/mcp` or `@variance-authority/help` arrives on the command
 * line already asked, already documented, and already refusing the arguments it
 * does not take.
 *
 * The alternative was a table, and a table is short by one the day a tool is
 * added: the CLI would keep working and would quietly be a smaller product than
 * the connection, in the direction nobody checks. The only thing declared here
 * is how a placeholder is spelled, which is cosmetic — a property nobody has
 * spelled yet prints `<value>` and still works.
 */

/** The part of a tool this module reads. Not `Tool`, which would drag a subject in. */
export type Asked = Pick<Tool, 'name' | 'description' | 'inputSchema'>;

/** A tool that answers about a suite still running, as `VANTAGE_TOOLS` types it. */
type LiveTool = (typeof VANTAGE_TOOLS)[number];

/**
 * One question, and the tool that answers it about each subject.
 *
 * Three fields rather than one enum, because `diff` is genuinely two of them:
 * the same function compares a report with the last report read and a watcher
 * with the last reading taken, and which one a reader means is decided by
 * whether they pointed at a watcher. Every other question is exactly one.
 *
 * The third subject is the checkout itself. `search`, `symbol` and the rest
 * read what the workspace publishes and exports, which is a fact about the
 * source tree and not about any run — so they need no report, no watcher and
 * no config, and sit beside `locate` because a reader looking for a thing they
 * can only describe should not have to know which binary holds the names.
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
  /** Asked of the workspace source, or absent when it is not a question about the code. */
  readonly source?: Tool<Help>;
  /** Asked of the times a run recorded, or absent when it is not a question about cost. */
  readonly costs?: Tool<CostsSubject>;
  /** Asked of what review settled, or absent when it is not a question about review. */
  readonly review?: ReviewTool;
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
  for (const tool of HELP_TOOLS) found.set(tool.name, { tool, source: tool });
  for (const tool of COSTS_TOOLS) found.set(tool.name, { tool, costs: tool });
  for (const tool of REVIEW_TOOLS) found.set(tool.name, { tool, review: tool });

  return [...found.values()];
}

/** The question by that name, or the refusal naming the ones that exist. */
export function questionFor(asked: string): Question {
  const found = QUESTIONS.find((question) => verbOf(question.tool) === asked);
  if (found !== undefined) return found;

  // The names are not listed here: `variance ask` lists them with what each answers.
  const names = QUESTIONS.map((question) => verbOf(question.tool));
  throw new OperatorError(`\`${asked}\` is not a question.${didYouMean(asked, names)}\n\`variance ask\` lists them.`);
}

/** One argument a question takes, in the spelling a reader has to type. */
export interface Argument {
  readonly flag: string;
  readonly property: string;
  readonly placeholder: string;
  readonly required: boolean;
  /**
   * How the text on the command line becomes the value the tool is given. A
   * list of questions is typed as words after the question, each in quotes,
   * and a switch is the flag alone, which says true.
   */
  readonly kind: 'text' | 'list' | 'number' | 'questions' | 'switch';
}

/** What a question takes, read off its own schema. */
export function argumentsOf(tool: Asked): readonly Argument[] {
  const declared = tool.inputSchema['properties'];
  if (typeof declared !== 'object' || declared === null) return [];
  const wanted = requiredOf(tool);

  return Object.entries(declared).map(([property, schema]) => {
    const kind = kindOf(schema);
    return {
      flag: flagOf(property),
      property,
      placeholder: listed(PLACEHOLDER[property], kind) ?? fallback(kind),
      required: wanted.includes(property),
      kind,
    };
  });
}

/**
 * A schema's `type`, one or a list of them, says how the flag is read: a type
 * that admits an array is a list, split at commas, whether or not one value may
 * also be said as a string. A `oneOf` is not read, so a start point, whose one
 * string is one path whole, stays text.
 */
function kindOf(schema: unknown): Argument['kind'] {
  const said =
    typeof schema === 'object' && schema !== null
      ? (schema as Record<string, unknown>)['type']
      : undefined;
  const type = Array.isArray(said) && said.includes('array') ? 'array' : said;
  if (type === 'array') {
    // Only `intersection` takes objects in a list, and each is a whole question.
    const items = (schema as Record<string, unknown>)['items'];
    const item = typeof items === 'object' && items !== null ? (items as Record<string, unknown>)['type'] : undefined;
    return item === 'object' ? 'questions' : 'list';
  }
  if (type === 'integer' || type === 'number') return 'number';
  return type === 'boolean' ? 'switch' : 'text';
}

/** A list takes several, and says so the way `<path>[,...]` does, whatever one of them is called. */
function listed(placeholder: string | undefined, kind: Argument['kind']): string | undefined {
  if (placeholder === undefined || kind !== 'list' || placeholder.endsWith('[,...]')) return placeholder;
  return `${placeholder}[,...]`;
}

function fallback(kind: Argument['kind']): string {
  if (kind === 'switch') return '';
  if (kind === 'list') return '<value>[,...]';
  return kind === 'number' ? '<n>' : '<value>';
}

function requiredOf(tool: Asked): readonly string[] {
  const declared = tool.inputSchema['required'];
  return Array.isArray(declared) ? declared.filter((entry) => typeof entry === 'string') : [];
}

/** How an argument is typed: a flag, or for questions, the questions themselves. */
function spelling(argument: Argument): string {
  return argument.kind === 'questions' ? `${argument.placeholder} ${argument.placeholder}...` : argument.flag;
}

/** A flag with what it takes after it, or alone when it is a switch. */
function withValue(argument: Argument): string {
  return argument.kind === 'switch' ? argument.flag : `${argument.flag} ${argument.placeholder}`;
}

/** What a question accepts, as it appears after the question in a listing. */
export function takes(tool: Asked): string {
  const flags = argumentsOf(tool).map((argument) =>
    argument.kind === 'questions'
      ? spelling(argument)
      : argument.required
        ? withValue(argument)
        : `[${withValue(argument)}]`,
  );
  return flags.length === 0 ? '' : `  ${flags.join(' ')}`;
}

/**
 * The arguments this question takes, telling `ignore` of each one it does not.
 *
 * Told rather than refused: a question reads and writes nothing, and the line is
 * printed beside the answer to whoever typed the flag. It says the answer was
 * what it would be without it, because `variance ask summary --subject story:card` reads,
 * to whoever typed it, as a question about that subject, and an answer about the
 * whole suite looks right. A missing required argument is still refused: the
 * question cannot be answered without it.
 *
 * `given` is keyed by property rather than by flag so the caller can resolve a
 * value however it needs to — one of these is a file that has to be read and
 * validated before it is an argument at all.
 */
export function inputFor(
  tool: Asked,
  given: Readonly<Record<string, unknown>>,
  ignore: (message: string) => void,
  /** The flags no question takes, typed at this one. */
  unknown: readonly Unknown[] = [],
): Readonly<Record<string, unknown>> {
  const accepted = argumentsOf(tool);
  const input: Record<string, unknown> = {};

  for (const { flag, typed } of unknown) ignored(tool, flag, typed, ignore);
  for (const [property, value] of Object.entries(given)) {
    if (value === undefined) continue;
    const argument = accepted.find((entry) => entry.property === property);
    if (argument === undefined) {
      ignored(tool, flagOf(property), flagOf(property), ignore);
      continue;
    }
    // A list a tool declares is typed once, comma-separated, like `--files`.
    input[property] = argument.kind === 'list' && typeof value === 'string'
      ? value.split(',').map((entry) => entry.trim()).filter((entry) => entry !== '')
      : value;
  }

  const missing = accepted.filter(
    (argument) => argument.required && input[argument.property] === undefined,
  );
  if (missing.length > 0) {
    // Where the missing argument comes from depends on what the question is
    // about: an id is printed by a run, a name or a specifier by the code.
    const first = tool.name.startsWith('docs_')
      ? 'Ask `packages` first; it prints the specifiers `entrypoint` takes, and `entrypoint` ' +
        'prints the names `symbol` and `uses` take. `search --query <word>` finds a name you ' +
        'can only describe.'
      : 'Ask `summary` or `changes` first for a finished run, or `run-signals` for one still ' +
        'going; each prints the ids the narrower questions take.';
    throw new OperatorError(
      `\`variance ask ${verbOf(tool)}\` needs ` +
        `${missing.map((argument) => argument.flag).join(' and ')}. ${first}`,
    );
  }

  return input;
}

/**
 * Refuse the words typed after a question that reads none of them.
 *
 * Every word after the question is a report path, and a question about the
 * code, or one asked of a watcher, reads no report. Left unread, `ask packages
 * @kbn/name` answers every package and `ask search --query rule executor`
 * searches for `rule`, each with exit 0. So a word is refused in the sentence
 * a flag the question does not take is refused in.
 */
export function refuseWords(tool: Asked, words: readonly string[] | undefined): void {
  const word = words?.[0];
  if (word === undefined) return;
  // A word left over is most often the second word of a value typed unquoted.
  const quoted = argumentsOf(tool).some((argument) => argument.kind === 'text')
    ? ' A value of more than one word is one argument, in quotes.'
    : '';
  throw new OperatorError(`${notTaken(tool, word)}; ${takesNow(tool)}.${quoted}`);
}

/**
 * Refuse the words typed after a question that reads none of them, once each
 * word typed right after a flag no question takes is given to that flag as its
 * value. The flags come back named with their values, for `inputFor` to name:
 * `--limt 5` is one flag answered past, not a flag and a stray `5`.
 */
export function wordless(tool: Asked, unknown: readonly Unknown[] = [], words: readonly string[] = []): readonly Unknown[] {
  const taken = new Set<number>();
  const valued = unknown.map(({ flag, typed, next }) => {
    const value = next === undefined ? undefined : words[next];
    if (value === undefined) return { flag, typed };
    taken.add(next as number);
    return { flag, typed: `${typed} ${value}` };
  });
  refuseWords(tool, words.filter((_, at) => !taken.has(at)));
  return valued;
}

/**
 * Tells `ignore` that a question answered without a flag it does not take, and
 * the nearest of the ones it does. The one sentence for a flag the question
 * lacks and for one no question has, its value included, so either reads alike.
 */
export function ignored(tool: Asked, flag: string, typed: string, ignore: (message: string) => void): void {
  const flags = argumentsOf(tool).map((argument) => argument.flag);
  ignore(`${notTaken(tool, typed)}, so the answer is what it is without it; ${takesNow(tool)}.${didYouMean(flag, flags)}`);
}

/** That a question does not take what was typed. */
function notTaken(tool: Asked, typed: string): string {
  return `\`${typed}\` is not an argument \`variance ask ${verbOf(tool)}\` takes`;
}

/** What a question takes instead, as the second half of a sentence. */
function takesNow(tool: Asked): string {
  const flags = argumentsOf(tool).map(spelling);
  return `it takes ${flags.length === 0 ? 'none' : flags.join(', ')}`;
}

/** The command every question is asked through, which every hint in an answer is spelled for. */
const SHELL = 'variance ask';

/** What a question's tool is handed: what this command read, asked through its shell. */
export function invocationOf<Subject>(read: Omit<ToolInvocation<Subject>, 'shell'> = {}): ToolInvocation<Subject> {
  return { ...read, shell: SHELL };
}
