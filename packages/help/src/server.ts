import type { Readable, Writable } from 'node:stream';
import { serve } from '@variance-authority/mcp';
import { type Help, type HelpOptions, readHelp } from '@variance-authority/package/help';
import { HELP } from './tools.js';

/**
 * The transport, and one decision that could not go anywhere else.
 *
 * The decision is when to re-read. A server that read the workspace once at boot
 * would answer an agent's second question with the code from before its first
 * edit, which is the one sentence a documentation server must never produce
 * falsely — the agent asking is the agent that just changed the file.
 *
 * So every request re-reads, and the cost is the reason that is affordable: the
 * reading is manifests and module records, not a compilation. Reading this
 * workspace whole — every package it publishes, well over a thousand exported
 * names — costs less than the model spends deciding what to ask next.
 *
 * The scale is a floor rather than a count, because a count is a sentence the
 * next package falsifies and nothing here would notice: this is a comment, not
 * the server's self-description — `initialize` sends a name and a version, and
 * no prose in this file reaches a client. `tools/surface.check.ts` holds the floor
 * to the recorded surface, which is what makes the sentence above a claim rather
 * than a decoration.
 */

export interface WorkspaceOptions extends HelpOptions {
  readonly input?: Readable;
  readonly output?: Writable;
}

export function serveWorkspace(root: string, options: WorkspaceOptions = {}): () => void {
  const { input, output, ...reading } = options;

  // Read once before serving, so a path that is not a workspace fails at startup
  // rather than on whichever request happens to arrive first.
  let cached: Help = readHelp(root, reading);

  return serve({
    input: input ?? process.stdin,
    output: output ?? process.stdout,
    served: HELP,
    subject: () => {
      try {
        cached = readHelp(root, reading);
      } catch {
        // A workspace mid-edit — a manifest saved half-written, a file being
        // rewritten — must not take the server down. The previous reading is
        // stale, not wrong.
      }
      return cached;
    },
  });
}
