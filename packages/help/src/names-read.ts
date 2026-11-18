import { readTree, type SourceNames, type Tree } from '@variance-authority/mcp/tools';
import { sourceIndexPath } from '@variance-authority/sense';
import { readsNames } from './tools/discover.js';
import { namesWanted } from './tools/intersection.js';

/** The native tree, and a batched names query when the question needs one. */
export interface NamedTree {
  readonly tree: Tree;
  readonly names?: SourceNames;
}

/**
 * The reading `discover` answers from, for a shell that asks it once.
 *
 * Names stay in the native source index. A question that needs declarations
 * or imports receives a batched query over them beside its native path tree.
 */
export async function readNamedTree(root: string, input: Readonly<Record<string, unknown>>): Promise<NamedTree> {
  const index = sourceIndexPath(root);
  if (!readsNames(input) && !namesWanted(input)) return { tree: await readTree({ root, index }) };
  let names!: SourceNames;
  const tree = await readTree({ root, index, names: (drawn) => { names = drawn; } });
  return { tree, names };
}
