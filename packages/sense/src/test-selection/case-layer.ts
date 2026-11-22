import { native } from '../addon.js';
import type { NativeCaseEdit, NativeCaseRunFiles } from '../native-journey.js';
import { openSetExecutionIndex, type OpenedSetExecutionIndex } from './execution-set-format.js';
import { whyAbsent } from './native-modules.js';
import type { Edit, EditOf } from './region-edit.js';

/**
 * What a run knows about the test files it was handed.
 *
 * `sameText` names the modules the run recorded from the text the index's
 * regions of them are named at; `sameBeforeText`, read only with `base`, the
 * ones it recorded from the text the before layer's cut of them is named at.
 * A module so named is cut, in the before layer, at the lines it was recorded at.
 */
export type CaseRunFiles = NativeCaseRunFiles;

export interface CaseLayers {
  /** The whole suite: this run laid over what the index held. */
  readonly merged: Buffer;
  /** The id of every case `merged` holds, in its order. */
  readonly cases: readonly string[];
  /** The cases this run recorded, by id. */
  readonly last: readonly string[];
  /** The cases of `last` whose files the run announced: a shard's index also holds what its seed carried. */
  readonly announced: readonly string[];
  /**
   * The cases this run replaced, for the files it announced, each as it stood
   * before it. Absent when there was no index to take them from.
   */
  readonly before?: Buffer;
  /** The file of every module `before` holds, in its order. Absent with `before`. */
  readonly beforeModules?: readonly string[];
  /** The modules of `before` cut at another text than the one they are named at, whose lines nothing could carry onto it. */
  readonly unlined?: readonly string[];
}

/**
 * Lay one run's case index over the one it replaces, the way the snapshot lays
 * a run over its rows: a file the run finished is replaced, a file the
 * checkout no longer holds is retired, and every other case is carried. The
 * addon lays it whole (`native/src/case_layer.rs`), so no row crosses into V8.
 *
 * `edit` answers, for a module the run recorded, the edit between the text the
 * index's regions of it were cut from and the text the run recorded it from:
 * held cases land on the regions it left alone, at the lines it places them,
 * and a region it touched keeps them where the reading spares its kind. It is
 * asked only of a module both indexes hold, so a text is read only where a
 * held case lands through it. `undefined` is a text that could not be had:
 * every held case of the module is overwritten on every region. Without `edit`
 * the caller knows no texts and the two cuts read as one text.
 */
export function layerCaseIndex(previous: Uint8Array | undefined, fresh: Uint8Array, files: CaseRunFiles, edit?: EditOf): CaseLayers {
  const layer = native()?.layerCaseIndex;
  if (layer === undefined) throw new Error(`the case layering requires the Sense native addon: ${whyAbsent('layerCaseIndex')}`);
  const { merged, cases, last, announced, before, beforeModules, unlined } = layer(previous, fresh, files, edit === undefined ? undefined : (file) => nativeEdit(edit(file)));
  return {
    merged,
    cases,
    last,
    announced,
    ...(before == null ? {} : { before, beforeModules }),
    ...(unlined.length === 0 ? {} : { unlined }),
  };
}

/** One run laid by {@link layCaseRun}: its layers, and the readings section laid with them; absent when it holds none. */
export interface CaseRunLaid extends CaseLayers {
  readonly readings?: Buffer;
}

/**
 * {@link layerCaseIndex} and the readings lay as one native job, run off the
 * JavaScript thread, so a caller that starts it early overlaps it with its own
 * work. `edits` holds, for each module the run recorded from another text than
 * the index names it at, the edit between the two, `undefined` where one text
 * could not be had, and the error reading it failed with, raised only if the
 * layer asks for that module; a module in `files.sameText` is no edit, and any other is
 * read as changed whole. `kept` is the readings section the record held, and
 * `inputs` what each test file the run recorded ran over.
 */
export async function layCaseRun(
  previous: Uint8Array | undefined,
  fresh: Uint8Array,
  files: CaseRunFiles,
  edits: ReadonlyMap<string, Edit | undefined | Error>,
  kept: Uint8Array | undefined,
  inputs?: ReadonlyMap<string, string>,
): Promise<CaseRunLaid> {
  const lay = native()?.layCaseRun;
  if (lay === undefined) throw new Error(`the case layering requires the Sense native addon: ${whyAbsent('layCaseRun')}`);
  const given = Array.from(edits, ([file, edit]) => edit instanceof Error ? { file, error: edit.message } : { file, edit: nativeEdit(edit) });
  const { layers, readings } = await lay(previous, fresh, files, given, kept, inputs === undefined ? undefined : [...inputs]);
  const { merged, cases, last, announced, before, beforeModules, unlined } = layers;
  return {
    merged,
    cases,
    last,
    announced,
    ...(before == null ? {} : { before, beforeModules }),
    ...(unlined.length === 0 ? {} : { unlined }),
    ...(readings === null ? {} : { readings }),
  };
}

/**
 * What the runs at one commit retired, as one before: `retired` laid over
 * `kept`, which the earlier runs at that commit left. A file this run ran
 * again keeps what it retired this time.
 */
export function layerBefore(kept: Uint8Array | undefined, retired: Uint8Array | undefined, ran: ReadonlySet<string>): Buffer | undefined {
  const layer = native()?.layerCaseBefore;
  if (layer === undefined) throw new Error(`the case layering requires the Sense native addon: ${whyAbsent('layerCaseBefore')}`);
  return layer(kept, retired, [...ran]) ?? undefined;
}

/** `edit`'s answer, as the addon reads it. */
export function nativeEdit(found: Edit | undefined): NativeCaseEdit | undefined {
  return found === undefined ? undefined : found.reading === undefined ? { hunks: found.hunks } : { hunks: found.hunks, reading: found.reading };
}

/** The index `bytes` holds, opened at its sets; `undefined` when there is none, or none this build can lay over. */
export function openPrevious(bytes: Uint8Array | undefined): OpenedSetExecutionIndex | undefined {
  if (bytes === undefined) return undefined;
  try {
    return openSetExecutionIndex(bytes);
  } catch {
    return undefined;
  }
}
