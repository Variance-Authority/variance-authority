/**
 * `variance index`: the one step that writes the source index.
 *
 * Every other command that needs the file graph reads the generation this
 * publishes, so a pipeline pays for its diff here once rather than once per
 * reader. It absorbs what moved since the last publish as one appended layer
 * over the whole checkout; an index restored from a cache is the base it builds
 * on, a worktree with none builds on the primary checkout's, and anything else
 * missing costs a cold scan.
 *
 * It then folds the index into the code map `variance ask orient` prints, and
 * keeps it beside the index: the fold reads every record, so it is paid here
 * once rather than by every question.
 *
 * Last it publishes the value `variance ask` answers from, the search beside it
 * included. `search` is a lookup that never scans, so without this a fresh
 * checkout — every agent's first session — ran `index`, asked `search`, and was
 * refused until some other question happened to publish one.
 *
 * One line per artifact on stdout, because the step's output is read by the
 * person looking at a pipeline log: where the index is, how many files it holds
 * and how many this run had to read again; then what the code map holds, or why
 * there is none; then the lexicon and the published value, or why each is not.
 */

import { prepareCodeMap, updateSourceIndex, type PreparedCodeMap, type SourceUpdate } from '@variance-authority/sense';
import { readWorkspace, readWorkspaceSnapshot, refreshDependencyLexicon, workspaceGeneration, workspaceSnapshotPath } from '@variance-authority/help';
import { OperatorError } from '../exit.js';

export interface IndexRequest {
  readonly cwd: string;
  /** Read each file's bytes from the working tree rather than Git's object store. */
  readonly noGit?: boolean;
}

export async function indexOutput(request: IndexRequest): Promise<string> {
  const update = await updateSourceIndex(request.cwd, request.noGit ? { packs: false } : {});
  // A scan treats an unwritable cache as a cold next run. This step exists to
  // write it, so a refusal is the answer, and nothing after it has an index to read.
  if (update.refused !== undefined) {
    const reason = update.refused.startsWith(`${update.path}: `) ? update.refused.slice(update.path.length + 2) : update.refused;
    throw new OperatorError(`source index not written: ${reason}, at ${update.path}`);
  }
  return `${describe(update)}\n${codeMap(request.cwd, update)}\n${lexicon(request.cwd)}\n${await answerable(request.cwd, update.path, request.noGit === true)}\n`;
}

/**
 * Publishing swallows a failed write, because a question it answered is still
 * answered. The step that exists to publish reads the value back instead, so a
 * cache it could not write is a line in the log rather than a later refusal.
 */
async function answerable(root: string, index: string, noGit: boolean): Promise<string> {
  const at = workspaceSnapshotPath(index);
  try {
    const generation = workspaceGeneration(await readWorkspace(root, { index, saveIndex: false, ...(noGit ? { packs: false } : {}) }));
    const published = workspaceGeneration(await readWorkspaceSnapshot(root, { index }));
    if (generation === undefined || published !== generation) {
      return `questions: not published: the value read back from ${at} is not the one this run wrote`;
    }
    return `questions: published at ${at}`;
  } catch (error) {
    return `questions: not published: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function lexicon(root: string): string {
  try {
    const { path, packages, entrypoints, reused, unavailable } = refreshDependencyLexicon(root);
    return `dependency lexicon: ${packages} workspace-dependency pairs, ${entrypoints} public entrypoints, ${reused} reused, ${unavailable} unavailable, at ${path}`;
  } catch (error) {
    return `dependency lexicon: not prepared: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * The map is prepared after the index is published, so a map that fails leaves
 * the index standing and says why. It carries the update's listing of the
 * checkout rather than asking git again.
 */
function codeMap(cwd: string, update: SourceUpdate): string {
  try {
    return mapped(prepareCodeMap(cwd, update.path, update));
  } catch (error) {
    return `code map: not prepared: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function mapped({ prepared }: PreparedCodeMap): string {
  if (prepared === undefined) return 'code map: not prepared: there is no source index';
  const notes = [
    prepared.walked ? 'git could not list the checkout, so its files are the ones the index holds and its manifests the ones found beside them' : '',
    prepared.unmarked ? 'git could not say which files are generated or vendored, so none were set aside' : '',
    prepared.relisted ? 'no scan\'s listing of the checkout was carried, so git listed it again for the map' : '',
  ].filter((note) => note !== '');
  const map = prepared.map;
  if (map === undefined || map === null) return [`code map: none, because ${prepared.unmade ?? 'there is no package to fold'}`, ...notes].join('; ');
  const unread = map.unread === 0 ? [] : [`${map.unread} files could not be read against their parse, so the names they take are not on it`];
  return [`code map: ${map.packages} packages in ${map.areas} areas, ${map.levels} deep, over ${map.layers} dependency layers`, ...unread, ...notes].join('; ');
}

function describe(update: SourceUpdate): string {
  const files = `${update.files} ${update.files === 1 ? 'file' : 'files'}`;
  const reread = `${update.reread} read again`;
  switch (update.was) {
    case 'missing': return update.from === undefined
      ? `source index built: ${files}, at ${update.path}`
      : `source index built on ${update.from}: ${files}, ${reread}, at ${update.path}`;
    case 'damaged': return `source index repaired: ${files}, ${reread}, at ${update.path}`;
    case 'published': return `source index updated: ${files}, ${reread}, at ${update.path}`;
  }
}
