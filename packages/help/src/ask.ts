import { HELP_TOOLS } from './tools.js';
import type { Tool, ToolInvocation, Tree } from '@variance-authority/mcp/tools';
import { startPointArg, stringArg, verbOf } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { snapshotLine } from './caught-up.js';
import { workspaceGeneration } from './read.js';
import type { SearchIndex } from './search-index.js';
import { unopenedLine, type Unopened } from './search-read.js';
import { searchNames } from './tools/search-answer.js';
import { answerSearch, search } from './tools/search.js';
import type { ImportingOf } from './tools/published-match.js';
import { wordsOf } from './words.js';

/**
 * The answers as shell verbs, so asking costs nothing to arrange.
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

/** The command the verbs are asked through, which every hint in an answer is spelled for. */
const SHELL = 'variance-authority-help';

/** What a verb's tool is handed: what this host read, asked through its shell. */
export function invocationOf<Subject>(read: Omit<ToolInvocation<Subject>, 'shell'>): ToolInvocation<Subject> {
  return { ...read, shell: SHELL };
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
 * The property that takes whole questions, where the schema has one: a list
 * whose items are objects is a list of `{question, input}`, and no other shape
 * on this server is.
 */
function questionsProperty(tool: Tool<Help>): string | undefined {
  const properties = (tool.inputSchema['properties'] ?? {}) as Record<string, { type?: unknown; items?: { type?: unknown } }>;
  return Object.keys(properties).find((property) => properties[property]?.type === 'array' && properties[property]?.items?.type === 'object');
}

/** One bare word as a whole question, split as a shell splits it and read by its own verb. */
function questionFrom(text: string, at: number): { question: string; input: Record<string, unknown> } {
  try {
    const [question = '', ...args] = wordsOf(text);
    return { question, input: inputFrom(toolNamed(question), args) };
  } catch (refusal) {
    throw new Error(`question ${at}, \`${text}\`: ${refusal instanceof Error ? refusal.message : String(refusal)}`);
  }
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
  const questions = questionsProperty(tool);

  for (let at = 0; at < args.length; at += 1) {
    const arg = args[at];
    if (arg === undefined) continue;

    if (!arg.startsWith('--') && questions !== undefined) {
      // A question inside a question is one argument, typed as it is asked alone.
      const asked = (input[questions] ?? []) as unknown[];
      input[questions] = [...asked, questionFrom(arg, asked.length + 1)];
      continue;
    }

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
 *
 * `root` is the checkout the question is about, handed to the tool as the host
 * was told it, so a tool that opens what the checkout published reads that
 * checkout and not the working directory.
 */
export function ask(
  help: Help,
  verb: string,
  args: readonly string[],
  walk?: () => Tree | undefined,
  root?: string,
  unseen = false,
): string {
  const tool = toolNamed(verb);
  const input = inputFrom(tool, args);
  const tree = tool.wants?.(input) === true ? walk?.() : undefined;
  const answer = tool.run(help, input, invocationOf({ ...(tree === undefined ? {} : { tree }), ...(root === undefined ? {} : { root }) }));
  const at = workspaceGeneration(help);
  return at === undefined ? answer : `${answer}\n${snapshotLine(at, unseen)}`;
}

/** The same answer as data: the generation is a field, and absent when unknown. */
export function askSearchJson(index: SearchIndex, args: readonly string[], walk?: () => Tree | undefined, unseen = false, unopened?: readonly Unopened[], importing?: ImportingOf): string {
  const input = inputFrom(search, args);
  const tree = search.wants?.(input) === true ? walk?.() : undefined;
  const from = startPointArg(input, 'from');
  const to = startPointArg(input, 'to');
  const answer = searchNames(index, { query: stringArg(input, 'query'), from, to }, tree, undefined, importing);
  const at = index.generation?.generatedAt;
  return JSON.stringify({ ...answer, ...(at === undefined ? {} : { generatedAt: at, ...(unseen ? { compared: false } : {}) }), ...(unopened === undefined ? {} : { unopened }) }, undefined, 2);
}

/** `search`, answered from its published index rather than the whole value. */
export function askSearch(index: SearchIndex, args: readonly string[], walk?: () => Tree | undefined, unseen = false, unopened?: readonly Unopened[], importing?: ImportingOf): string {
  const input = inputFrom(search, args);
  const tree = search.wants?.(input) === true ? walk?.() : undefined;
  const answer = answerSearch(index, input, tree, undefined, importing);
  const at = index.generation?.generatedAt;
  const dated = at === undefined ? answer : `${answer}\n${snapshotLine(at, unseen)}`;
  const said = unopenedLine(unopened, !unseen);
  return said === undefined ? dated : `${dated}\n${said}`;
}

/** Every verb and what it answers, for the usage text and for `--help`. */
export function verbs(): readonly (readonly [string, string])[] {
  return HELP_TOOLS.map((tool) => [verbOf(tool), tool.description] as const);
}
