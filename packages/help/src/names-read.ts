import { readTree, type SourceNames, type Tree } from '@variance-authority/mcp/tools';
import { sourceIndexPath } from '@variance-authority/sense';
import { readsNames } from './tools/discover.js';

/** The tree, and every file's names when the question reads them, off one scan. */
export interface NamedTree {
  readonly tree: Tree;
  readonly names?: SourceNames;
}

/**
 * The reading `discover` answers from, for a shell that asks it once.
 *
 * Names are not in the published workspace value, so this is a scan through
 * the source index a run's selection writes — the reading `grep` takes for a
 * start point — with the names taken off the parses that draw the tree when
 * the question names an operand that reads them.
 */
export async function readNamedTree(root: string, input: Readonly<Record<string, unknown>>): Promise<NamedTree> {
  const index = sourceIndexPath(root);
  if (!readsNames(input)) return { tree: await readTree({ root, index }) };
  let names: SourceNames = new Map();
  const tree = await readTree({ root, index, names: (drawn) => { names = drawn; } });
  return { tree, names };
}
