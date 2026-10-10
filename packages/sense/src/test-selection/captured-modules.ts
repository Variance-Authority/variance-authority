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
import { instrument, markLoaded, type InstrumentMode, type ModuleId } from '../instrument/index.js';
import { recordedBlocks } from './coverage-rows.js';
import { isMissing, projectPath, type CapturedModule } from './instrumented-modules.js';
import { handedTexts, rawFrame, type RawFrame } from './source-lines.js';

/** A module cut into regions, and the text that carries its probes. */
export interface Captured {
  readonly module: CapturedModule;
  /** `undefined` when the instrumenter could not read the text: it runs as it is. */
  readonly code: string | undefined;
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
 * `undefined` when `include` refuses the module under every name
 * {@link rawFrame} could give it.
 */
export function planModule(
  root: string,
  path: string,
  code: string,
  include: (file: string) => boolean,
  original: (path: string) => string = (at) => readFileSync(at, 'utf8'),
): PlannedModule | undefined {
  const frame = rawFrame(code, path, include, original);
  if (frame === undefined) return undefined;
  return { frame, file: projectPath(root, frame.file), id: moduleId(projectPath(root, path), code) };
}

/** What {@link planModule} decided: the file the regions are read under, and the id the probes report. */
export interface PlannedModule {
  readonly frame: RawFrame;
  readonly file: string;
  readonly id: ModuleId;
}

/** Cut one module, as a transform is handed it, and place its probes where {@link planModule} put them. */
export function captureModule(
  root: string,
  path: string,
  code: string,
  include: (file: string) => boolean,
  mode: InstrumentMode | undefined,
  original?: (path: string) => string,
): Captured | undefined {
  const plan = planModule(root, path, code, include, original);
  if (plan === undefined) return undefined;
  const { frame, file, id } = plan;
  const { sourceDigest } = frame;
  const done = instrument(code, file, id, mode === undefined ? {} : { mode });
  return {
    module: done === undefined
      ? { file, id, sourceDigest, instrumented: false, blocks: [] }
      : { file, id, sourceDigest, instrumented: true, blocks: recordedBlocks(done.blocks, frame, code, mode ?? 'presence') },
    code: done?.code,
    ...(frame.changed === undefined ? {} : { changed: frame.changed }),
  };
}

/**
 * Mark one module as loaded, as a transform is handed it, without probing it.
 *
 * For product source no probe may sit in (see {@link markLoaded}): `loaded`
 * names it, under any name {@link rawFrame} could give it, as `include` names
 * the modules {@link captureModule} probes. The module is recorded as not
 * instrumented, so every test that loaded it declares its text, and a change
 * to it selects them. `undefined` when `loaded` refuses it.
 */
export function markModule(
  root: string,
  path: string,
  code: string,
  loaded: (file: string) => boolean,
  original: (path: string) => string = (at) => readFileSync(at, 'utf8'),
): Captured | undefined {
  const frame = rawFrame(code, path, loaded, original);
  if (frame === undefined) return undefined;
  const id = moduleId(projectPath(root, path), code);
  return {
    module: { file: projectPath(root, frame.file), id, sourceDigest: frame.sourceDigest, instrumented: false, blocks: [] },
    code: markLoaded(code, id),
    ...(frame.changed === undefined ? {} : { changed: frame.changed }),
  };
}

/** The id the probes on `code`, read from `path`, report. */
export function moduleId(path: string, code: string): ModuleId {
  return `${path}@${digestOf(code)}`;
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

const ID = /^(.+)@([0-9a-f]+)$/;

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
  const [, file, digest] = parts as unknown as [string, string, string];
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
  // the module reported, so it was instrumented under one of them.
  const captured = captureModule(root, path, code, () => true, mode, (at) => (at === path ? disk : readFileSync(at, 'utf8')));
  return captured?.module;
}
