/**
 * Which carried modules' text has to be re-read, asked of the columns alone.
 *
 * A lay re-cuts the rows of a module the run did not record but whose text
 * moved, and to know which those are it needs one digest per module — three
 * columns of the snapshot, not the model behind them. Kept beside the layer
 * rather than inside it because the question is the index's own and the answer
 * is a plain map of file to text.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digestString } from '../digest.js';
import { openTestCoverage } from './format-view.js';
import type { TestCoverage } from './index.js';

/**
 * The text the carried rows will be re-cut from, named off the columns.
 *
 * Three columns of one row per module, against the twenty-odd a decode would
 * have had to decode to answer the same question. The snapshot is opened twice
 * over a whole write — here and in the layer — and the second open decompresses
 * these three again, which is a few milliseconds of an index whose block
 * columns are thirty times larger and are read exactly once.
 */
export async function carriedSources(
  root: string,
  previous: Uint8Array,
  current: TestCoverage,
): Promise<ReadonlyMap<string, string>> {
  let carried: CarriedModule[];
  try {
    const view = openTestCoverage(previous);
    if (view.instrumentation !== current.instrumentation) return new Map();
    const path = view.modulePath.all();
    const source = view.moduleSource.all();
    const instrumented = view.moduleInstrumented.all();
    const recorded = new Set(current.modules.map((module) => module.file));
    carried = [];
    for (let module = 0; module < path.length; module += 1) {
      // A module recorded as unread is not re-cut at all: that row says this
      // build never measured the module, and cutting regions out of its text
      // would answer an unknown with a table of regions no run ever entered.
      if (instrumented[module] !== 1) continue;
      const held = view.string(path[module]!);
      if (recorded.has(held)) continue;
      carried.push({ file: held, sourceDigest: view.string(source[module]!) });
    }
  } catch {
    return new Map();
  }
  return readSources(root, carried);
}

/** What a carried module is named by, which is all {@link readSources} reads. */
export interface CarriedModule {
  readonly file: string;
  readonly sourceDigest: string;
}

/**
 * The text a lay re-cuts carried rows from: of the modules the caller names,
 * the ones whose text has moved since their rows were cut. This is the whole of
 * the I/O, so the lay itself stays a function of two snapshots. A file that is not there is not named, and is carried as it was;
 * one that is there and would not open is named {@link UNREADABLE}.
 *
 * What the map deliberately does not hold is every other module. A run that
 * re-records ten files of two hundred thousand carries the rest, and almost
 * every one of them has the text its rows were cut from; naming it here would
 * hold a repository of source in one process to answer a question the module's
 * own digest answers in sixteen bytes. So each file is read, decided, and let
 * go, and only text a re-cut will actually read is kept.
 *
 * The caller names them rather than handing over a snapshot to be filtered,
 * because the caller that wants this most does not have a decoded snapshot: a
 * layer reads the same three columns off the file it is about to write over,
 * and materializing the model to name them would be the cost the layer exists
 * to avoid.
 *
 * The reads run {@link AT_ONCE} at a time. They are the one unbounded loop in
 * the lay — one iteration per module the index holds — and awaiting them one
 * after another spends the whole of it waiting on a syscall that was never the
 * limit.
 */
export async function readSources(
  root: string,
  carried: readonly CarriedModule[],
): Promise<ReadonlyMap<string, string>> {
  const sources = new Map<string, string>();
  let next = 0;
  const reader = async (): Promise<void> => {
    for (let index = next++; index < carried.length; index = next++) {
      const module = carried[index]!;
      let text: string;
      try {
        text = await readFile(resolve(root, module.file), 'utf8');
      } catch (error) {
        // Nothing at the path says the rows are about a file that is gone, and
        // the module is carried as it was. A path that is there and would not
        // open says something else: this process does not know whether the text
        // moved, and carrying the rows on the strength of not having looked
        // leaves ranges cut from text that may be gone, with no crossing lost
        // and so no test demoted for them. That is ordinary at this scale —
        // {@link AT_ONCE} descriptors times however many workers lay at once,
        // a build rewriting the file under the read, a permission that slipped
        // — and each is momentary, so it costs one module's tests one run.
        if (missing(error)) continue;
        sources.set(module.file, UNREADABLE);
        continue;
      }
      // Text that has not moved is the text the rows were cut from, so the rows
      // already stand where the next diff will be taken.
      if (digestString(text) !== module.sourceDigest) sources.set(module.file, text);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, carried.length) }, () => reader()),
  );
  return sources;
}

/** A path nothing is at, as against one that is there and would not open. */
function missing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === 'ENOENT' || code === 'ENOTDIR';
}

/**
 * What {@link readSources} names a module whose text it could not read at all,
 * as against read and found moved.
 *
 * The map is texts, and for this module there is none to put in it. A lay that
 * meets it carries nothing and demotes every test that entered the module, as it
 * does for a module whose regions were renumbered, and on the same ground: the
 * rows are ranges in text nobody has here, and a reader not told so narrows on
 * coordinates that may be wrong. A file whose whole content is this string is
 * mislaid too, at the cost of one run to one module's tests.
 */
export const UNREADABLE = '\0unreadable';

/**
 * Files read at once by {@link readSources}.
 *
 * Enough to keep the disk busy, few enough that the descriptors are a constant
 * rather than a function of how many modules the index holds — a lay that
 * opened one per carried module would run out of them at the scale that makes
 * the lay worth doing.
 */
const AT_ONCE = 32;
