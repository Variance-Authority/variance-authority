/**
 * `variance index`: the one step that writes the source index.
 *
 * Every other command that needs the file graph reads the generation this
 * publishes, so a pipeline pays for its diff here once rather than once per
 * reader. It absorbs what moved since the last publish as one appended layer
 * over the whole checkout; an index restored from a cache is the base it builds
 * on, and a missing one costs a cold scan.
 *
 * One line on stdout, because the step's output is read by the person looking
 * at a pipeline log: where the index is, how many files it holds, and how many
 * this run had to read again.
 */

import { updateSourceIndex, type SourceUpdate } from '@variance-authority/sense';

export interface IndexRequest {
  readonly cwd: string;
  /** Read each file's bytes from the working tree rather than Git's object store. */
  readonly noGit?: boolean;
}

export async function indexOutput(request: IndexRequest): Promise<string> {
  const update = await updateSourceIndex(request.cwd, request.noGit ? { packs: false } : {});
  return `${describe(update)}\n`;
}

function describe(update: SourceUpdate): string {
  const files = `${update.files} ${update.files === 1 ? 'file' : 'files'}`;
  const reread = `${update.reread} read again`;
  switch (update.was) {
    case 'missing': return `source index built: ${files}, at ${update.path}`;
    case 'damaged': return `source index repaired: ${files}, ${reread}, at ${update.path}`;
    case 'published': return `source index updated: ${files}, ${reread}, at ${update.path}`;
  }
}
