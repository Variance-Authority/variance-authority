import { resolve } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { readWorkspaceForAnswer, type AnsweringOptions } from './read.js';
import type { SearchIndex } from './search-index.js';
import { readSearchSnapshot, readSearchTree, searchOf, workspaceSearchPath } from './snapshot.js';

/**
 * The search over the workspace, read from what was published and never built.
 *
 * Search is a lookup, and publishing is somebody else's job: in CI the scan and
 * the documentation are brought up to date by the steps before it, and the
 * question after them expects to find their output. So the published search is
 * opened in place at any age — not the value, not the checkout, and the graph
 * only when a start point was said. A search missing beside a published value
 * is written from that value, which reads no source. With neither, the question
 * is refused rather than answered by a scan nobody asked this step to run.
 *
 * Changed paths or taints are the one exception, because they ask for a new
 * generation by name: that reading is {@link readWorkspaceForAnswer}'s, and it
 * publishes the search it answers from.
 */
export async function readSearchForAnswer(root: string, options: AnsweringOptions = {}): Promise<SearchIndex> {
  const { justAnswer: _asked, refreshAfterMs: _age, ...reading } = options;
  const index = reading.index ?? sourceIndexPath(resolve(root));
  if (reading.changed !== undefined || reading.taints !== undefined) {
    return searchOf(await readWorkspaceForAnswer(root, options), index);
  }

  try {
    const search = await readSearchSnapshot(root, reading.index);
    if (reading.tree !== undefined) reading.tree(await readSearchTree(search, root, reading.index));
    return search;
  } catch {
    // Not published, or not this checkout's: the published value may still hold it.
  }
  try {
    return await searchOf(await readWorkspaceForAnswer(root, { ...reading, justAnswer: true }), index);
  } catch (cause) {
    throw new Error(
      `search reads the published source generation, and none is published at ${workspaceSearchPath(index)}. ` +
        'Ask any other source question without `--just-answer` to read the checkout and publish one.',
      { cause },
    );
  }
}
