/**
 * What a change to a module does, read from both of its texts before any region
 * of it is charged.
 *
 * A line number says where an edit sits, not what it does. A comment above the
 * imports, a new function, a type, and a changed top-level call all sit in the
 * module's own region, and that region's crossings are every test that loaded
 * the file. The parser can tell them apart given the text on both sides, and
 * the caller already holds the old one: `sourceAt` is how the frame was proved.
 * The new one is that text with the diff's hunks applied (`patch.ts`).
 *
 * The addon answers with one verdict per file, and each charges differently:
 *
 * - `none`: the runtime text is equal. Nothing is charged. A `none` marked
 *   `kept` is not the addon's: the selection found the diff's new side equal
 *   to the text the record was taken over, and asked no parser.
 * - `bodies`: what the module does as it loads is equal, and every binding it
 *   makes holds the same value. The regions the lines map to are charged,
 *   without the module's own region.
 * - `values`: the same, except that some bindings' values moved. The regions,
 *   and every place that reads those values: a function's region for a read
 *   inside it, the module for a read made as it loads, and the same question
 *   one file further for every direct importer of an exported one.
 * - `load`: the load sequence moved, and the module is charged as it always was.
 *
 * A change travels by use and by nothing else. Loading a module is assumed to
 * do nothing but declare what it exports, so an importer that never reads a
 * moved name is not reached by it, and neither is anything behind that
 * importer. A test that loaded the declaring file through no importer the
 * reading followed is not charged either: it is reported as `unseen`, because
 * an edge the graph does not hold is a defect to fix where it is, not a reason
 * to charge every test that loaded the file.
 *
 * A package can say otherwise, in the field every bundler reads for it:
 * `sideEffects`. A changed file its package declares, or an import added or
 * removed whose target's package declares it, makes the verdict `load`, and the
 * reading names the modules that made it so (`effects`). The manifest answers
 * through the resolver the scan uses, from `root`.
 *
 * A file the recording holds no row for — new, or never instrumented — has no
 * regions to charge, so every name it exports counts as moved and its readers
 * answer for it (`readRowless`). One that names no export, as a CommonJS
 * module's `module.exports` does not, is left to its importers, answered whole.
 *
 * A file that could not be read is charged as it always was, and the reading
 * says why. A file in no module language — a Rust or Python file the graph
 * holds — is `language`, not `parse`: nothing tried to parse it.
 */

import { extname } from 'node:path';
import { nodeAt } from '@variance-authority/core/relate';
import { chargeModule, firstId, readValues } from './reading-values.js';
import { native } from '../addon.js';
import type { NativeScanner } from '../native.js';
import { MODULE_EXTENSIONS } from '../read.js';
import { blocksAround, gapInside, moduleRegion, outsideRegions, regionOf } from './blocks-around.js';
import type { LineRange } from './diff-lines.js';
import { declaredEffects } from './effects.js';
import { commitFrame, type Frame } from './frame.js';
import type { TestCoverageView } from './format-view.js';
import { importedAsAsset } from './importers.js';
import { findTest } from './lookup.js';
import { applied, hunksOf } from './patch.js';
import { isUnasked, type ExecutionNarrowingOptions, type SelectionReason, type Unasked } from './narrowing.js';

/** What the reading made of one changed file, or why it made nothing. */
export type FileReading =
  | {
      readonly file: string;
      readonly verdict: 'none' | 'bodies' | 'values' | 'load';
      /** The bindings whose values moved, for `values`. */
      readonly names: readonly string[];
      /**
       * The tests that loaded the file and reached it through no importer the
       * reading followed. Present when importers were followed: a moved export
       * of a file with a row.
       */
      readonly unseen?: readonly string[];
      /**
       * The files whose package declares that loading them does something, and
       * which turned the verdict to `load`: the file itself, or a file an import
       * it started or stopped binding loads, directly or through what it imports.
       */
      readonly effects?: readonly string[];
      /**
       * A `none` the parser never decided: the record kept the text it was
       * taken over, and the diff's new side is that text (`rebasedChange`).
       * It says nothing of a test carried from an earlier text: the landing
       * demoted each that ran an edited region, and it is selected as
       * incomplete. Absent for every verdict the parser gave.
       */
      readonly kept?: true;
    }
  | {
      readonly file: string;
      readonly verdict?: undefined;
      /**
       * `source`: the caller gave no `sourceAt`, so no old text was proved.
       * `hunk`: a context or removed line is not the recorded text's.
       * `parse`: one of the two texts does not parse.
       * `addon`: no native scanner on this machine.
       * `language`: not a JavaScript or TypeScript module, the only language
       * the verdict reads.
       * `exports`: a file with no row that names no export to follow, as a
       * CommonJS module's `module.exports` does not: its importers answer whole.
       */
      readonly unread: 'source' | 'hunk' | 'parse' | 'addon' | 'language' | 'exports' | Unasked;
    };

