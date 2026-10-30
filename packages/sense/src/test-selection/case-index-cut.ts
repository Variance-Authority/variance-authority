/**
 * Whether a record's case index was cut at the text its snapshot was.
 *
 * A record holds two cuts of each module it ran. The snapshot names the text
 * its rows were cut from, and a run re-cuts them to the text on disk whenever
 * that text moved. The case index names none: a run that skips every test file
 * it selected keeps no case, so it carries the index it was laid over
 * unchanged while its snapshot moves on. A reader that takes
 * the snapshot's text as the index's reads the index's lines in a text they
 * were never cut from.
 */

import { BLOCK_KINDS } from './format-layout.js';
import type { TestCoverageView } from './format-view.js';
import { askCoverageFile } from './coverage-file.js';
import { findModules } from './lookup.js';
import { cutAlike, sameCut, sharesRegion, type Cut } from './region-landing.js';
import { NO_LINE } from './written-lines.js';

/** A case index's module, as {@link casesCutApart} reads it. */
export interface IndexedCut extends Cut {
  readonly file: string;
}

// FIXME: an edit that moves no region's lines leaves both cuts alike, and the
// index then passes for the snapshot's text when it was cut at another. The
// index carrying the text each module was recorded from, as `relined` asks
// too, would answer this by digest.
/**
 * The files of `modules` the case index cut at other text than the snapshot
 * of the record at `coverageFile`: some region of theirs stands at other
 * lines than the snapshot's row of it, so the index's lines are not the
 * snapshot's text's, whatever that text is.
 *
 * Each module of a file is compared with each row the snapshot holds for it,
 * by {@link cutAlike}, the test a run lays its cases over a module by. Two cuts
 * that both hold regions and share no address are apart too: one text cuts one
 * set of addresses, so the index was cut at a text whose regions were all
 * renamed since. A file the snapshot holds no row for, or whose index holds no
 * region, has nothing to compare with and is not one.
 */
export function casesCutApart(coverageFile: string, modules: readonly IndexedCut[]): ReadonlySet<string> {
  if (modules.length === 0) return new Set();
  return askCoverageFile(coverageFile, (coverage) => {
    const rows = new Map<string, readonly Cut[]>();
    const apart = new Set<string>();
    for (const module of modules) {
      if (!rows.has(module.file)) rows.set(module.file, findModules(coverage, module.file).map((row) => snapshotCut(coverage, row)));
      if (rows.get(module.file)!.some((cut) => !sameCut(module, cut) && (!cutAlike(module, cut) || disjoint(module, cut)))) apart.add(module.file);
    }
    return apart;
  });
}

/** Whether both cuts hold regions and no address of one is in the other. */
function disjoint(index: Cut, snapshot: Cut): boolean {
  return index.blocks.length > 0 && snapshot.blocks.length > 0 && !sharesRegion(index, snapshot);
}

/** The regions one snapshot row holds lines for, as a cut. */
function snapshotCut(coverage: TestCoverageView, module: number): Cut {
  const blocks: Cut['blocks'][number][] = [];
  for (let block = coverage.moduleBlocks.at(module); block < coverage.moduleBlocks.at(module + 1); block += 1) {
    const startLine = coverage.blockStart.at(block);
    if (startLine === NO_LINE) continue;
    blocks.push({
      kind: BLOCK_KINDS[coverage.blockKind.at(block)]!,
      name: coverage.string(coverage.blockName.at(block)),
      path: coverage.string(coverage.blockPath.at(block)),
      startLine,
      endLine: coverage.blockEnd.at(block),
    });
  }
  return { blocks };
}
