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
import { dirname, resolve } from 'node:path';
import { digestString } from '../digest.js';
import { instrument, type InstrumentMode, type ModuleId } from '../instrument/index.js';
import { instrumentTransformed } from '../instrument/transformed.js';
import { recordedBlocks } from './coverage-rows.js';
import moduleIds from './module-id.cjs';
import { fileOrNone, insideRoot, isMissing, mayTake, projectPath, type CapturedModule } from './instrumented-modules.js';
import { handedTexts, rawFrame, type RawFrame } from './source-lines.js';
import type { UnmappedStep } from './unmapped-transforms.js';

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
  /**
   * `code` was read and neither imports nor exports, as CommonJS does: what
   * it takes ahead of its own code must not be an `import`, which would make it
   * a module. `at` is where that goes, past the directive prologue, in UTF-16
   * code units. Absent where it is a module, and where it was marked rather
   * than read.
   */
  readonly script?: { readonly at: number };
}

/**
 * Where one module's probes go, as a transform is handed it.
 *
 * `path` is the absolute file the text came from, and `code` that text before
 * any other transform touched it. The id the probes report is the file's
 * repository-relative path and the digest of `code`, `path@digest`: all the
 * join needs to cut the same module again. `file` is the project path the
 * regions are read under, whose extension decides how the text is parsed.
 * A module inside `root` that `unprobed` names, under the name it was handed or
 * the one its frame reads under, is marked as loaded instead, and its id is
 * {@link markedId}.
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
  // A module outside the checkout has no project path to be marked under.
  const marks = unprobed && ((file: string) => insideRoot(root, file) && unprobed(file));
  // A marked module stays in the checkout too: a map naming a source outside it
  // would record the mark under a path that leaves it.
  const pathMarked = marks?.(path) === true;
  const accepts =
    marks === undefined
      ? include
      : (file: string) => (marks(file) || include(file)) && (!pathMarked || insideRoot(root, file));
  const frame = rawFrame(code, path, accepts, original);
  if (frame === undefined) return undefined;
  const at = projectPath(root, path);
  // `unprobed` wins, because a probe in a module whose functions leave the
  // process throws where it lands.
  const marked = marks !== undefined && (marks(frame.file) || marks(path));
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
  if (mode === 'loads') return placeModule(root, path, code, never, loadsAll(root, include, unprobed), undefined, original);
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
    ...(done?.module === false ? { script: { at: done.headerAt } } : {}),
  };
}

const never = (): boolean => false;

/**
 * Under `loads`, every module `include` or `unprobed` accepts is marked as
 * loaded and none is probed. A module outside `root` has no project path to
 * be marked under, as {@link planModule} says, and is left as it is.
 */
function loadsAll(root: string, include: (file: string) => boolean, unprobed: ((file: string) => boolean) | undefined) {
  return (file: string) => insideRoot(root, file) && (include(file) || unprobed?.(file) === true);
}

/** The map a transform at the end of a pipeline is handed back to every source it came from: Vite's `getCombinedSourcemap()`. */
export interface ComposedMap {
  readonly sources: readonly (string | null)[];
  readonly sourceRoot?: string;
  /** The text of each source, where the map carries it: for the file, what the first step was handed. */
  readonly sourcesContent?: readonly (string | null)[] | undefined;
  readonly mappings: string;
}

/** A module whose probes a transform placed after the project's own, and the map from its text back to theirs. */
export interface CapturedAfter extends Captured {
  /** The map from `code` back to the text it was handed, one source. */
  readonly mappings?: string;
  /** With `carry`, the composed map's `mappings` moved onto `code`, its sources and names as they were. */
  readonly carried?: string;
}

/** What {@link captureAfter} is told beyond the text and its map. */
interface AfterOptions {
  /** The modules marked as loaded rather than probed, as {@link placeModule} reads it. */
  readonly unprobed?: ((file: string) => boolean) | undefined;
  /** Answer the composed map moved onto the probed text, for a runner no bundler composes maps for. */
  readonly carry?: boolean;
  readonly original?: (path: string) => string;
  /** The steps ahead of this one that wrote the module and returned no map: {@link unmappedSteps}. */
  readonly unmapped?: readonly UnmappedStep[];
  /** How this seam's project has its transforms write a map, for the error that has none. */
  readonly remedy?: string;
  /**
   * The import asked for a module built from the file, such as `?raw` or a
   * single-file component's block, rather than the file itself: one whose map
   * leads back to the file is placed through it, and any other is marked as
   * loaded, so an edit to the file selects every test that loaded it.
   */
  readonly variant?: boolean;
}

const REMEDY = 'Have them write a source map';

