import { HELP_TOOLS } from './tools.js';
import type { Tool, Tree } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { workspaceGeneration } from './read.js';
import type { SearchIndex } from './search-index.js';
import { answerSearch, search } from './tools/search.js';

/**
 * The six answers as shell verbs, so asking costs nothing to arrange.
 *
 * An MCP server is the right shape for a client that will hold a connection open
 * all session, and the wrong shape for a reader that wants one answer once: it
 * has to be named in a config file, and the client has to be restarted before
 * the first question can be asked. A verb on a binary that is already installed
 * is askable in the turn somebody thought of the question, which is the turn the
 * question is worth answering in.
 *
 * Nothing here is a second implementation. The verbs are the same `Tool` values
 * the server lists, dispatched by name with the `docs_` prefix — the wire's
 * namespace, not a word anybody types — dropped. A seventh tool is a verb the
 * moment it joins the list, and a verb that drifts from its tool is not
 * reachable from this file.
 */

/** What a tool is called from a shell: its wire name without the transport's prefix. */
export function verbOf(tool: Tool<Help>): string {
  return tool.name.replace(/^docs_/, '');
}

export function toolNamed(verb: string): Tool<Help> {
  const found = HELP_TOOLS.find((tool) => verbOf(tool) === verb);
  if (found !== undefined) return found;

  const known = HELP_TOOLS.map(verbOf).join(', ');
  throw new Error(`unknown verb \`${verb}\`; this binary answers: ${known}`);
}

/** The properties a verb takes, read off the schema the server already publishes. */
function propertiesOf(tool: Tool<Help>): readonly string[] {
  const properties = tool.inputSchema['properties'];
  return typeof properties === 'object' && properties !== null ? Object.keys(properties) : [];
}

/**
 * `--name value` pairs, refused against the tool's own schema.
 *
 * A misspelled flag is refused here rather than ignored, because a tool whose
 * arguments are all optional would answer a typo with a plausible wrong answer —
 * `uses --form packages/cli/src/run.ts` would silently rank by nothing and read
 * exactly like a repository where nothing is written near you.
 */
export function inputFrom(tool: Tool<Help>, args: readonly string[]): Record<string, unknown> {
  const taken = propertiesOf(tool);
  const input: Record<string, unknown> = {};

  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at];
    if (arg === undefined) continue;

    if (!arg.startsWith('--')) {
      // The first bare word fills the first property, so the common question is
      // the short one: `search viewport`, not `search --query viewport`.
      const next = taken.find((property) => !(property in input));
      if (next === undefined) throw new Error(`\`${verbOf(tool)}\` takes no argument \`${arg}\``);
      input[next] = arg;
      continue;
    }

    const name = arg.slice(2);
    if (!taken.includes(name)) {
      const known = taken.length === 0 ? 'nothing' : taken.join(', ');
      throw new Error(`\`${verbOf(tool)}\` takes no \`--${name}\`; it takes: ${known}`);
    }

    const value = args[at + 1];
    if (value === undefined) throw new Error(`\`--${name}\` was given no value`);
    input[name] = value;
    at += 1;
  }

  return input;
}

/**
 * One answer, as the text the same tool would have sent over the wire.
 *
 * `walk` is how a verb that takes a path gets one. A tool cannot read a
 * repository — that is the whole reason the set is pure — so the source tree
 * arrives from out here, exactly as it does over MCP, and `search --from` would
 * otherwise be a flag this file accepts and the answer refuses. It is a
 * function rather than a tree because the verbs that name no path are most of
 * them, and folding a graph for `symbol` would charge every question for the
 * one feature it did not use.
 */
export function ask(
  help: Help,
  verb: string,
  args: readonly string[],
  walk?: () => Tree | undefined,
): string {
  const tool = toolNamed(verb);
  const input = inputFrom(tool, args);
  const tree = tool.wants?.(input) === true ? walk?.() : undefined;
  const answer = tool.run(help, input, tree === undefined ? undefined : { tree });
  const at = workspaceGeneration(help);
  return at === undefined ? answer : `${answer}\n\nSource snapshot generated ${at}.`;
}

/** `search`, answered from its published index rather than the whole value. */
export function askSearch(index: SearchIndex, args: readonly string[], walk?: () => Tree | undefined): string {
  const input = inputFrom(search, args);
  const tree = search.wants?.(input) === true ? walk?.() : undefined;
  const answer = answerSearch(index, input, tree);
  const at = index.generation?.generatedAt;
  return at === undefined ? answer : `${answer}\n\nSource snapshot generated ${at}.`;
}

/** Every verb and what it answers, for the usage text and for `--help`. */
export function verbs(): readonly (readonly [string, string])[] {
  return HELP_TOOLS.map((tool) => [verbOf(tool), tool.description] as const);
}
