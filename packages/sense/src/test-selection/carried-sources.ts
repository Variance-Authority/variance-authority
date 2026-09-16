/**
 * Which carried modules' text has to be re-read, asked of the columns alone.
 *
 * A merge re-cuts the rows of a module the run did not record but whose text
 * moved, and to know which those are it needs one digest per module — three
 * columns of the snapshot, not the model behind them. Kept beside the layer
 * rather than inside it because the question is the index's own and the answer
 * is a plain map of file to text.
 */
import { openTestCoverage } from './format-view.js';
import { readSources, type CarriedModule } from './merge.js';
import type { TestCoverage } from './index.js';

/**
 * The text the carried rows will be re-cut from, named off the columns.
 *
 * Three columns of one row per module, against the twenty-odd a merge would
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