/** A refusal of the map back to the file: a seam that can run the transforms again on the probed text answers it so. */
export class MapRefusal extends Error {}

/**
 * Cut one module as {@link placeModule} cuts it, from the file on disk, and
 * place its probes in `code`, the text every transform before this one wrote.
 *
 * A compiler that reads syntax reads probes too, so they go in last: regions,
 * ordinals and the id are the file's, as they are when the probes go in first,
 * and `map` says which code in `code` each one became. A region `map` carries
 * nowhere fires when the module loads, charged to every test that loaded it,
 * rather than recorded as never running. A rewrite with no map, one whose map
 * names no source that resolves to the file, one a plugin returned no map
 * for, one whose map carries a text for the file that is not the file, and
 * code a map with no mappings carries for a file with more than module code,
 * and text the instrumenter cannot parse written from a file it can, is an
 * error; a `variant` is marked instead. So is a file that is there and cannot
 * be read. Where `code` is the file, this is {@link placeModule}.
 */
export function captureAfter(
  root: string,
  path: string,
  code: string,
  include: (file: string) => boolean,
  mode: InstrumentMode | undefined,
  map: (() => ComposedMap | undefined) | undefined,
  options: AfterOptions = {},
): CapturedAfter | undefined {
  if (mode === 'loads') {
    return captureAfter(root, path, code, never, undefined, map, { ...options, unprobed: loadsAll(root, include, options.unprobed) });
  }
  const { unprobed, carry = false, original: read = readOriginal, unmapped = [], remedy = REMEDY, variant = false } = options;
  // Under `node_modules`, `include` is asked first: no map there is read.
  if (!mayTake(path, (file) => include(file) || (unprobed !== undefined && insideRoot(root, file) && unprobed(file)))) return undefined;
  const disk = fileOrNone(path, read);
  // The file is read once: every step below that asks for it again is handed this text.
  const original = disk === undefined ? read : heldOriginal(path, disk, read);
  if (disk === undefined || handedTexts(disk).includes(code)) {
    return placeModule(root, path, code, include, unprobed, mode, original);
  }
  const plan = planModule(root, path, disk, include, original, unprobed);
  if (plan === undefined) return undefined;
  const { frame, file, id } = plan;
  const named = projectPath(root, path);
  const unread = { file, id, sourceDigest: frame.sourceDigest, instrumented: false, blocks: [] };
  // The mark follows the last line, so no column moves: a map is composed only to carry.
  if (plan.marked) {
    const carried = carry ? map?.() : undefined;
    return { module: unread, code: markLoaded(code, id), ...(carried ? { carried: carried.mappings } : {}) };
  }
  const composed = map?.();
  const texts = handedTexts(disk);
  const rewrote = unmapped.filter((step) => step.loaded === undefined || !texts.includes(step.loaded));
  const source = mapsBack(path, code, composed);
  // A module built from the file whose code no map leads back from, such as
  // the file's text as a string, holds none of the file's code to place a
  // region in, and depends on all of it: marked, as `unprobed` marks a module.
  if (variant && (rewrote.length > 0 || source === undefined || source < 0 || !carriesTheFile(composed!, source, texts))) {
    const marked = markedId(projectPath(root, path), disk);
    return { module: { ...unread, id: marked }, code: markLoaded(code, marked), ...(carry && composed ? { carried: composed.mappings } : {}) };
  }
  if (rewrote.length > 0) {
    const plugins = rewrote.map((step) => `\`${step.plugin}\``).join(', ');
    const what = rewrote.every((step) => step.nulled)
      ? 'returned `map: null`, which says it moved nothing, and moved the file\'s lines'
      : 'rewrote the file and returned no source map, which Vite reads as moving nothing';
    throw new Error(
      `\`${named}\`: ${rewrote.length === 1 ? 'the plugin' : 'the plugins'} ${plugins} ahead of the probes ${what}, ` +
        'so the map back to the file names code that is not there. ' +
        `Have ${rewrote.length === 1 ? 'it' : 'each'} return the map of what it wrote, or leave the file out of \`include\`.`,
    );
  }
  if (source === undefined) {
    throw new MapRefusal(
      `\`${named}\`: the transforms ahead of the probes rewrote the file and left no map back to it, ` +
        `so no region of it can be placed in what they wrote. ${remedy}, or leave the file out of \`include\`.`,
    );
  }
  if (source >= 0 && !carriesTheFile(composed!, source, texts)) {
    throw new MapRefusal(
      `\`${named}\`: the map back to the file carries a text for it that is not the file on disk: a step ahead of the ` +
        'transforms that wrote a map, such as a `load` hook, rewrote the file and returned no map or `map: null`, so the map names lines ' +
        `the author never wrote. Have that step return the map of what it wrote, or leave the file out of \`include\`.`,
    );
  }
  const done = instrumentTransformed(disk, code, { file, mappings: source === -1 ? '' : composed!.mappings, source: Math.max(source, 0) }, id, { ...(mode === undefined ? {} : { mode }), carry });
  if (done === undefined) {
    // The file itself cannot be cut, so the reader cuts nothing from it either:
    // the probe of loading it is all it can hold, as when the probes go in first.
    if (instrument(disk, file, id) === undefined) {
      return { module: unread, code: markLoaded(code, id), ...(carry && composed ? { carried: composed.mappings } : {}) };
    }
    // The file can be cut and what the transforms wrote cannot be parsed: a
    // mark would be read back as the module's region alone run, every other
    // region never, so a test that ran them would go unselected.
    throw new Error(
      `\`${named}\`: the transforms ahead of the probes wrote text the instrumenter cannot parse, so no region of the file ` +
        'can be placed in it. Have them write JavaScript, or leave the file out of `include`.',
    );
  }
  // Code a map carries to nothing is a module of types compiled to a prologue,
  // which has only the module's region; a file with more was rewritten, and
  // its map lost on the way.
  if (source === -1 && /\S/.test(code) && done.blocks.length > 1) {
    throw new MapRefusal(
      `\`${named}\`: the transforms ahead of the probes rewrote the file and handed on a map with no mappings, ` +
        `so no region of it can be placed in what they wrote. ${remedy}, or leave the file out of \`include\`.`,
    );
  }
  return {
    module: { ...unread, instrumented: true, blocks: recordedBlocks(done.blocks, frame, disk, mode ?? 'presence') },
    code: done.code,
    ...(done.module ? {} : { script: { at: done.headerAt } }),
    mappings: done.mappings,
    ...(done.carried === undefined ? {} : { carried: done.carried }),
  };
}

