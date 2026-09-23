import { resolve } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { readWorkspaceForAnswer, type AnsweringOptions } from './read.js';
import type { SearchIndex } from './search-index.js';
import { readSearchSnapshot, readSearchTree, searchOf } from './snapshot.js';

const HOUR = 60 * 60 * 1000;

/**
 * The search over the workspace, under the rules {@link readWorkspaceForAnswer}
 * applies to the whole value.
 *
 * A published search young enough to answer — or any published search, under
 * `justAnswer` — is opened in place and nothing else is read: not the value, not
 * the checkout, and the graph only when a start point was said. Everything else
 * is the whole reading's business: a refresh, changed paths, taints, a missing
 * or foreign file. That reading publishes the search it answers from, so the
 * next question takes the short path.
 */
export async function readSearchForAnswer(root: string, options: AnsweringOptions = {}): Promise<SearchIndex> {
  const { justAnswer = false, refreshAfterMs = HOUR, ...reading } = options;
  const answerable =
    reading.changed === undefined && reading.taints === undefined &&
    Number.isFinite(refreshAfterMs) && refreshAfterMs >= 0;

  if (answerable) {
    try {
      const search = await readSearchSnapshot(root, reading.index);
      const at = search.generation?.generatedAt;
      if (at !== undefined && (justAnswer || Date.now() - Date.parse(at) <= refreshAfterMs)) {
        if (reading.tree !== undefined) reading.tree(await readSearchTree(search, root, reading.index));
        return search;
      }
    } catch {
      // Not published, or not this checkout's: the whole reading answers it.
    }
  }

  const help = await readWorkspaceForAnswer(root, options);
  return searchOf(help, reading.index ?? sourceIndexPath(resolve(root)));
}
