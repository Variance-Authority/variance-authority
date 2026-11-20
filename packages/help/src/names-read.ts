import { readIndexedNames, type SourceNames, type Tree } from '@variance-authority/mcp/tools';
import { sourceIndexPath } from '@variance-authority/sense';
import { readWorkspaceForAnswer } from './read.js';
import { readsNames } from './tools/discover.js';
import { namesWanted } from './tools/intersection.js';

/** The tree, and every file's names when the question reads them, off one published generation. */
export interface NamedTree {
  readonly tree?: Tree;
  readonly names?: SourceNames;
}

/**
 * The reading `discover` answers from, for a shell that asks it once: the tree
 * `variance index` published, and every file's names off the parses its source
 * index holds when the question names an operand that reads them, or crosses a
 * question that does. Neither is compared with the checkout, and with nothing
 * published the read refuses, naming `variance index`.
 */
export async function readNamedTree(root: string, input: Readonly<Record<string, unknown>>): Promise<NamedTree> {
  let tree: Tree | undefined;
  await readWorkspaceForAnswer(root, { justAnswer: true, tree: (drawn) => { tree = drawn; } });
  const drawn = tree === undefined ? {} : { tree };
  if (!readsNames(input) && !namesWanted(input)) return drawn;
  return { ...drawn, names: await readIndexedNames(sourceIndexPath(root)) };
}
