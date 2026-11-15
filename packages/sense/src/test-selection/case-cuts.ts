/**
 * The case index laid onto the text its rows were landed at.
 *
 * A landing — a run's, `variance land`'s, or a repin onto a newer milestone —
 * re-cuts a carried module's rows to the text on disk when every region keeps
 * its address (`carriedSources` in `carried-sources.ts`), and lays a run's own
 * cases onto the modules that run recorded. A module the run did not
 * record keeps the case regions it was recorded with, and after the re-cut
 * those are lines of a text the record no longer names. Every reader asks the
 * index by line, so it would charge an edit to whichever region stood at that
 * line before the move. Nothing downstream can tell: the index names no text.
 *
 * So after every landing, each held module whose rows now stand at another
 * text is laid onto the rows' cut by the rule a run's recorded module takes the
 * held cases by (`follow_cuts` in `native/src/case_layer.rs`): through the
 * edit between the two texts, where
 * a region the edit touched, or one the re-cut bore, keeps the cases of its own
 * region or of the region around it: as they ran where the edit's reading
 * spares its kind, and as overwritten elsewhere. A module none of whose cases
 * land or are overwritten leaves the index, as one no run kept cases of is
 * absent from it, rather than standing at lines no text holds. A module whose
 * index already stands at the rows' lines, as one a run recorded does, is
 * carried as it is.
 */

import { native } from '../addon.js';
import type { NativeCaseCut } from '../native-journey.js';
import type { CaseSections } from './case-record.js';
import { caseEdits } from './case-layer.js';
import type { ModuleTexts } from './case-landing.js';
import { indexCut, type CutRegion } from './cases.js';
import { BLOCK_KINDS, NO_OWNER } from './format-layout.js';
import type { TestCoverageView } from './format-view.js';
import type { TestCoverage } from './index.js';
import { whyAbsent } from './native-modules.js';
import type { EditOf, Edits } from './region-edit.js';
import { NO_LINE, writtenLines } from './written-lines.js';

/** The cut each module's rows were landed at, by path: only the modules whose rows moved to another text. */
type RowCuts = ReadonlyMap<string, NativeCaseCut>;

/**
 * `sections` with its index laid onto the rows `landed` holds, where `texts`
 * — the text each module's rows stood at before the landing — says they moved.
 */
export function followRows(
  sections: CaseSections,
  landed: Pick<TestCoverage, 'modules'> | undefined,
  texts: ModuleTexts | undefined,
  edits: Edits,
): CaseSections {
  if (sections.index === undefined || landed === undefined || texts === undefined) return sections;
  const cuts = new Map<string, NativeCaseCut>();
  const digests = new Map<string, string>();
  for (const module of landed.modules) {
    if (!module.instrumented || !moved(texts, module.file, module.sourceDigest)) continue;
    cuts.set(module.file, cutOf(module.file, module.blocks));
    digests.set(module.file, module.sourceDigest);
  }
  return followed(sections, cuts, (file) => edits(file, texts.get(file)!, digests.get(file)!));
}

/** {@link followRows} over the columns of the snapshot a landing wrote, decoding only the modules that moved. */
export function followRowsIn(
  sections: CaseSections,
  landed: TestCoverageView,
  texts: ModuleTexts | undefined,
  edits: Edits,
): CaseSections {
  if (sections.index === undefined || texts === undefined) return sections;
  const digests = new Map<string, string>();
  const path = landed.modulePath.all();
  const source = landed.moduleSource.all();
  const instrumented = landed.moduleInstrumented.all();
  const bounds = landed.moduleBlocks.all();
  const cuts = new Map<string, NativeCaseCut>();
  for (let module = 0; module < path.length; module += 1) {
    if (instrumented[module] !== 1) continue;
    const file = landed.string(path[module]!);
    if (!moved(texts, file, landed.string(source[module]!))) continue;
    digests.set(file, landed.string(source[module]!));
    const blocks: CutRegion[] = [];
    for (let block = bounds[module]!; block < bounds[module + 1]!; block += 1) {
      const owner = landed.blockOwner.at(block);
      blocks.push({
        ordinal: landed.blockOrdinal.at(block),
        kind: BLOCK_KINDS[landed.blockKind.at(block)]!,
        ...(owner === NO_OWNER ? {} : { owner }),
        name: landed.string(landed.blockName.at(block)),
        path: landed.string(landed.blockPath.at(block)),
        ...writtenLines(landed.blockStart.at(block), landed.blockEnd.at(block)),
        source: landed.blockSource.at(block) === 1,
      });
    }
    cuts.set(file, cutOf(file, blocks));
  }
  return followed(sections, cuts, (file) => edits(file, texts.get(file)!, digests.get(file)!));
}

/** Whether a module's rows stand at another text than the one they stood at before the landing; a module nobody named is not known to have moved. */
function moved(texts: ModuleTexts, file: string, landed: string): boolean {
  const before = texts.get(file);
  return before !== undefined && before !== landed;
}

/** A module's rows as a cut no case has entered yet. */
function cutOf(file: string, blocks: readonly CutRegion[]): NativeCaseCut {
  const cut = indexCut(blocks);
  return {
    file,
    blocks: cut.blocks.map((block) => ({ ...block, startLine: block.startLine ?? NO_LINE, endLine: block.endLine ?? NO_LINE })),
    owners: [...cut.owner],
  };
}

/**
 * `sections` with each module `cuts` names laid onto that cut by the addon
 * (`native/src/case_layer.rs`), or as it was when every one already stands at
 * it, or the index is one this build does not lay over.
 */
function followed(sections: CaseSections, cuts: RowCuts, edit: EditOf): CaseSections {
  if (sections.index === undefined || cuts.size === 0) return sections;
  const follow = native()?.followCaseCuts;
  if (follow === undefined) throw new Error(`following the case index onto its rows requires the Sense native addon: ${whyAbsent('followCaseCuts')}`);
  const index = follow(sections.index, [...cuts.values()], caseEdits(cuts.keys(), edit));
  return index === null ? sections : { ...sections, index };
}
