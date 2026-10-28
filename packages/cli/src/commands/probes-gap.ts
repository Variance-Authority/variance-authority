// compass: variance-authority.reach
/**
 * What a record cut under probes this build does not place still answers, and
 * the questions the difference leaves open.
 *
 * A record names the probe recipe that cut it. A recipe changes when the walk
 * that cuts a module into regions changes, and after that the same source can
 * be cut into other regions. The record still says which of its own regions
 * ran and which cases ran them, at its own commit, so every reader answers from
 * it as it would from any record. What it cannot say is whether a region this
 * build cuts and that recipe did not ran, so the reader names both recipes and
 * that question beside the answer.
 *
 * The identity is compared for equality and nothing else: a recipe this build
 * emits is current, and every other one, whatever it is called, is not. What
 * the difference leaves open is read from the record and the source, never
 * from the name: for one file, its regions in the record are counted against
 * the regions this build cuts in the text the record was made over.
 *
 * The note names no run: it is about which build cut the record, and the run
 * that closes a question an answer leaves open is the answer's gap, counted
 * (`evidence-gap.ts`). When this machine holds a mainline record cut under
 * this build's probes that is not the one read, the note says where it is;
 * otherwise it names the gap and stops.
 */

import { INSTRUMENTATION_ID, instrumentModeOf } from '@variance-authority/sense/instrument';
import type { ExecutionBlock } from '@variance-authority/sense/test-selection';

/** A record cut under probes this build does not place. */
export interface ProbesGap {
  /** The record read. */
  readonly record: string;
  /** The probes the record says cut it. */
  readonly recordedUnder: string;
  /** The probes this build places by default. */
  readonly places: string;
  /** A mainline record of the same suite on this machine, cut under this build's probes, which is not the one read. */
  readonly current?: { readonly commit: string; readonly coverage: string };
}

/** How one file's regions in the record stand against the regions this build cuts in the same text. */
export type CutGap =
  | { readonly file: string; readonly same: number }
  | { readonly file: string; readonly unrecorded: readonly string[]; readonly uncut: readonly string[] }
  | { readonly file: string; readonly unread: string };

/**
 * The gap between the record at `record` and this build's probes, or
 * `undefined` when there is none: the record names a recipe this build emits,
 * or holds no coverage of ours to name one (an index a foreign tool wrote).
 */
export async function probesGap(record: string, root: string, suite?: string): Promise<ProbesGap | undefined> {
  const selection = await import('@variance-authority/sense/test-selection');
  const under = identityOf(selection.askCoverageFile, record);
  if (under === undefined || instrumentModeOf(under) !== undefined) return undefined;
  let fetched: ReturnType<typeof selection.lastFetchedMainline>;
  try {
    fetched = selection.lastFetchedMainline(root, suite);
  } catch {
    fetched = undefined;
  }
  const current = fetched !== undefined && fetched.coverage !== record &&
      instrumentModeOf(identityOf(selection.askCoverageFile, fetched.coverage) ?? '') !== undefined
    ? { commit: fetched.commit, coverage: fetched.coverage }
    : undefined;
  return { record, recordedUnder: under, places: INSTRUMENTATION_ID, ...(current === undefined ? {} : { current }) };
}

/** The identity a coverage record names, or nothing for a file that is not one. */
function identityOf(ask: (file: string, question: (view: { readonly instrumentation: string }) => string) => string, file: string): string | undefined {
  try {
    return ask(file, (coverage) => coverage.instrumentation);
  } catch {
    return undefined;
  }
}

/**
 * How `file`'s regions in the record stand against the regions this build
 * cuts in the text at `commit`, the commit the record was made at.
 *
 * The text is cut as a run records it (`sourceCut`), so each region carries
 * the lines it spans. Regions are matched by what they are — kind, declaration
 * name and structural path — and by those lines, because a recipe can cut a
 * region of the same name over other lines, and then the record's lines are
 * not this build's. They are counted, because a name can repeat: two `map`
 * callbacks in one function are both `fn/map.arg0`. The walk is presence's,
 * the default, because a recipe this build does not emit does not say which
 * mode cut it, and the note says which walk it compared against.
 */
