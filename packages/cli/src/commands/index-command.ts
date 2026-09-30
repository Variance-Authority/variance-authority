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
 * It then walks each suite's latest recording over the index and keeps the
 * journeys beside it, which `variance ask orient` reads for the calls into and
 * out of a file.
 *
 * Last it publishes the value `variance ask` answers from, the search beside it
 * included. `search` is a lookup that never scans, so without this a fresh
 * checkout — every agent's first session — ran `index`, asked `search`, and was
 * refused until some other question happened to publish one.
 *
 * Only the index is made before the prompt comes back on a workstation: the
 * map, the journeys, the lexicon and the value are handed to a process of their
 * own (`index-follow-ups.ts`), which every later command waits on. In CI, under
 * `--wait`, or when `main` is called as a library, they are made in this process.
 *
 * One line per artifact on stdout, because the step's output is read by the
 * person looking at a pipeline log: where the index is, how many files it holds
 * and how many this run had to read again; then what the code map holds, or why
 * there is none; then per suite what the walk found, or why it was not made; then
 * the lexicon and the published value, or why each is not.
 */

import {
  prepareCodeMap,
  prepareJourneys,
  readySourceIndex,
  sourceIndexPath,
  updateSourceIndex,
  type PreparedCodeMap,
  type PreparedJourneys,
  type SourceUpdate,
} from '@variance-authority/sense';
import { publishedGeneration, readWorkspace, readWorkspaceSnapshot, refreshDependencyLexicon, refreshWorkspaceFromIndex, workspaceGeneration, workspaceSnapshotPath } from '@variance-authority/help';
import { OperatorError } from '../exit.js';
import { rmSync } from 'node:fs';
import type { Parsed } from '../parse.js';
import { awaitFollowUps, followUpsLockPath, followUpsLogPath, holdFollowUps, releaseFollowUps, reserveFollowUps, type Detach } from './index-follow-ups.js';

export type { Detach } from './index-follow-ups.js';

export interface IndexRequest {
  readonly cwd: string;
  /** Read each file's bytes from the working tree rather than Git's object store. */
  readonly noGit?: boolean;
  /**
   * Hand the follow-ups to a process of their own and return once the index is
   * written. Absent, they are made before this returns: a library caller, and
   * `--wait`.
   */
  readonly detach?: Detach;
  /** Told once when another `index` holds the follow-ups and this one waits for it. */
  readonly waiting?: (text: string) => void;
}

export async function indexOutput(request: IndexRequest): Promise<string> {
  const index = sourceIndexPath(request.cwd);
  const log = followUpsLogPath(index);
  if (request.detach === undefined) return inline(request);
  if (!(await reserveFollowUps(index, log, (lock) => request.waiting?.(waitingLine(lock))))) return inline(request);
  try {
    const update = await written(request);
    const pid = request.detach(['index', '--follow-ups', ...(request.noGit ? ['--no-git'] : [])], log);
    if (pid === undefined) return `${[describe(update), ...(await followUps(request.cwd, update, request.noGit === true))].join('\n')}\n`;
    holdFollowUps(index, { pid, log });
    return `${describe(update)}\nfollow-ups: the code map, the journeys, the dependency lexicon and the questions are being made by process ${pid}, and the next variance command waits for it; their lines are written to ${log}\n`;
  } finally {
    // A no-op once the lock is handed on: it is then the process's to let go.
    releaseFollowUps(index, process.pid);
  }
}

async function inline(request: IndexRequest): Promise<string> {
  const update = await written(request);
  return `${[describe(update), ...(await followUps(request.cwd, update, request.noGit === true))].join('\n')}\n`;
}

async function written(request: IndexRequest): Promise<SourceUpdate> {
  const update = await updateSourceIndex(request.cwd, request.noGit ? { packs: false } : {});
  // A scan treats an unwritable cache as a cold next run. This step exists to
  // write it, so a refusal is the answer, and nothing after it has an index to read.
  if (update.refused !== undefined) {
    const reason = update.refused.startsWith(`${update.path}: `) ? update.refused.slice(update.path.length + 2) : update.refused;
    throw new OperatorError(`source index not written: ${reason}, at ${update.path}`);
  }
  return update;
}

function waitingLine({ pid, log }: { pid: number; log: string }): string {
  return `waiting for process ${pid} to finish the code map, the journeys, the dependency lexicon and the questions \`variance index\` left to it; its lines are in ${log}\n`;
}

/**
 * What a detached `index` runs: the update again, which finds the index it was
 * handed and writes nothing, for the listing of the checkout it carries; then
 * the follow-ups; then the lock is let go. A process that failed keeps it, so the
 * next command finds its holder gone and makes the follow-ups itself.
 */
export async function followUpsOutput(request: Omit<IndexRequest, 'detach'>): Promise<string> {
  const output = await inline(request);
  releaseFollowUps(sourceIndexPath(request.cwd), process.pid);
  return output;
}

/**
 * Wait for the follow-ups a detached `index` is making, before any command reads
 * them; the process making them is the one command that does not wait. A process
 * that is gone left them unmade, so they are made here, on stderr, before the
 * command runs — unless the command is `index`, which is about to make them anyway.
 */
