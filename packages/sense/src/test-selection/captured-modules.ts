/**
 * One way to cut a module into regions, run by the transform that places the
 * probes and again by the join that reads them.
 *
 * Placing probes is deterministic: one text, one path and one mode give one
 * set of ordinals. So nothing a transform learns about a module has to be kept
 * for the run that drains its counters. The probes report an id that names the
 * file and the text they were placed on, and the join reads that file, checks
 * that it is still that text, and cuts it again. A Storybook built on Monday
 * and driven on Tuesday is joined against the checkout as it is on Tuesday;
 * where a file has moved on since the build, the digest says so, and the
 * module is recorded as unread rather than read against the wrong text.
 */

import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digestString } from '../digest.js';
import { instrument, probeRuntime, type InstrumentMode, type ModuleId } from '../instrument/index.js';
import { recordedBlocks } from './coverage-rows.js';
import { isMissing, projectPath, type CapturedModule } from './instrumented-modules.js';
import { handedTexts, rawFrame, type RawFrame } from './source-lines.js';

/** A module cut into regions, and the text that carries its probes. */
export interface Captured {
  readonly module: CapturedModule;
  /**
   * The text to run. Where the instrumenter could not read the text, it runs
   * marked as loaded ({@link markLoaded}) and the module is recorded as not
   * instrumented, so a change to it selects every test that loaded it.
   */
  readonly code: string;
  /** The file is on disk, and the text handed over is not it, nor it with its map comments blanked: see {@link rawFrame}. */
  readonly changed?: true;
}

/**
 * Where one module's probes go, as a transform is handed it.
 *
 * `path` is the absolute file the text came from, and `code` that text before
 * any other transform touched it. The id the probes report is the file's
 * repository-relative path and the digest of `code`, `path@digest`: all the
 * join needs to cut the same module again. `file` is the project path the
 * regions are read under, whose extension decides how the text is parsed.
 * A module `unprobed` names, under the name it was handed or the one its frame
 * reads under, is marked as loaded instead, and its id is {@link markedId}.
 * `undefined` when neither `include` nor `unprobed` accepts the module under
 * any name {@link rawFrame} could give it.
 */
export function planModule(
  root: string,
  path: string,
  code: string,
  include: (file: string) => boolean,
  original: (path: string) => string = readOriginal,
  unprobed?: (file: string) => boolean,
): PlannedModule | undefined {
  const accepts = unprobed === undefined ? include : (file: string) => unprobed(file) || include(file);
  const frame = rawFrame(code, path, accepts, original);
  if (frame === undefined) return undefined;
  const at = projectPath(root, path);
  // `unprobed` wins, because a probe in a module whose functions leave the
  // process throws where it lands.
  const marked = unprobed !== undefined && (unprobed(frame.file) || unprobed(path));
  return { frame, file: projectPath(root, frame.file), id: marked ? markedId(at, code) : moduleId(at, code), marked };
}

/** What {@link planModule} decided: the file the regions are read under, the id the probes report, and whether it is marked rather than probed. */
export interface PlannedModule {
  readonly frame: RawFrame;
  readonly file: string;
  readonly id: ModuleId;
  /** No probe goes in: the module runs with {@link markLoaded}'s mark at its end. */
  readonly marked: boolean;
}

/** Cut one module, as a transform is handed it, and place its probes where {@link planModule} put them. */
export function captureModule(
  root: string,
  path: string,
  code: string,
  include: (file: string) => boolean,
  mode: InstrumentMode | undefined,
  original: (path: string) => string = readOriginal,
): Captured | undefined {
  return placeModule(root, path, code, include, undefined, mode, original);
}

/**
 * Mark one module as loaded, as a transform is handed it, without probing it.
 *
 * For product source no probe may sit in (see {@link markLoaded}): `loaded`
 * names it, under any name {@link rawFrame} could give it, as `include` names
 * the modules {@link captureModule} probes. The module is recorded as not
 * instrumented, so every test that loaded it declares its text, and a change
 * to it selects them. Its id is {@link markedId}, so the join reads it as
 * marked too. `undefined` when `loaded` refuses it.
 */
export function markModule(
  root: string,
  path: string,
  code: string,
  loaded: (file: string) => boolean,
  original: (path: string) => string = readOriginal,
): Captured | undefined {
  return placeModule(root, path, code, () => false, loaded, undefined, original);
}

/**
 * Place one module, as every seam's transform is handed it, where
 * {@link planModule} put it: marked as loaded, probed, or `undefined` when
 * neither `include` nor `unprobed` accepts it.
 */
export function placeModule(
  root: string,
  path: string,
  code: string,
  include: (file: string) => boolean,
  unprobed: ((file: string) => boolean) | undefined,
  mode: InstrumentMode | undefined,
  original: (path: string) => string = readOriginal,
): Captured | undefined {
  const plan = planModule(root, path, code, include, original, unprobed);
  if (plan === undefined) return undefined;
  const { frame, file, id } = plan;
  const { sourceDigest } = frame;
  const changed = frame.changed === undefined ? {} : { changed: frame.changed };
  if (plan.marked) {
    return { module: { file, id, sourceDigest, instrumented: false, blocks: [] }, code: markLoaded(code, id), ...changed };
  }
  const done = instrument(code, file, id, mode === undefined ? {} : { mode });
  return {
    module: done === undefined
      ? { file, id, sourceDigest, instrumented: false, blocks: [] }
      : { file, id, sourceDigest, instrumented: true, blocks: recordedBlocks(done.blocks, frame, code, mode ?? 'presence') },
    code: done?.code ?? markLoaded(code, id),
    ...changed,
  };
}