/** Whether the change may reach a test through the file: every reading but a `none` the parser decided, or no reader. */
export const reachesThrough = (reading: FileReading): boolean => (reading.verdict === undefined ? !isUnasked(reading.unread) : reading.verdict !== 'none' || reading.kept === true);

/** What the reading needs from the query it runs inside. */
export interface ReadingContext {
  readonly coverage: TestCoverageView;
  readonly options: ExecutionNarrowingOptions;
  readonly knownAs: (file: string) => readonly string[];
  readonly hunks: ReturnType<typeof hunksOf>;
  /** Charge one block of a module row: every test that crossed it, less those that disowned it. */
  readonly charge: (file: string, block: number, reason: SelectionReason) => void;
  /** Select one test file directly. */
  readonly pick: (test: number, reason: SelectionReason) => void;
  /** Select every test that loaded a file with no row: the graph's walk over its importers names them. */
  readonly whole: (file: string, reason: Extract<SelectionReason, { readonly kind: 'reader' }>) => void;
}

/**
 * Read one changed file whose frame was proved, and charge what the verdict
 * says. `charged` is false when the verdict leaves the file to the caller —
 * `load`, or no reading at all — which charges it as a line-mapped change.
 */
export function readChange(
  context: ReadingContext,
  file: string,
  ranges: readonly LineRange[],
  frame: Frame,
  rowsOf: ReadonlyMap<string, readonly number[]>,
): { readonly reading: FileReading; readonly charged: boolean } {
  if (!MODULE_EXTENSIONS.includes(extname(file))) return { reading: { file, unread: 'language' }, charged: false };
  const scanner = native();
  if (scanner?.moduleVerdict === undefined || scanner.moduleReaders === undefined) {
    return { reading: { file, unread: 'addon' }, charged: false };
  }
  const patched = applied(frame.text, context.hunks.get(file) ?? []);
  if (patched === undefined) return { reading: { file, unread: 'hunk' }, charged: false };
  const verdict = scanner.moduleVerdict(frame.name, frame.text, patched.after);
  if (verdict === null) return { reading: { file, unread: 'parse' }, charged: false };

  const reading = { file, verdict: verdict.kind, names: verdict.names };
  if (verdict.kind === 'load') return { reading, charged: false };
  if (verdict.kind === 'none') return { reading, charged: true };
  const effects = declaredEffects(context.options.root, context.options.relations, file, verdict.imported);
  if (effects.length > 0) {
    // The lines of a body edit map to the body alone; a declared load is every
    // test that loaded the file.
    chargeModule(context, file, rowsOf, (at, block) => regionOf(context.coverage, at, block));
    return { reading: { file, verdict: 'load', names: [], effects }, charged: true };
  }

  // The regions the lines map to, as 0030 reads them, without the module's own:
  // the verdict proved that what the module does as it loads did not move.
  const { coverage } = context;
  for (const [name, rows] of rowsOf) {
    for (const module of rows) {
      const first = coverage.moduleBlocks.at(module);
      const end = coverage.moduleBlocks.at(module + 1);
      for (const range of ranges) {
        // An insertion no region spans is text between regions. The verdict
        // proved it loads nothing, and a value it moves is charged to its
        // readers below, so nothing recorded ran the text itself.
        if (range.added !== undefined && !gapInside(coverage, first, end, range)) continue;
        // A line no region holds, the module's included, is above the first
        // statement or below the last: a deleted license comment, or the top
        // of the file an insertion opens. The frame proved this is the text the
        // regions were cut from, so nothing recorded ran the line either.
        if (outsideRegions(coverage, first, end, range)) continue;
        for (const block of blocksAround(coverage, first, end, range)) {
          if (!moduleRegion(coverage, block)) context.charge(file, block, regionOf(coverage, name, block));
        }
      }
    }
  }
  if (verdict.kind === 'values') {
    const own = scanner.moduleReaders(frame.name, frame.text, verdict.names, false);
    // The same text parsed a moment ago, so a null is the addon disagreeing
    // with itself, and the module is what is left to say.
    if (own === null) chargeModule(context, file, rowsOf, (at, block) => regionOf(coverage, at, block));
    else {
      const unseen = readValues(context, file, frame, rowsOf, verdict, own);
      if (unseen !== undefined) return { reading: { ...reading, unseen }, charged: true };
    }
  }

  return { reading, charged: true };
}