export async function settleFollowUps(parsed: Parsed, streams: { err(text: string): void }): Promise<void> {
  if (parsed.command === 'index' && parsed.followUps === true) return;
  const indexing = parsed.command === 'index';
  const cwd = process.cwd();
  const index = sourceIndexPath(cwd);
  const waited = await awaitFollowUps(index, (lock) => streams.err(waitingLine(lock)));
  if (!waited.held || waited.finished) return;
  rmSync(followUpsLockPath(index), { force: true });
  if (indexing) return;
  const { pid, log } = waited.lock;
  streams.err(`process ${pid} ended before it finished what \`variance index\` left to it, so it is made now; what it wrote is in ${log}\n`);
  streams.err(await indexOutput({ cwd }));
}

async function followUps(cwd: string, update: SourceUpdate, noGit: boolean): Promise<readonly string[]> {
  // Readied first, so everything below reads the base the next update keeps and
  // the update itself never folds one while somebody waits on it.
  await readySourceIndex(update.path);
  // The map, the journeys, the lexicon and the published value each read the index
  // the update wrote and nothing another writes, so they are made at once.
  const [map, walks, names, questions] = await Promise.all([
    codeMap(cwd, update),
    journeys(cwd, update),
    lexicon(cwd),
    answerable(cwd, update.path, noGit),
  ]);
  return [map, ...walks, names, questions];
}

/**
 * Publishing swallows a failed write, because a question it answered is still
 * answered. The step that exists to publish reads the value back instead, so a
 * cache it could not write is a line in the log rather than a later refusal.
 */
async function answerable(root: string, index: string, noGit: boolean): Promise<string> {
  const at = workspaceSnapshotPath(index);
  try {
    // The index was written a moment ago, so the previous value is refreshed from it without
    // reading the chain into records; a changed surface reads the way a first publish does.
    const previous = await readWorkspaceSnapshot(root, { index }).catch(() => undefined);
    const refreshed = previous === undefined ? undefined : await refreshWorkspaceFromIndex(root, previous, { index });
    const generation = refreshed ?? workspaceGeneration(await readWorkspace(root, { index, saveIndex: false, ...(noGit ? { packs: false } : {}) }));
    const published = await publishedGeneration(root, index);
    if (generation === undefined || published !== generation) {
      return `questions: not published: the value read back from ${at} is not the one this run wrote`;
    }
    return `questions: published at ${at}`;
  } catch (error) {
    return `questions: not published: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function lexicon(root: string): Promise<string> {
  try {
    const { path, packages, entrypoints, reused, unavailable, unchanged } = await refreshDependencyLexicon(root);
    if (unchanged) return `dependency lexicon: unchanged, nothing read: ${packages} workspace-dependency pairs, ${entrypoints} public entrypoints, ${unavailable} unavailable, at ${path}`;
    return `dependency lexicon: ${packages} workspace-dependency pairs, ${entrypoints} public entrypoints, ${reused} reused, ${unavailable} unavailable, at ${path}`;
  } catch (error) {
    return `dependency lexicon: not prepared: ${error instanceof Error ? error.message : String(error)}`;
  }
}

/**
 * Journeys are walked after the index and the map, from each suite's latest
 * recording, so a walk that fails leaves both standing and says why. Walking is kept
 * when the recording, the index, the runner's alias table and the walk are the
 * ones the kept journeys were made from. They carry the update's listing of the
 * checkout rather than asking git again.
 */
async function journeys(cwd: string, update: SourceUpdate): Promise<readonly string[]> {
  try {
    return (await prepareJourneys(cwd, update.path, update)).map(walked);
  } catch (error) {
    return [`journeys: not prepared: ${error instanceof Error ? error.message : String(error)}`];
  }
}

/** A share as a whole percent; a share that rounds to nothing but is not nothing is `<1%`. */
function percent(part: number, whole: number): string {
  const share = (part / whole) * 100;
  return part > 0 && share < 0.5 ? '<1%' : `${Math.round(share)}%`;
}

function walked(one: PreparedJourneys): string {
  const named = one.suite === undefined ? 'journeys' : `journeys, suite ${one.suite}`;
  if ('unprepared' in one) return `${named}: not prepared: ${one.unprepared}`;
  const { prepared } = one;
  const share = prepared.functionsEntered === 0 ? '' : ` (${percent(prepared.placed, prepared.functionsEntered)})`;
  const notes = [
    prepared.kept ? 'kept, because the recording, the index, the runner\'s aliases and the walk are the ones they were made from' : '',
    prepared.tree === undefined || prepared.tree === null
      ? ''
      : `the files were parsed as the working tree has them, not as the recording ran them, because ${prepared.tree}`,
    prepared.aliased > 0 ? `${prepared.aliased} imports resolved by the runner's aliases` : '',
    prepared.fellBack > 0 ? `${prepared.fellBack} imports the index did not resolve were resolved by the walk` : '',
    ...prepared.runnerUnread,
  ].filter((note) => note !== '');
  return [
    `${named}: ${prepared.cases} cases walked; a caller is found for ${prepared.placed} of the ${prepared.functionsEntered} functions they ran${share}; ` +
      `${prepared.calls} calls, ${prepared.flows} package flows`,
    ...notes,
  ].join('; ');
}

/**
 * The map is prepared after the index is published, so a map that fails leaves
 * the index standing and says why. It carries the update's listing of the
 * checkout rather than asking git again.
 */
async function codeMap(cwd: string, update: SourceUpdate): Promise<string> {
  try {
    return mapped(await prepareCodeMap(cwd, update.path, update));
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
