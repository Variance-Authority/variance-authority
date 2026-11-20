import { readIndexedNames, type SourceNames, type Tree } from '@variance-authority/mcp/tools';
import { sourceIndexPath } from '@variance-authority/sense';
import { readWorkspaceForAnswer, type AnsweringOptions } from './read.js';
import { workspaceGeneration } from './snapshot.js';
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
  return { ...read, names: await readIndexedNames(sourceIndexPath(root)) };
}
