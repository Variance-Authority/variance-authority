import { resolve } from 'node:path';
import { countOf, type Flags } from './args.js';

/**
 * `variance ask` on the command line: argv into the shape one question takes.
 *
 * Its own module beside `parseSelectArgs` and the rest, because this one command
 * carries every argument every question takes — it is the whole MCP tool set
 * behind one word, and the list grows whenever a tool does. In the middle of the
 * config-shaped parser that list is the longest thing in the file and says the
 * least about how commands are parsed.
 *
 * Nothing here decides which arguments a question actually accepts. That is read
 * off each tool's own schema in `commands/asking.ts`, so a flag typed at the
 * wrong question is refused by the tool that does not take it rather than by a
 * second list kept here.
 */

/**
 * The relation arguments, and the surface they are asked on.
 *
 * Read as one set rather than seven statements, because they are one idea: the
 * relation is the *name* of the flag, so a caller cannot pair a relation with
 * the wrong anchor and no word of `--query` has to be read as syntax. Carried by
 * property, as the tools' schemas name them.
 */
const PLACING = ['under', 'above', 'inside', 'beside', 'leftOf', 'rightOf', 'on'] as const;

function flagOf(property: string): string {
  return `--${property.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`)}`;
}

function placing(flags: Flags): Readonly<Record<string, string>> {
  return Object.fromEntries(
    PLACING.flatMap((property) => {
      const value = flags.values.get(flagOf(property));
      return value === undefined ? [] : [[property, value] as const];
    }),
  );
}

export interface ParsedAsk {
  readonly command: 'ask';
  readonly config: string;
  /**
   * The question, as the first positional. Absent lists the questions.
   *
   * A positional rather than `--question`, because the whole point of this
   * command is that an agent with a shell can reach the answers an MCP client
   * reaches, and `variance ask describe --subject story:card` is the shape
   * that reads like the sentence somebody meant.
   */
  readonly question?: string;
  readonly subject?: string;
  /** `--subjects <id>[,...]`: the plural argument `changelog` takes, not `--subject`. */
  readonly subjects?: readonly string[];
  readonly component?: string;
  readonly rule?: string;
  readonly shape?: string;
  /** `--claims <path>`: the declaration `adjudicate` reads, for the question of the same name. */
  readonly claims?: string;
  /** `--test <id>`: which test, for the questions about a suite still running. */
  readonly test?: string;
  readonly state?: string;
  readonly file?: string;
  /** `--query <words>`: a description, for the questions that search names. */
  readonly query?: string;
  /**
   * `--under`, `--above`, `--inside`, `--beside`, `--left-of`, `--right-of`:
   * the words naming what the thing sits by.
   *
   * The relation is the name of the flag rather than a value beside one, so
   * a reader cannot pair the two wrongly and nothing in `--query` has to be
   * read as syntax. Carried by property, as the tool's schema names them.
   */
  readonly under?: string;
  readonly above?: string;
  readonly inside?: string;
  readonly beside?: string;
  readonly leftOf?: string;
  readonly rightOf?: string;
  /** `--on <words>`: the surface a relation question is asked on. */
  readonly on?: string;
  /** `--from <path>`: a path to start at, for the questions that search names. Answers what it reaches. */
  readonly from?: string;
  /** `--to <path>`: a path to arrive at. Answers what reaches it, the other way along the imports. */
  readonly to?: string;
  readonly limit?: number;
  /**
   * `--at <address>`: a running watcher to ask, instead of the last report.
   *
   * Not resolved here. The default is an environment variable, and reading
   * the environment is `dispatch`'s job — this file turns argv into a shape
   * and would otherwise be the second place a default lives.
   */
  readonly at?: string;
  /** Reports to read instead of the configured one. More than one is merged. */
  readonly reports: readonly string[];
}

/** One question, its arguments, and the reports to answer it from. */
export function parseAskArgs(flags: Flags, config: string): ParsedAsk {
  // The first positional is the question and the rest are reports, which is
  // the same shape `report` already has with one word in front of it. A
  // `--question` flag would read as though the question were an option on
  // something else, and there is nothing else here.
  const [question, ...reports] = flags.positionals;
  const subjects = (flags.values.get('--subjects') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value !== '');
  const subject = flags.values.get('--subject');
  const component = flags.values.get('--component');
  const rule = flags.values.get('--rule');
  const shape = flags.values.get('--shape');
  const claims = flags.values.get('--claims');
  const test = flags.values.get('--test');
  const state = flags.values.get('--state');
  const file = flags.values.get('--file');
  const query = flags.values.get('--query');
  const from = flags.values.get('--from');
  const to = flags.values.get('--to');
  const limit = countOf(flags.values.get('--limit'), 'tests to list');
  const at = flags.values.get('--at');

  return {
    command: 'ask',
    config,
    ...(question !== undefined ? { question } : {}),
    ...(subject !== undefined ? { subject } : {}),
    ...(subjects.length > 0 ? { subjects } : {}),
    ...(component !== undefined ? { component } : {}),
    ...(rule !== undefined ? { rule } : {}),
    ...(shape !== undefined ? { shape } : {}),
    ...(claims !== undefined ? { claims: resolve(claims) } : {}),
    ...(test !== undefined ? { test } : {}),
    ...(state !== undefined ? { state } : {}),
    ...(file !== undefined ? { file } : {}),
    ...(query !== undefined ? { query } : {}),
    ...placing(flags),
    ...(from !== undefined ? { from } : {}),
    ...(to !== undefined ? { to } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(at !== undefined ? { at } : {}),
    reports: reports.map((path) => resolve(path)),
  };
}
