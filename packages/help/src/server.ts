import { resolve } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { serve } from '@variance-authority/mcp';
import { treeOf, type FileRecord, type Tree } from '@variance-authority/mcp/tools';
import { readOfferings, type Help } from '@variance-authority/package/help';
import { readWorkspace, type ReadingOptions } from './read.js';
import { HELP } from './tools.js';

/**
 * The transport, and one decision that could not go anywhere else.
 *
 * The decision is when to re-read. A server that read the workspace once at boot
 * would answer an agent's second question with the code from before its first
 * edit, which is the one sentence a documentation server must never produce
 * falsely — the agent asking is the agent that just changed the file.
 *
 * So every request re-reads, and what makes that affordable is that almost none
 * of it is read twice. The expensive third — what the whole repository imports —
 * comes out of the source index ([`read.ts`](./read.ts)), so a question about a
 * checkout where one file changed costs that one file. A server that walked and
 * parsed the repository per request would be answering in a time proportional to
 * the repository, which is the one property a repository grows out of.
 *
 * `tools/surface.check.ts` holds the shape of what is served to the recorded
 * surface. No prose in this file reaches a client — `initialize` sends a name
 * and a version — so what is written here is a comment rather than the server's
 * self-description.
 */

export interface WorkspaceOptions extends ReadingOptions {
  readonly input?: Readable;
  readonly output?: Writable;
}

/**
 * Serve one workspace over MCP, re-reading it on every request.
 *
 * Returns the stop function because stopping is the only thing a caller can
 * usefully do to a running transport: the reading is deliberately not theirs to
 * hold, for the reason above. The workspace is read once before serving as well,
 * so a path that is not a workspace fails at startup rather than on whichever
 * question an agent happens to ask first.
 */
export function serveWorkspace(root: string, options: WorkspaceOptions = {}): () => void {
  const { input, output, ...reading } = options;

  // The manifests, before serving anything: a path that is not a workspace should
  // fail at startup rather than on whichever request happens to arrive first.
  // Only the manifests, because the rest of the reading wants the index and the
  // index wants a turn of the event loop, and a startup check is not worth
  // becoming a promise for.
  readOfferings(root, { ...reading, tolerant: reading.tolerant ?? true });

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
  let records: readonly FileRecord[] | undefined;
  let folded: { readonly of: readonly FileRecord[]; readonly tree: Tree } | undefined;

  return serve({
    input: input ?? process.stdin,
    output: output ?? process.stdout,
    served: HELP,
    tree: () => {
      if (records === undefined) return undefined;
      if (folded?.of !== records) folded = { of: records, tree: treeOf(records, resolve(root)) };
      return folded.tree;
    },
    subject: async () => {
      try {
        cached = await readWorkspace(root, {
          ...reading,
          records: (drawn) => {
            records = drawn;
          },
        });
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
