import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { readIndexedNames, type SourceNames, type Tree } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { sourceIndexPath } from '@variance-authority/sense';
import { readWorkspaceForAnswer, type AnsweringOptions } from './read.js';
import { publishedSourceIndex, workspaceGeneration } from './snapshot.js';
import { readsNames } from './tools/discover.js';
import { namesWanted } from './tools/intersection.js';

/** The tree, every file's names when the question reads them, and the generation both came from. */
export interface NamedTree {
  readonly tree?: Tree;
  readonly names?: SourceNames;
  readonly at: string | undefined;
}

/**
 * The reading `discover` answers from, for a shell that asks it once: the tree
 * of the generation `reading` opens, and every file's names off the parses its
 * source index holds when the question names an operand that reads them, or
 * crosses a question that does. By default that is the generation `variance
 * index` published, neither compared with the checkout nor written; a shell
 * passes `changed` or `taints` only when its caller named them.
 */
export async function readNamedTree(
  root: string,
  input: Readonly<Record<string, unknown>>,
  reading: Omit<AnsweringOptions, 'tree'> = { justAnswer: true },
): Promise<NamedTree> {
  let tree: Tree | undefined;
  const help = await readWorkspaceForAnswer(root, { ...reading, tree: (drawn) => { tree = drawn; } });
  const read = { ...(tree === undefined ? {} : { tree }), at: workspaceGeneration(help) };
  if (!readsNames(input) && !namesWanted(input)) return read;
  return { ...read, names: await readGenerationNames(help, root, reading.index) };
}

/**
 * Every file's names off the parses of the source index `help` was published
 * from, spelled from the workspace's directory as its tree is. `index` is the
 * one the reading opened, the checkout's own when absent.
 */
export async function readGenerationNames(help: Help, root: string, index?: string): Promise<SourceNames> {
  const published = publishedSourceIndex(help, index ?? sourceIndexPath(realpathSync(resolve(root))));
  const names = await readIndexedNames(published.index);
  if (published.within === '') return names;
  // The tree drops the workspace's directory from the files under it and spells the rest from the index's root.
  const under = `${published.within}/`;
  return new Map([...names].map(([file, held]) => [file.startsWith(under) ? file.slice(under.length) : file, held]));
}
