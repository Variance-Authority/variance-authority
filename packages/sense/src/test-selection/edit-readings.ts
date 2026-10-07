// compass: variance-authority.reach

/**
 * What the edit a run was recorded over did to each module it re-recorded, read
 * by the selector's verdict before a landing moves the record past it.
 *
 * A landing moves a re-recorded module's rows to the text the run saw, and a
 * carried module's rows to the text on disk, and keeps that text, so the next
 * selection frames the module by it and reads no diff.
 * Every test the record carries from before the edit is then answered by
 * whether the landing demoted it, and nothing else. Demoting each carried test
 * on a region whose digest moved made that answer every loader of the module:
 * any edit moves the digest of the module's own region, so a body edit reran
 * every test that imported the file, where the same edit read against the
 * record before the landing reran the tests that entered the body. The verdict
 * is what the selector would have read off the diff, so the landing asks it of
 * the two texts and demotes by the same answer.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { native } from '../addon.js';
import { digestString } from '../digest.js';
import { declaredEffects } from './effects.js';
import { openTestCoverage } from './format-view.js';
import type { TestCoverage } from './index.js';
import { keptTexts } from './kept-texts.js';
import { textAtRecording } from './recorded-text.js';

/**
 * How far one module's edit reaches the tests that ran it, as the selector
 * charges it: `none` runs nothing differently, `bodies` changed only what runs
 * when a function is called, and `load` changed what the module does as it
 * loads, so every loader ran something that moved.
 */
export type EditReading = 'none' | 'bodies' | 'load';

/** Readings by {@link editKey}. A module with no reading demotes as an edit always did. */
export type EditReadings = ReadonlyMap<string, EditReading>;

/** One module's edit, named by its path and the digests of the two texts. */
export function editKey(file: string, from: string, to: string): string {
  return `${file}\0${from}\0${to}`;
}

/**
 * Whether a test that entered a region of `kind` in `file` ran something the
 * edit from `from` to `to` changed. Asked only of a region whose digest moved
 * over a source that moved too.
 *
 * Unread is reached: a text that could not be had or would not parse says
 * nothing about what the edit left alone.
 */
export function editReaches(
  readings: EditReadings | undefined,
  file: string,
  from: string,
  to: string,
  kind: string,
): boolean {
  const reading = readings?.get(editKey(file, from, to));
  if (reading === undefined || reading === 'load') return true;
  if (reading === 'none') return false;
  // The selector charges a body edit to the regions its lines are in, never the
  // module's own: the verdict proved what the module does as it loads did not
  // move.
  return kind !== 'module';
}

/**
 * The reading of every module `current` re-recorded over a text other than the
 * one `previous` holds its rows in, and of every carried module whose text
 * `onDisk` holds (`carriedSources`), which the landing cuts again in it.
 *
 * The text the rows were cut from is a kept text, or the file at the record's
 * commit; the text the run saw is the file on disk, or a kept text. Each is
 * taken only when it hashes to the digest the row names.
 */
export async function editReadings(
  root: string,
  previous: Uint8Array,
  current: TestCoverage,
  onDisk: ReadonlyMap<string, string>,
  cacheRoot?: string,
): Promise<EditReadings> {
  const scanner = native();
  if (scanner?.moduleVerdict === undefined) return new Map();
  const edits: { file: string; from: string; to: string; now?: string }[] = [];
  let commit: string | undefined;
  try {
    const view = openTestCoverage(previous);
    if (view.instrumentation !== current.instrumentation) return new Map();
    commit = view.commit;
    const recorded = new Map<string, Set<string>>();
    for (const module of current.modules) {
      if (!module.instrumented) continue;
      const digests = recorded.get(module.file);
      if (digests === undefined) recorded.set(module.file, new Set([module.sourceDigest]));
      else digests.add(module.sourceDigest);
    }
    const path = view.modulePath.all();
    const source = view.moduleSource.all();
    const instrumented = view.moduleInstrumented.all();
    for (let module = 0; module < path.length; module += 1) {
      if (instrumented[module] !== 1) continue;
      const file = view.string(path[module]!);
      const from = view.string(source[module]!);
      for (const to of recorded.get(file) ?? []) if (to !== from) edits.push({ file, from, to });
      const now = recorded.has(file) ? undefined : onDisk.get(file);
      if (now !== undefined) edits.push({ file, from, to: digestString(now), now });
    }
  } catch {
    return new Map();
  }
  if (edits.length === 0) return new Map();

  const kept = keptTexts(root, cacheRoot);
  const atRecording = textAtRecording(root, edits.map((edit) => edit.file));
  const readings = new Map<string, EditReading>();
  for (const { file, from, to, now } of edits) {
    const before = kept(from) ?? hashingTo(atRecording(file, commit), from);
    if (before === undefined) continue;
    const after = now ?? hashingTo(await fromDisk(root, file), to) ?? kept(to);
    if (after === undefined) continue;
    const verdict = scanner.moduleVerdict(file, before, after);
    if (verdict === null) continue;
    readings.set(editKey(file, from, to), readingOf(root, file, verdict));
  }
  return readings;
}

function readingOf(
  root: string,
  file: string,
  verdict: { readonly kind: 'none' | 'bodies' | 'values' | 'load'; readonly imported: readonly string[] },
): EditReading {
  if (verdict.kind === 'none' || verdict.kind === 'load') return verdict.kind;
  // An import bound on one side only loads its target and everything behind
  // it, and which of those declare an effect is the graph's to say. A landing
  // holds no graph, so the import answers as a load.
  if (verdict.imported.length > 0) return 'load';
  if (declaredEffects(root, undefined, file, []).length > 0) return 'load';
  // TODO: a moved value is charged by the selector to the regions that read it,
  // here and one importer further, which takes the graph and the readers'
  // rows. Until the landing reads them, a moved value demotes every loader.
  return verdict.kind === 'values' ? 'load' : 'bodies';
}

function hashingTo(text: string | undefined, digest: string): string | undefined {
  return text !== undefined && digestString(text) === digest ? text : undefined;
}

async function fromDisk(root: string, file: string): Promise<string | undefined> {
  try {
    return await readFile(resolve(root, file), 'utf8');
  } catch {
    return undefined;
  }
}
