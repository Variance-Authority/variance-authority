/**
 * Case grain: of each test file the selection runs, the cases it may skip.
 *
 * The file-grain reading names the regions a changed line landed in, and the
 * test files whose cases entered them. The case index the same run wrote says
 * which of a file's cases those were. A case that entered none of the changed
 * regions ran nothing the change moved, so the file runs without it.
 *
 * The cut is narrower than the file, so every doubt widens it back to the
 * file: a reason that is not a region (a precondition, a reader, an importer),
 * a region the case index does not hold, a region entered while its module
 * evaluated, a case whose journey was cut short or not seen to end, and a name
 * two cases share. A runner skips a case by its name, so a name one reached
 * case carries is never skipped.
 */

// compass: variance-authority.reach

import type { ExecutionBlock, ExecutionIndex, ExecutionNarrowing, LineRange, SelectionReason } from '@variance-authority/sense/test-selection';
import { readExecutionFor } from './execution-input.js';
import type { SuiteReading } from './select-suite.js';

type Region = Extract<SelectionReason, { kind: 'region' }>;

/**
 * `reading` with the cases each file it runs may skip, read from the case index
 * the record at `at` carries. A record that carries none cuts nothing.
 */
export async function withCases(
  reading: SuiteReading,
  at: string,
  narrowing: Pick<ExecutionNarrowing, 'whole' | 'because'>,
  changed: ReadonlyMap<string, readonly LineRange[]>,
): Promise<SuiteReading> {
  const { keepsCases } = await import('@variance-authority/sense/test-selection');
  if (!keepsCases(at)) return { ...reading, cases: new Map() };
  const { index } = await readExecutionFor(at, changed);
  const cases = new Map([...casesToSkip(index, narrowing)].filter(([file]) => !reading.skip.has(file)));
  return { ...reading, cases };
}

/** Repository-relative test file to the names of the cases it may skip; a file absent runs whole. */
export function casesToSkip(
  index: ExecutionIndex,
  narrowing: Pick<ExecutionNarrowing, 'whole' | 'because'>,
): ReadonlyMap<string, readonly string[]> {
  const whole = new Set(narrowing.whole);
  // Two rows can share a file, a source and the build its map projects onto
  // it, so a region is every block of that file it names.
  const blocks = new Map<string, ExecutionBlock[]>();
  for (const module of index.modules) {
    for (const block of module.blocks) {
      const key = regionKey(module.file, block);
      const already = blocks.get(key);
      if (already === undefined) blocks.set(key, [block]);
      else already.push(block);
    }
  }
  const declared = new Map<string, number[]>();
  index.tests.forEach((test, ordinal) => {
    const already = declared.get(test.file);
    if (already === undefined) declared.set(test.file, [ordinal]);
    else already.push(ordinal);
  });

  const cut = new Map<string, readonly string[]>();
  for (const { test: file, via } of narrowing.because) {
    const cases = declared.get(file);
    if (!whole.has(file) || cases === undefined) continue;
    const reached = reachedIn(file, via, blocks, index);
    if (reached === undefined || reached.size === 0) continue;
    const kept = new Set<string>();
    const skipped = new Set<string>();
    for (const ordinal of cases) {
      const test = index.tests[ordinal]!;
      (reached.has(ordinal) || test.stopped !== false ? kept : skipped).add(test.name);
    }
    const names = [...skipped].filter((name) => !kept.has(name)).sort();
    if (names.length > 0) cut.set(file, names);
  }
  return cut;
}

/** The cases of `file` that entered the regions `via` names, or `undefined` when the file runs whole. */
function reachedIn(
  file: string,
  via: readonly SelectionReason[],
  blocks: ReadonlyMap<string, readonly ExecutionBlock[]>,
  index: ExecutionIndex,
): Set<number> | undefined {
  const reached = new Set<number>();
  for (const reason of via) {
    if (reason.kind !== 'region') return undefined;
    const found = blocks.get(regionKey(reason.file, reason));
    if (found === undefined) return undefined;
    for (const block of found) {
      // Which cases loaded the module is not recorded: an import order stands in for it.
      if (block.loaded === true) return undefined;
      for (const crossing of block.crossings) {
        if (index.tests[crossing.test]?.file !== file) continue;
        // Evaluated while the file loaded, which every case of it waits on.
        if (crossing.loaded === true) return undefined;
        reached.add(crossing.test);
      }
    }
  }
  return reached;
}

function regionKey(file: string, region: Pick<Region, 'path' | 'startLine' | 'endLine'>): string {
  return `${file}\0${region.path}\0${region.startLine}\0${region.endLine}`;
}
