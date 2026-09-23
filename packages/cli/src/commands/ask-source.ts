import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readSearchForAnswer, readWorkspaceForAnswer, workspaceGeneration } from '@variance-authority/help';
import { answerSearch, type Help } from '@variance-authority/help/tools';
import type { Tool, Tree } from '@variance-authority/mcp/tools';
import { taintFile as readTaintFile, type Taint } from '@variance-authority/sense/taint';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';
import type { AskRequest, SourceReadOptions, Sourced } from './ask.js';
import { scanCacheRoot } from './resources.js';

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
  readonly at: string | undefined;
}

export async function wholeSource(
  read: NonNullable<AskRequest['source']>,
  tool: Tool<Help>,
  input: Readonly<Record<string, unknown>>,
  reading: SourceReadOptions,
): Promise<Answering> {
  const sourced = await read(process.cwd(), reading);
  const tree = reading.tree === true ? sourced.tree?.() : undefined;
  return {
    answer: () => tool.run(sourced.help, input, tree === undefined ? undefined : { tree }),
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
    index: join(scanCacheRoot(root), 'source-index.bin'),
    ...(options.changed === undefined ? {} : { changed: options.changed }),
    ...(options.taints === undefined ? {} : { taints: options.taints }),
    ...(options.justAnswer === true ? { justAnswer: true } : {}),
    ...(options.tree === true ? { tree: (drawn: Tree) => { tree = drawn; } } : {}),
  });
  return { answer: () => answerSearch(index, input, tree), at: index.generation?.generatedAt };
}

export async function readSource(root: string, options: SourceReadOptions = {}): Promise<Sourced> {
  let tree: Tree | undefined;
  const help = await readWorkspaceForAnswer(root, {
    index: join(scanCacheRoot(root), 'source-index.bin'),
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