/**
 * Read a changed module the recording holds no row for, against the text it
 * had at the recorded commit or against nothing when it is new. Nothing ran
 * it that the recording can place, so the question is only who reads what it
 * exports: every export counts as moved, and each importer's readers are
 * charged as they are for a moved value. `undefined` for a file this reading
 * does not apply to — not in the graph, or loaded as an asset, where the
 * import itself is the use — and `charged: false` for a `load` verdict or no
 * reading, which leaves the file to the walk over its importers.
 */
export function readRowless(
  context: ReadingContext,
  file: string,
): { readonly reading: FileReading; readonly charged: boolean } | undefined {
  const subject = rowlessSubject(context, file);
  if (subject === undefined || 'unread' in subject) return subject && { reading: subject, charged: false };
  const { coverage } = context;
  const { names, sourceAt, scanner } = subject;

  const frame = commitFrame(coverage, names, subject.name, sourceAt);
  const patched = applied(frame.text, context.hunks.get(file) ?? []);
  if (patched === undefined) return { reading: { file, unread: 'hunk' }, charged: false };
  const verdict = scanner.moduleVerdict(frame.name, frame.text, patched.after);
  const now = scanner.moduleReaders(frame.name, patched.after, [], false);
  if (verdict === null || now === null) return { reading: { file, unread: 'parse' }, charged: false };
  const reading = { file, verdict: verdict.kind, names: verdict.names };
  if (verdict.kind === 'load') return { reading, charged: false };
  if (verdict.kind === 'none') return { reading, charged: true };
  const effects = declaredEffects(context.options.root, context.options.relations, file, verdict.imported);
  if (effects.length > 0) return { reading: { file, verdict: 'load', names: [], effects }, charged: false };

  const exports = [...new Set([...now.interface, ...verdict.gone])];
  // Nothing named means no reader can be asked about it, not that nothing reads
  // it. A test answers for itself, whatever it exports.
  if (exports.length === 0 && names.every((name) => findTest(coverage, name) === undefined)) {
    return { reading: { file, unread: 'exports' }, charged: false };
  }
  readValues(context, file, frame, new Map(), { ...verdict, exports }, now);
  return { reading, charged: true };
}

/** The names `readRowless` asks `sourceAt` for `file`'s recorded text under: none when it reads no text. */
export function rowlessNames(context: ReadingContext, file: string): readonly string[] {
  const subject = rowlessSubject(context, file);
  return subject === undefined || 'unread' in subject ? [] : subject.names;
}

/** What `readRowless` reads `file` with, why it reads nothing, or `undefined` when no reading applies. */
function rowlessSubject(
  context: ReadingContext,
  file: string,
):
  | { readonly names: readonly string[]; readonly name: string; readonly sourceAt: SourceAt; readonly scanner: ModuleScanner }
  | Extract<FileReading, { readonly unread: unknown }>
  | undefined {
  const { relations, sourceAt } = context.options;
  if (relations === undefined || sourceAt === undefined) return undefined;
  const names = context.knownAs(file);
  const id = firstId(relations, [...names, file]);
  if (id === undefined || importedAsAsset(relations, id)) return undefined;
  if (!MODULE_EXTENSIONS.includes(extname(file))) return { file, unread: 'language' };
  const scanner = native();
  if (!readsModules(scanner)) return { file, unread: 'addon' };
  return { names, name: nodeAt(relations, id)!.name, sourceAt, scanner };
}

type ModuleScanner = NativeScanner & Required<Pick<NativeScanner, 'moduleVerdict' | 'moduleReaders'>>;
type SourceAt = NonNullable<ExecutionNarrowingOptions['sourceAt']>;

function readsModules(scanner: NativeScanner | undefined): scanner is ModuleScanner {
  return scanner?.moduleVerdict !== undefined && scanner.moduleReaders !== undefined;
}