function readOriginal(path: string): string {
  return readFileSync(path, 'utf8');
}

/** The id the probes on `code`, read from `path`, report. */
export function moduleId(path: string, code: string): ModuleId {
  return `${path}@${digestOf(code)}`;
}

/**
 * The id a module marked as loaded reports: `path@~digest`. Its text could
 * carry probes, but none was placed on it, so the join must not cut it into
 * regions again; the mark says so.
 */
export function markedId(path: string, code: string): ModuleId {
  return `${path}@${MARKED}${digestOf(code)}`;
}

const MARKED = '~';

/**
 * Mark a module as loaded without probing it.
 *
 * For a module no probe may sit in: one whose functions cross into another
 * realm as text, where the first probe throws. The text is unchanged up to its
 * end, and the runtime follows it there, at module scope, which no function
 * carries with it when it crosses. It registers one region, the module's own,
 * and logs it as {@link instrument}'s header does, so every test that loaded
 * the module is in the record — which an edit to it then selects whole,
 * because nothing says what in it ran.
 *
 * Private to this module, beside {@link markedId}: the reader cuts a module
 * into regions unless its id says it was marked, so a mark placed under an id
 * {@link planModule} did not choose is read back as probed, with only its own
 * region run.
 */
function markLoaded(source: string, id: ModuleId): string {
  return `${source}\n;${probeRuntime(id, 1)}__vaE();`;
}

/**
 * A text a transformer that places the probes itself handed back, with
 * {@link markLoaded}'s mark at its end when no probe for `id` is in it.
 *
 * The instrumenter crate places nothing in a module it cannot parse, and the
 * transformer runs that module as it is: unmarked, a test that loaded it would
 * not hold it. The mark reports `id` as {@link markedId} spells it, `path@~digest`,
 * because no probe was placed whatever the reason: under the plain `id` the
 * transformer was handed, a text that does parse would be cut into regions
 * again and read back as probed, with only its own region run. The probes write
 * their id into the text, so its absence is the whole test, and the mark
 * follows the last line, so no mapping the transformer wrote moves.
 */
export function markUnplaced(code: string, id: ModuleId): string {
  if (code.includes(id)) return code;
  const at = id.lastIndexOf('@');
  return markLoaded(code, id.startsWith(MARKED, at + 1) ? id : `${id.slice(0, at)}@${MARKED}${id.slice(at + 1)}`);
}

/** The hex half of a text's digest: a digest has no `@` in it, so the last one in an id is the separator. */
function digestOf(code: string): string {
  const digest = digestString(code);
  return digest.slice(digest.indexOf(':') + 1);
}

/**
 * Cut every module the ids name again, from the checkout under `root`.
 *
 * An id names a file and the text its probes were placed on. A file whose
 * text is still that text — as it is, or as a dev server hands it over — is
 * cut exactly as the transform cut it. A file that has moved on since the
 * build is recorded as not instrumented: its ordinals were placed on a text
 * that no longer exists, and a consumer that widens over it is right where one
 * that read them against the new text would be wrong. A file that is gone, and
 * an id that names no text, are left out: the test that entered them is a test
 * whose evidence cannot be placed, which the caller already records as
 * incomplete.
 */
export async function deriveModules(
  root: string,
  ids: Iterable<ModuleId>,
  mode: InstrumentMode | undefined,
): Promise<ReadonlyMap<ModuleId, CapturedModule>> {
  const found = new Map<ModuleId, CapturedModule>();
  // A suite's journals can name tens of thousands of modules: a read for each
  // at once runs out of file descriptors, so a few readers share the list.
  const pending = new Set(ids).values();
  const reader = async () => {
    for (const id of pending) {
      const module = await deriveModule(root, id, mode);
      if (module !== undefined) found.set(id, module);
    }
  };
  await Promise.all(Array.from({ length: READERS }, reader));
  return found;
}

/** How many files {@link deriveModules} reads at once. */
const READERS = 64;

const ID = /^(.+)@(~?)([0-9a-f]+)$/;

/** The repository-relative path an id names, or the whole id when it names no digest. */
export function pathOf(id: ModuleId): string {
  return ID.exec(id)?.[1] ?? id;
}

async function deriveModule(
  root: string,
  id: ModuleId,
  mode: InstrumentMode | undefined,
): Promise<CapturedModule | undefined> {
  const parts = ID.exec(id);
  if (parts === null) return undefined;
  const [, file, marked, digest] = parts as unknown as [string, string, string, string];
  const path = resolve(root, file);
  let disk: string;
  try {
    disk = await readFile(path, 'utf8');
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
  const code = handedTexts(disk).find((text) => digestOf(text) === digest);
  if (code === undefined) {
    return { file, id, sourceDigest: digestString(disk), instrumented: false, blocks: [] };
  }
  // Every name the transform could have accepted, because it did accept one:
  // the module reported, so it was instrumented or marked under one of them.
  const original = (at: string) => (at === path ? disk : readFileSync(at, 'utf8'));
  const captured = marked === MARKED
    ? markModule(root, path, code, () => true, original)
    : captureModule(root, path, code, () => true, mode, original);
  return captured?.module;
}
