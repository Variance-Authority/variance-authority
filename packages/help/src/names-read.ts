import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Tree } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { sourceIndexPath } from '@variance-authority/sense';
import { readWorkspaceForAnswer, type AnsweringOptions } from './read.js';
import { publishedSourceIndex, workspaceGeneration } from './snapshot.js';

/** The tree, the source index it was read from, and the generation both came from. */
export interface NamedTree {
  readonly tree?: Tree;
  readonly sourceIndex: { readonly index: string; readonly within: string };
  readonly at: string | undefined;
}

/**
 * The reading `discover` answers from, for a shell that asks it once: the tree
 * of the generation `reading` opens, and the source index its names are asked
 * of. By default that is the generation `variance index` published, neither
 * compared with the checkout nor written; a shell passes `changed` or `taints`
 * only when its caller named them.
 */
export async function readNamedTree(
  root: string,
  reading: Omit<AnsweringOptions, 'tree'> = { justAnswer: true },
): Promise<NamedTree> {
  let tree: Tree | undefined;
  const help = await readWorkspaceForAnswer(root, { ...reading, tree: (drawn) => { tree = drawn; } });
  return { ...(tree === undefined ? {} : { tree }), sourceIndex: generationSourceIndex(help, root, reading.index), at: workspaceGeneration(help) };
}

/**
 * The source index `help` was published from, and the workspace directory its
 * tree drops from the files under it. `index` is the one the reading opened,
 * the checkout's own when absent.
 */
export function generationSourceIndex(help: Help, root: string, index?: string): NamedTree['sourceIndex'] {
  return publishedSourceIndex(help, index ?? sourceIndexPath(realpathSync(resolve(root))));
}
