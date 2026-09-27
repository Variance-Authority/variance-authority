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
 * It last walks each suite's latest recording over the index and keeps the
 * journeys beside it, which `variance ask orient` reads for the calls into and
 * out of a file.
 *
 * One line per step on stdout, because the step's output is read by the person
 * looking at a pipeline log: where the index is, how many files it holds and how
 * many this run had to read again; what the code map holds, or why there is
 * none; then per suite what the walk found, or why it was not made.
 */

import {
  prepareCodeMap,
  prepareJourneys,
  updateSourceIndex,
  type PreparedCodeMap,
  type PreparedJourneys,
  type SourceUpdate,
} from '@variance-authority/sense';

export interface IndexRequest {
  readonly cwd: string;
  /** Read each file's bytes from the working tree rather than Git's object store. */
  readonly noGit?: boolean;
}

export async function indexOutput(request: IndexRequest): Promise<string> {
  const update = await updateSourceIndex(request.cwd, request.noGit ? { packs: false } : {});
  return `${[describe(update), codeMap(request.cwd, update), ...(await journeys(request.cwd, update))].join('\n')}\n`;
}

/**
 * Journeys are walked last, from each suite's latest recording, so a walk that
 * fails leaves the index and the map standing and says why. Walking is kept
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