/**
 * Which of `map`'s sources is `path`, the file `code` was written from; `-1`
 * where nothing need be placed through it, and `undefined` where nothing
 * leads back. A text with no code in it, or code the map carries to nothing,
 * such as what a module of types compiles to, has no map to name the file in:
 * the probe of loading it is all it can hold, and every region of the file
 * fires with it.
 */
export function mapsBack(path: string, code: string, map: ComposedMap | undefined): number | undefined {
  if (!/\S/.test(code) || (map !== undefined && !/[^;,]/.test(map.mappings))) return -1;
  const source = map?.sources.findIndex((name) => name !== null && resolve(dirname(path), map.sourceRoot ?? '', name) === path) ?? -1;
  return source === -1 ? undefined : source;
}

/**
 * Whether the text `map` carries for its source `source`, if it carries one,
 * is one of `texts`, the file as a step can be handed it. A map is trusted on
 * its source's name only where it says nothing more.
 */
export function carriesTheFile(map: ComposedMap, source: number, texts: readonly string[]): boolean {
  const content = map.sourcesContent?.[source];
  return typeof content !== 'string' || texts.includes(content);
}

function readOriginal(path: string): string {
  return readFileSync(path, 'utf8');
}

/**
 * The reader of files that answers `path` with `text`, already read, and reads
 * any other: how a seam's half that read the file hands it to the half that
 * places its probes, so a module is read from disk once.
 */
export function heldOriginal(
  path: string,
  text: string | undefined,
  other: (at: string) => string = readOriginal,
): (at: string) => string {
  return text === undefined ? other : (at) => (at === path ? text : other(at));
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
 * carries with it when it crosses. It is one call, the root's `m`, nothing
 * imported: it registers the module's own region and logs it as
 * {@link instrument}'s header does, so every test that loaded the module is in
 * the record — which an edit to it then selects whole, as nothing says what ran.
 *
 * Private to this module, beside {@link markedId}: the reader cuts a module
 * into regions unless its id says it was marked, so a mark placed under an id
 * {@link planModule} did not choose is read back as probed, with only its own
 * region run.
 */
function markLoaded(source: string, id: ModuleId): string {
  return `${source}\n;globalThis.__VA__.m(${JSON.stringify(id)});`;
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

const { ID } = moduleIds;

/** The repository-relative path an id names, or the whole id when it names no digest. */
export const pathOf: (id: ModuleId) => string = moduleIds.pathOf;

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
  const original = heldOriginal(path, disk);
  const captured = marked === MARKED
    ? markModule(root, path, code, () => true, original)
    : captureModule(root, path, code, () => true, mode, original);
  return captured?.module;
}
