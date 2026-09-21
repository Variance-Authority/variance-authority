import type { Readable, Writable } from 'node:stream';
import { serve } from '@variance-authority/mcp';
import type { Tree } from '@variance-authority/mcp/tools';
import { readOfferings, type Help } from '@variance-authority/package/help';
import {
  readWorkspaceForAnswer,
  workspaceGeneration,
  type AnsweringOptions,
} from './read.js';
import { HELP } from './tools.js';

/**
 * The transport, and one decision that could not go anywhere else.
 *
 * The decision is when to produce another generation. Asking a question is a
 * read of the last value the producer published; it is not permission to ask
 * Git what changed or to rebuild that value. The ordinary server refreshes a
 * generation after one hour, while `justAnswer` keeps serving the recorded one
 * until another process deliberately replaces it. Every answer says when that
 * generation was produced, so freshness is evidence rather than hidden work.
 *
 * `tools/surface.check.ts` holds the shape of what is served to the recorded
 * surface. No prose in this file reaches a client — `initialize` sends a name
 * and a version — so what is written here is a comment rather than the server's
 * self-description.
 */

export interface WorkspaceOptions extends AnsweringOptions {
  readonly input?: Readable;
  readonly output?: Writable;
}

/**
 * Serve one workspace generation over MCP, refreshing it only when permitted.
 *
 * Returns the stop function because stopping is the only thing a caller can
 * usefully do to a running transport. Ordinary mode checks manifests once before
 * serving, so a path that is not a workspace fails at startup. `justAnswer`
 * touches only the recorded generation and lets its absence be the refusal.
 */
export function serveWorkspace(root: string, options: WorkspaceOptions = {}): () => void {
  const { input, output, justAnswer = false, refreshAfterMs = 60 * 60 * 1000, ...reading } = options;
  if (!Number.isFinite(refreshAfterMs) || refreshAfterMs < 0) {
    throw new Error('refreshAfterMs must be a finite, non-negative number');
  }

  // Ordinary mode validates the manifests before serving. Recorded mode cannot
  // spend even that read: the published generation owns both the answer and its
  // refusal when absent.
  if (!justAnswer) readOfferings(root, { ...reading, tolerant: reading.tolerant ?? true });

  let cached: Help | undefined;

  // The graph the reading already drew, and the tree built out of it.
  //
  // A question that names a path needs to know which files that path reaches,
  // and the scan behind every reading has just worked that out — so the arrows
  // come back through `records` and the tree is folded from them rather than
  // from a second walk of the repository. `serve` settles the subject before it
  // asks for the tree, so by the time this runs the records are this request's.
  //
  // Built on demand and held against the records it was built from: most
  // questions name no path, and a reading where nothing moved hands back the
  // same array, so an unchanged checkout folds the graph once however many
  // paths are asked about it.
  let tree: Tree | undefined;

  return serve({
    input: input ?? process.stdin,
    output: output ?? process.stdout,
    served: HELP,
    tree: () => tree,
    subject: async () => {
      try {
        const at = cached === undefined ? undefined : workspaceGeneration(cached);
        const stale = at === undefined || Date.now() - Date.parse(at) > refreshAfterMs;
        if (cached === undefined || (!justAnswer && stale)) {
          let nextTree: Tree | undefined;
          cached = await readWorkspaceForAnswer(root, {
            ...reading,
            justAnswer,
            refreshAfterMs,
            tree: (drawn: Tree) => {
              nextTree = drawn;
            },
          });
          tree = nextTree;
        }
      } catch (failure) {
        // A workspace mid-edit — a manifest saved half-written, a file being
        // rewritten — must not take the server down. The previous reading is
        // stale, not wrong; the first one failing is a different thing and there
        // is nothing to answer with.
        if (cached === undefined) throw failure;
      }
      return cached;
    },
  });
}
