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
 * held cases by ({@link laidOn}): through the edit between the two texts, where
 * a region the edit touched, or one the re-cut bore, keeps the cases of its own
 * region or of the region around it only when the edit's reading spares its
 * kind. A module none of whose cases land leaves the
 * index, as one no run kept cases of is absent from it, rather than standing at
 * lines no text holds. A module whose index already stands at the rows' lines, as one a
 * run recorded does, is carried as it is.
 */

import type { CaseSections } from './case-record.js';
import { LaidLines } from './case-layer-lines.js';
import { carriedRow, laidOn, layeredCases, recordedIn } from './case-layer.js';
import type { ModuleTexts } from './case-landing.js';
import { indexCut, type CutRegion } from './cases.js';
import type { SetExecutionModule } from './execution-set-format.js';
import { BLOCK_KINDS, NO_OWNER } from './format-layout.js';
import type { TestCoverageView } from './format-view.js';
import { HeldIndex, writeLaid, type LaidModule } from './held-case-index.js';
import type { TestCoverage } from './index.js';
import { cutAlike } from './region-landing.js';
import { landedThrough, type EditOf, type Edits } from './region-edit.js';
import { EMPTY } from './set-translation.js';
import { writtenLines } from './written-lines.js';

/** The cut each module's rows were landed at, by path: only the modules whose rows moved to another text. */
type RowCuts = ReadonlyMap<string, SetExecutionModule>;

/** Every case the index holds is kept: the landing already decided which. */
const KEEP_EVERY_CASE = { ran: new Set<string>(), finished: new Set<string>(), present: () => true };

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
  const cuts = new Map<string, SetExecutionModule>();
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
  const cuts = new Map<string, SetExecutionModule>();
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
function cutOf(file: string, blocks: readonly CutRegion[]): SetExecutionModule {
  const cut = indexCut(blocks);
  return { file, ...cut, called: new Uint32Array(cut.blocks.length).fill(EMPTY), loaded: new Uint8Array(cut.blocks.length) };
}

function followed(sections: CaseSections, cuts: RowCuts, edit: EditOf): CaseSections {
  if (sections.index === undefined || cuts.size === 0) return sections;
  const index = followCuts(sections.index, cuts, edit);
  return index === undefined ? sections : { ...sections, index };
}

/**
 * The index `previous` with each module `cuts` names laid onto that cut, or
 * `undefined` when every one already stands at it, or the index is one this
 * build does not lay over.
 */
function followCuts(previous: Uint8Array, cuts: RowCuts, edit: EditOf): Buffer | undefined {
  const held = HeldIndex.open(previous);
  if (held === undefined) return undefined;
  const cutAt = recordedIn(held, cuts);
  const rows = held.moduleRows();
  const onto = new Map<number, SetExecutionModule>();
  for (const row of rows) {
    const cut = cutAt.get(held.columns.moduleFile[row]!);
    // FIXME: lines are the only evidence a held module already stands at its
    // rows. A body edited in place moves no line, so its cases stay on the
    // edited region. See the todo in `land-carried-index.test.ts`.
    if (cut !== undefined && !cutAlike(held.module(row), cut)) onto.set(row, cut);
  }
  if (onto.size === 0) return undefined;

  const { tests, fromHeld, merged, heldAt } = layeredCases(held, { tests: [], modules: [], sets: held.columns.sets }, KEEP_EVERY_CASE);
  const lines = LaidLines.open(held.columns.testLines, undefined, heldAt, [], tests.length);
  const modules: LaidModule[] = [];
  for (const row of rows) {
    const cut = onto.get(row);
    if (cut === undefined) {
      const kept = carriedRow(held, row, fromHeld, false);
      if (kept !== undefined) {
        lines?.carried(modules.length, row);
        modules.push(kept);
      }
      continue;
    }
    // FIXME: a region born in the re-cut whose owners recorded none landed is
    // laid with no case, inside a module that stays: absent read as no test,
    // where the rows widen from the region around it. Nothing ran over the new
    // text here, so the empty set is pure absence.
    // A region whose cases land names their lines to `lines` as it is laid, so
    // a module that keeps none named nothing, and leaving it out shifts nobody.
    const module = held.module(row);
    const laid = laidOn(cut, () => EMPTY, { row, module, landing: landedThrough(module, cut, edit(module.file)) },
      { fromHeld, merged, lines, at: modules.length, runModule: -1, ran: EMPTY });
    if (laid.called.some((set) => set !== EMPTY) || laid.loaded.includes(1) || laid.overwritten !== undefined) modules.push(laid);
  }
  return writeLaid(held, tests.map((test) => test.laid), modules, merged.pool(), lines?.finish());
}
