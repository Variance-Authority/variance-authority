import type { ToolInvocation } from '@variance-authority/mcp/tools';

/**
 * How an answer names what to ask next, on the surface it was asked on.
 *
 * The tools are one set, asked over the wire by their schema's names and from
 * a shell as verbs with flags. A hint is only worth its words when the reader
 * can type it, so every input or tool an answer names is spelled here, from
 * the invocation, and nowhere else.
 */

// compass: variance-authority.report.agent-surface

/** What a tool is called from a shell: its wire name without the transport's prefix. */
export function verbNamed(tool: string): string {
  return tool.replace(/^docs_/, '').replace(/_/g, '-');
}

/** The inputs and tools of one surface, written as its reader types them. */
export interface Spelling {
  /** An input by its schema name: `from` on the wire, `--from` from a shell. */
  input(name: string): string;
  /** A tool by its wire name: `docs_symbol` on the wire, `variance ask symbol` from a shell. */
  tool(name: string): string;
  /**
   * A whole question, a tool by its wire name and its inputs by their schema
   * names: `docs_grep` with `query` `x` on the wire, `variance ask grep --query
   * x` from a shell, a value a shell would split quoted. In backticks
   * already, since it is more than one word.
   */
  question(name: string, inputs: readonly (readonly [string, string])[]): string;
}

/** A value as one shell word: quoted where a shell would split or expand it. */
function word(value: string): string {
  return /^[\w./:@#-]+$/u.test(value) ? value : `'${value.replace(/'/gu, "'\\''")}'`;
}

/** The spelling of the surface `invocation` came from: the wire's, unless a shell is named. */
export function spellingOf(invocation: ToolInvocation<unknown> | undefined): Spelling {
  const shell = invocation?.shell;
  if (shell === undefined) {
    return {
      input: (name) => name,
      tool: (name) => name,
      question: (name, inputs) => `\`${name}\` with ${inputs.map(([input, value]) => `\`${input}\` \`${value}\``).join(' and ')}`,
    };
  }
  return {
    input: (name) => `--${name}`,
    tool: (name) => `${shell} ${verbNamed(name)}`,
    question: (name, inputs) => `\`${[`${shell} ${verbNamed(name)}`, ...inputs.map(([input, value]) => `--${input} ${word(value)}`)].join(' ')}\``,
  };
}
