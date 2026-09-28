import { readFile } from 'node:fs/promises';
import { readSearchForAnswer, readWorkspaceForAnswer, workspaceGeneration } from '@variance-authority/help';
import { answerSearch, grep, orient, slowestTests, type Help, type SearchAnswer, searchIndexOf, searchNames } from '@variance-authority/help/tools';
import { readTree, startPointArg, stringArg, type Tool, type Tree } from '@variance-authority/mcp/tools';
import { sourceIndexPath } from '@variance-authority/sense';
import { taintFile as readTaintFile, type Taint } from '@variance-authority/sense/taint';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';
import type { AskRequest, SourceReadOptions, Sourced } from './ask.js';

/**
 * How `variance ask` reads the checkout for a question about the code.
 *
 * Every source question reads the published workspace value, except `search`:
 * it reads only names, docs and sites, and opens the file published for that
 * beside the value instead of parsing all of it. Both are answered by the tool
 * `@variance-authority/help` publishes, over the same generation.
 */

/** A source answer not yet given, and the generation it will be given from. */
export interface Answering {
  readonly answer: () => string;
  /** The answer as data, for the one question that has a shape: `search`. */
  readonly data?: () => SearchAnswer;
  readonly at: string | undefined;
}

/** The question `search` was asked, read off the input its schema accepted. */
function searchQuestion(input: Readonly<Record<string, unknown>>) {
  const from = startPointArg(input, 'from');
  const to = startPointArg(input, 'to');
  return { query: stringArg(input, 'query'), ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) };
}

export async function wholeSource(
  read: NonNullable<AskRequest['source']>,
  tool: Tool<Help>,
  input: Readonly<Record<string, unknown>>,
  reading: SourceReadOptions,
): Promise<Answering> {
  const root = process.cwd();
  const sourced = await read(root, reading);
  const tree = reading.tree === true ? sourced.tree?.() : undefined;
  return {
    answer: () => tool.run(sourced.help, input, { ...(tree === undefined ? {} : { tree }), root }),
    data: () => searchNames(searchIndexOf(sourced.help), searchQuestion(input), tree, root),
    at: workspaceGeneration(sourced.help),
  };
}

export async function searchSource(
  root: string,
  input: Readonly<Record<string, unknown>>,
  options: SourceReadOptions,
): Promise<Answering> {
  let tree: Tree | undefined;
  const index = await readSearchForAnswer(root, {
    index: sourceIndexPath(root),
    ...(options.changed === undefined ? {} : { changed: options.changed }),
    ...(options.taints === undefined ? {} : { taints: options.taints }),
    ...(options.justAnswer === true ? { justAnswer: true } : {}),
    ...(options.tree === true ? { tree: (drawn: Tree) => { tree = drawn; } } : {}),
  });
  return {
    answer: () => answerSearch(index, input, tree, root),
    data: () => searchNames(index, searchQuestion(input), tree, root),
    at: index.generation?.generatedAt,
  };
}

/**
 * `grep` reads no name at all, only the tree. So it draws that through the scan
 * index a run's selection writes — the reading report questions take for a
 * start point — rather than a workspace generation, which it would never open.
 */
export async function grepSource(root: string, input: Readonly<Record<string, unknown>>): Promise<Answering> {
  // Unread is not fatal: `grep` refuses a start point it has no tree for, in
  // the sentence that says so, and a call with no start point needs none.
  const tree = grep.wants?.(input) === true ? await readTree({ root, index: sourceIndexPath(root) }).catch(() => undefined) : undefined;
  return { answer: () => grep.run(undefined, input, { ...(tree === undefined ? {} : { tree }), root }), at: undefined };
}

/**
 * `orient` reads no workspace value and draws no tree: `git grep` says where
 * the words are, and the addon opens the published index and recording itself,
 * both from `root`. So nothing is read before it is asked, and there is no
 * generation to date the answer with.
 */
export function orientSource(root: string, input: Readonly<Record<string, unknown>>): Answering {
  return { answer: () => orient.run(undefined, input, { root }), at: undefined };
}

/**
 * `slowest-tests` is `orient`'s shape for the same reason: it opens the
 * recording a run published and nothing else, so there is no workspace value
 * to read first and no generation to date the answer with.
 */
export function slowestSource(root: string, input: Readonly<Record<string, unknown>>): Answering {
  return { answer: () => slowestTests.run(undefined, input, { root }), at: undefined };
}

export async function readSource(root: string, options: SourceReadOptions = {}): Promise<Sourced> {
  let tree: Tree | undefined;
  const help = await readWorkspaceForAnswer(root, {
    index: sourceIndexPath(root),
    ...(options.changed === undefined ? {} : { changed: options.changed }),
    ...(options.taints === undefined ? {} : { taints: options.taints }),
    ...(options.justAnswer === true ? { justAnswer: true } : {}),
    ...(options.tree === true ? { tree: (drawn: Tree) => { tree = drawn; } } : {}),
  });
  return { help, tree: () => tree };
}

export async function readTaint(path: string): Promise<Taint> {
  try {
    return await readTaintFile(path);
  } catch (error) {
    throw new OperatorError(`--taint-file ${path} could not be read: ${messageOf(error)}`, { cause: error });
  }
}

/** Read the editor/orchestrator answer without asking Git to rediscover it. */
export async function readChanged(path: string): Promise<readonly string[]> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new OperatorError(`--changed-file ${path} could not be read: ${messageOf(error)}`, { cause: error });
  }
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== '');
}
