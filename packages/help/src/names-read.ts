import { readTree, type SourceNames, type Tree } from '@variance-authority/mcp/tools';
import { sourceIndexPath } from '@variance-authority/sense';

/** The tree and every file's names, read off one scan. */
export interface NamedTree {
  readonly tree: Tree;
  readonly names: SourceNames;
}

/**
 * The reading `intersection` answers from, for a shell that asks it once.
 *
 * Names are not in the published workspace value, so this is a scan through
 * the source index a run's selection writes — the reading `grep` takes for a
 * start point — with the names taken off the parses that draw the tree.
 */
export async function readNamedTree(root: string): Promise<NamedTree> {
  let names: SourceNames = new Map();
  const tree = await readTree({ root, index: sourceIndexPath(root), names: (drawn) => { names = drawn; } });
  return { tree, names };
}