export async function cutGap(root: string, commit: string | undefined, file: string, blocks: readonly ExecutionBlock[]): Promise<CutGap> {
  if (commit === undefined) return { file, unread: 'the record names no commit, so the text it was made over is not known' };
  const { sourceCut, textAtRecording } = await import('@variance-authority/sense/test-selection');
  const text = textAtRecording(root, [file])(file, commit);
  if (text === undefined) return { file, unread: `git holds no text of it at ${commit}` };
  const cut = sourceCut(text, file, 'presence');
  if (cut === undefined) return { file, unread: `this build cannot parse it as it stood at ${commit}` };
  const recorded = counted(blocks);
  const placed = counted(cut.rows);
  const short = (from: Map<string, number>, against: Map<string, number>) =>
    [...from].flatMap(([key, count]) => Array.from({ length: Math.max(0, count - (against.get(key) ?? 0)) }, () => key));
  const unrecorded = short(placed, recorded);
  const uncut = short(recorded, placed);
  if (unrecorded.length === 0 && uncut.length === 0) return { file, same: blocks.length };
  return { file, unrecorded, uncut };
}

/** A region as the record and this build's cut both hold it. */
interface Cut {
  readonly kind: string;
  readonly name: string;
  readonly path: string;
  readonly source: boolean;
  readonly startLine?: number;
  readonly endLine?: number;
}

/** Each region said for a person, with the lines it spans when it has source of its own, counted. */
function counted(blocks: readonly Cut[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const block of blocks) {
    const lines = !block.source || block.startLine === undefined
      ? ''
      : block.endLine === undefined || block.endLine === block.startLine
        ? ` on line ${block.startLine}`
        : ` on lines ${block.startLine}-${block.endLine}`;
    const key = `${block.kind} \`${block.name}\`${block.path === '' || block.path === 'entry' ? '' : ` at ${block.path}`}${lines}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** At most this many regions are named in a note; the rest are counted. */
const NAMED = 5;

/**
 * The note a reader gives beside an answer read from a record with a probes
 * gap: both recipes, what the answer is, what is left open, and, for one file,
 * what the record and this build make of it. `reads` is the flag the reader
 * names a record by, when it has one.
 */
export function probesNote(gap: ProbesGap, cut?: CutGap, reads?: string): string {
  const opening = `\`${gap.record}\` was cut under the probes \`${gap.recordedUnder}\`, and this build places \`${gap.places}\`: ` +
    'what ran and which cases ran it is read from the record as it holds it, at its own commit';
  const open = cut === undefined
    ? '; a region this build cuts that those probes did not is not in it, so whether such a region ran is not answered, ' +
      'and `variance covering --file <path>` names any such region in one file'
    : cutText(cut);
  const elsewhere = gap.current === undefined
    ? ''
    : `. The mainline's record published at ${gap.current.commit} is cut under this build's probes and is on this machine at \`${gap.current.coverage}\`, ` +
      "beneath this checkout's own, which is read first" + (reads === undefined ? '' : `; \`${reads}\` with that path reads it`);
  return `${opening}${open}${elsewhere}.`;
}

function cutText(cut: CutGap): string {
  // A recipe also changes when what a hit means changes, and an equal cut does not show that it did not.
  if ('same' in cut) {
    return `; in ${cut.file} this build's presence walk cuts the same ${cut.same} regions, at the same lines, that the record holds; ` +
      'whether a hit means the same under both probes is not compared';
  }
  if ('unread' in cut) return `; whether this build cuts ${cut.file} as the record does is not answered: ${cut.unread}`;
  const parts: string[] = [];
  if (cut.unrecorded.length > 0) {
    parts.push(`this build's presence walk cuts ${listed(cut.unrecorded)} in ${cut.file}, which the record has no region for, so whether ${cut.unrecorded.length === 1 ? 'it' : 'they'} ran is not answered`);
  }
  if (cut.uncut.length > 0) {
    parts.push(`the record holds ${listed(cut.uncut)}, which this build does not cut, so the lines of ${cut.uncut.length === 1 ? 'that region' : 'those regions'} belong in this build to the region around them`);
  }
  return `; ${parts.join('; ')}`;
}

function listed(regions: readonly string[]): string {
  const named = regions.slice(0, NAMED).join(', ');
  return regions.length > NAMED ? `${named} and ${regions.length - NAMED} more` : named;
}
