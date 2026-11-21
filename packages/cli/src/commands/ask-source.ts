import { readFile } from 'node:fs/promises';
import { countingShown, generationSourceIndex, readNamedTree, readSearchForAnswer, readWorkspaceForAnswer, workspaceGeneration, type AnsweringOptions, type Unopened } from '@variance-authority/help';
import { answerSearch, containmentOf, discover, formatContainment, importingOf, intersection, journeyMapTool, namesWanted, orient, retriedTests, slowestTests, testCompositionTool, type Containment, type Help, type SearchAnswer, searchIndexOf, searchNames, searchQuestionOf } from '@variance-authority/help/tools';
import { spellingOf, type Tool, type Tree } from '@variance-authority/mcp/tools';
import { sourceIndexPath } from '@variance-authority/sense';
import { taintFile as readTaintFile, type Taint } from '@variance-authority/sense/taint';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';
import { invocationOf } from './asking.js';
import type { AskRequest, SourceReadOptions, Sourced } from './ask.js';

/**
 * How `variance ask` reads the generation `variance index` published for a question about the code.
 *
 * Every source question reads the published workspace value, except `search`:
 * it reads only names, docs and sites, and opens the file published for that
 * beside the value instead of parsing all of it. Both are answered by the tool
 * `@variance-authority/help` publishes, over the same generation.
 */

/** A source answer not yet given, and the generation it will be given from. */
export interface Answering {
  readonly answer: () => string;
  /** The answer as data, for the questions that have a shape: `search` and `containment`. */
  readonly data?: () => SearchAnswer | Containment;
  readonly at: string | undefined;
  /** True when the reading was opened at its age and nothing compared it with the checkout. */
  readonly unseen?: boolean;
  /** The published files that were there and did not open; absent when none failed. */
  readonly unopened?: readonly Unopened[];
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
  // The tree names files from the graph's root, which a nested workspace sits
  // below, so a tool that reads it is told the offset, as the server tells it.
  const drawn = tree === undefined ? {} : { tree, sourceIndex: generationSourceIndex(sourced.help, root, sourceIndexPath(root)) };
  return {
    answer: () => tool.run(sourced.help, input, invocationOf({ ...drawn, root })),
    data: () => searchNames(searchIndexOf(sourced.help), searchQuestionOf(input, spellingOf(invocationOf({ root }))), tree, root, importingOf(sourced.help, root)),
    at: workspaceGeneration(sourced.help),
  };
}

export async function searchSource(
  root: string,
  input: Readonly<Record<string, unknown>>,
  options: SourceReadOptions,
): Promise<Answering> {
  let tree: Tree | undefined;
  const read = await readSearchForAnswer(root, {
    index: sourceIndexPath(root),
    ...(options.changed === undefined ? {} : { changed: options.changed }),
    ...(options.taints === undefined ? {} : { taints: options.taints }),
    ...(options.justAnswer === true ? { justAnswer: true } : {}),
    ...(options.tree === true ? { tree: (drawn: Tree) => { tree = drawn; } } : {}),
  });
  const { index, compared } = read;
  const spell = spellingOf(invocationOf({ root }));
  const { importing, unopened } = await countingShown(read, searchQuestionOf(input, spell), tree, root);
  return {
    answer: () => answerSearch(index, input, tree, root, importing, spell),
    data: () => searchNames(index, searchQuestionOf(input, spell), tree, root, importing),
    at: index.generation?.generatedAt,
    unseen: !compared,
    ...(unopened === undefined ? {} : { unopened }),
  };
}

/**
 * `discover` answers from no workspace value, but every one of its sets needs
 * the tree, and `declares` and most `imports` ask each file's names of the
 * source index it was published from; both come from the generation `reading`
 * opens, which dates the answer.
 */
export async function discoverSource(root: string, input: Readonly<Record<string, unknown>>, reading: SourceReadOptions): Promise<Answering> {
  const { at, ...read } = await readNamedTree(root, answeringOf(root, reading));
  return { answer: () => discover.run(undefined, input, invocationOf({ ...read, root })), at };
}

/**
 * `intersection` asks each of its questions over one reading: the workspace
 * value the name questions read, the tree when any question names a path, and
 * the published source index when a `discover` among them reads names.
 */
export async function intersectionSource(
  root: string,
  input: Readonly<Record<string, unknown>>,
  reading: SourceReadOptions,
): Promise<Answering> {
  const sourced = await readSource(root, reading);
  const tree = sourced.tree?.();
  const sourceIndex = namesWanted(input, tree) ? generationSourceIndex(sourced.help, root, sourceIndexPath(root)) : undefined;
  const drawn = { ...(tree === undefined ? {} : { tree }), ...(sourceIndex === undefined ? {} : { sourceIndex }) };
  return {
    answer: () => intersection.run(sourced.help, input, invocationOf({ ...drawn, root })),
    at: workspaceGeneration(sourced.help),
  };
}

/**
 * `orient` reads no workspace value and draws no tree: `git grep` says where
 * the words are, and the addon opens the published index and recording itself,
 * both from `root`. So nothing is read before it is asked, and there is no
 * generation to date the answer with.
 */
export function orientSource(root: string, input: Readonly<Record<string, unknown>>): Answering {
  return { answer: () => orient.run(undefined, input, invocationOf({ root })), at: undefined };
}

/**
 * `slowest-tests` is `orient`'s shape for the same reason: it opens the
 * recording a run published and nothing else, so there is no workspace value
 * to read first and no generation to date the answer with.
 */
export function slowestSource(root: string, input: Readonly<Record<string, unknown>>): Answering {
  return { answer: () => slowestTests.run(undefined, input, invocationOf({ root })), at: undefined };
}

/** `retried-tests` opens the same recording `slowest-tests` does, and dates nothing for the same reason. */
export function retriedSource(root: string, input: Readonly<Record<string, unknown>>): Answering {
  return { answer: () => retriedTests.run(undefined, input, invocationOf({ root })), at: undefined };
}

export async function readSource(root: string, options: SourceReadOptions = {}): Promise<Sourced> {
  let tree: Tree | undefined;
  const help = await readWorkspaceForAnswer(root, {
    ...answeringOf(root, options),
    ...(options.tree === true ? { tree: (drawn: Tree) => { tree = drawn; } } : {}),
  });
  return { help, tree: () => tree };
}

/** What the reader is asked for: the generation the question's flags name, without the tree. */
function answeringOf(root: string, options: SourceReadOptions): AnsweringOptions {
  return {
    index: sourceIndexPath(root),
    ...(options.changed === undefined ? {} : { changed: options.changed }),
    ...(options.taints === undefined ? {} : { taints: options.taints }),
    ...(options.justAnswer === true ? { justAnswer: true } : {}),
  };
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

/** `journey-map` opens the same recording `slowest-tests` does, and dates nothing for the same reason. */
export function journeyMapSource(root: string, input: Readonly<Record<string, unknown>>): Answering {
  return { answer: () => journeyMapTool.run(undefined, input, invocationOf({ root })), at: undefined };
}

/** `containment` reads git and the workspace list, so it has no generation to date it by. */
export function containmentSource(root: string, input: Readonly<Record<string, unknown>>): Answering {
  const figures = containmentOf(root, input);
  return { answer: () => formatContainment(figures), data: () => figures, at: undefined };
}

/** `test-composition` opens the same recording `journey-map` does, and dates nothing for the same reason. */
export function testCompositionSource(root: string, input: Readonly<Record<string, unknown>>): Answering {
  return { answer: () => testCompositionTool.run(undefined, input, invocationOf({ root })), at: undefined };
}
