import type { Tool, ToolInvocation } from './tool.js';

/**
 * How an answer names what to ask next, on the surface it was asked on.
 *
 * The tools are one set, asked over the wire by their schema's names and from
 * a shell as verbs with flags. A hint is only worth its words when the reader
 * can type it, so every input, tool or question an answer names is spelled
 * here, from the invocation, and nowhere else: a shell host and a wire host
 * hand the same tool the same subject, and only `shell` tells them apart.
 */

// compass: variance-authority.report.agent-surface

/**
 * The wire namespaces, one per tool set. A namespace is a fact about the
 * protocol — two servers on one client must not both offer `search` — and not a
 * word anybody types at a shell, so it is the part a verb drops.
 */
const PREFIXES = ['variance_', 'docs_'] as const;

/**
 * A declared tool, whatever it reads, as far as a listing of it carries: its
 * schema, not a name written beside it. A hint is spelled from the tool
 * itself, so renaming the tool renames every hint and deleting it fails the
 * build.
 */
type Declared = Pick<Tool<never>, 'name' | 'description' | 'inputSchema'>;

/** What a tool is asked as from a shell: its wire name without the namespace, `_` as `-`. */
export function verbOf(tool: Declared): string {
  const prefix = PREFIXES.find((candidate) => tool.name.startsWith(candidate)) ?? '';
  return tool.name.slice(prefix.length).replace(/_/g, '-');
}

/** An input as a shell flag: `atDistance` is `--at-distance`. */
export function flagOf(property: string): string {
  return `--${property.replace(/[A-Z]/g, (upper) => `-${upper.toLowerCase()}`)}`;
}

/** A value as one shell word, a list joined by commas: quoted only when a word would not survive. */
function wordOf(value: unknown): string {
  const text = Array.isArray(value) ? value.join(',') : String(value);
  return text !== '' && /^[\w./:@^,+=%#-]+$/.test(text) ? text : `'${text.replace(/'/g, `'\\''`)}'`;
}

/** The inputs, tools and questions of one surface, written as its reader types them. */
export interface Spelling {
  /** An input by its schema name: `atDistance` on the wire, `--at-distance` from a shell. */
  input(property: string): string;
  /** A tool: `docs_symbol` on the wire, `variance ask symbol` from a shell. */
  tool(tool: Declared): string;
  /**
   * A whole question, in backticks already since it is more than one word:
   * `docs_grep` with `query` `x` on the wire, `variance ask grep --query x`
   * from a shell, a value a shell would split quoted.
   */
  question(tool: Declared, input: Readonly<Record<string, unknown>>): string;
  /**
   * A question asked inside another, by its verb, without backticks: the
   * object the wire takes, `{"question":"symbol","input":{"name":"x"}}`, or
   * the words a shell takes, `symbol --name x`.
   */
  operand(verb: string, input: Readonly<Record<string, unknown>>): string;
}

/** A value as the wire takes it: a string as written, anything else as its JSON. */
const wired = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value));

const asShell = (verb: string, input: Readonly<Record<string, unknown>>): string =>
  [verb, ...Object.entries(input).map(([property, value]) => `${flagOf(property)} ${wordOf(value)}`)].join(' ');

/** The wire's spelling: every name as the schemas publish it. */
const WIRE: Spelling = {
  input: (property) => property,
  tool: (tool) => tool.name,
  question: (tool, input) =>
    `\`${tool.name}\` with ${Object.entries(input).map(([property, value]) => `\`${property}\` \`${wired(value)}\``).join(' and ')}`,
  operand: (verb, input) => JSON.stringify({ question: verb, input }),
};

/** The spelling of the surface `invocation` came from: the wire's, unless a shell is named. */
export function spellingOf(invocation: Pick<ToolInvocation<unknown>, 'shell'> | undefined): Spelling {
  const shell = invocation?.shell;
  if (shell === undefined) return WIRE;
  return {
    input: flagOf,
    tool: (tool) => `${shell} ${verbOf(tool)}`,
    question: (tool, input) => `\`${shell} ${asShell(verbOf(tool), input)}\``,
    operand: asShell,
  };
}
