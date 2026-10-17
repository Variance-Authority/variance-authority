import { resolve } from 'node:path';
import type { Help } from '@variance-authority/package/help';
import { sourceIndexPath } from '@variance-authority/sense';
import { operatorError } from './operator.js';
import { readWorkspace, readWorkspaceForAnswer, type AnsweringOptions } from './read.js';
import type { SearchIndex } from './search-index.js';
import { readSearchSnapshot, readSearchTree, searchOf, workspaceSearchPath } from './snapshot.js';

/** A search, and whether it was read from the checkout as it is now. */
export interface SearchReading {
  readonly index: SearchIndex;
  /**
   * True when the checkout was read for this question; false when a published
   * search or value was opened at whatever age it had, which nothing compared
   * with the checkout.
   */
  readonly compared: boolean;
}

/**
 * The search over the workspace, opened from what was published, and read
 * from the checkout only when nothing was.
 *
 * Publishing is somebody else's job: in CI the scan and
 * the documentation are brought up to date by the steps before it, and the
 * question after them expects to find their output. So the published search is
 * opened in place at any age — not the value, not the checkout, and the graph
 * only when a start point was said. A search missing beside a published value
 * is written from that value, which reads no source. With neither, there is
 * nothing to look up: the checkout is read and the search published, as any
 * source question reads it, unless `--just-answer` was asked, which forbids the
 * read — and only then is the question refused, naming the flag that refused it.
 *
 * Changed paths or taints are the one exception, because they ask for a new
 * generation by name: that reading is {@link readWorkspaceForAnswer}'s, and it
 * publishes the search it answers from; under `--just-answer` it reads nothing
 * new, so that search is not compared with the checkout either.
 */
export async function readSearchForAnswer(root: string, options: AnsweringOptions = {}): Promise<SearchReading> {
  const { justAnswer = false, refreshAfterMs: _age, ...reading } = options;
  const index = reading.index ?? sourceIndexPath(resolve(root));
  if (reading.changed !== undefined || reading.taints !== undefined) {
    return { index: await searchOf(await readWorkspaceForAnswer(root, options), index), compared: !justAnswer };
  }

  try {
    const search = await readSearchSnapshot(root, reading.index);
    if (reading.tree !== undefined) reading.tree(await readSearchTree(search, root, reading.index));
    return { index: search, compared: false };
  } catch {
    // Not published, or not this checkout's: the published value may still hold it.
  }
  // The value is opened at any age, as the search is: how old a reused one may be is the other questions' rule.
  let help: Help;
  try {
    help = await readWorkspaceForAnswer(root, { ...reading, justAnswer: true });
  } catch (cause) {
    if (justAnswer) {
      throw operatorError(
        `search reads the published source generation, and none is published at ${workspaceSearchPath(index)}; ` +
          'it was asked with `--just-answer`, so the checkout was not read. Run `variance index` to publish one.',
        { cause },
      );
    }
    return { index: await searchOf(await readWorkspace(root, reading), index), compared: true };
  }
  return { index: await searchOf(help, index), compared: false };
}
