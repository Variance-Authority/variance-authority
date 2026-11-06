// compass: variance-authority.reach
/**
 * The note a reader gives when this checkout's own record won, and the two
 * answers it owes: in git terms, the milestone the record stands on and how
 * far HEAD has moved from it; in record terms, which tests this checkout ran
 * itself, over which state. Every other test is read from the milestone.
 *
 * The record's ledger (`own-layer.ts` in sense) holds both. A record laid
 * before there was a ledger holds neither, and the note says only whose
 * record it is.
 */

import type { OwnLayer, OwnState, Repin, RepinRefusal } from '@variance-authority/sense/test-selection';
import { ask, countPast } from '../clone-cut.js';

/** Test files a state lists by name; past it, a count. */
const LISTED = 20;

export async function checkoutRead(
  suite: string,
  cwd: string,
  base: { readonly layer?: OwnLayer; readonly repin?: Repin },
): Promise<string> {
  const { layer, repin } = base;
  const head = `record of "${suite}": read from this checkout's own`;
  if (layer === undefined) {
    return `${head}, which its runs landed on the base the first of them was laid on; ` +
      "it was laid before checkouts kept a ledger, so which of its tests ran here is not known";
  }
  const pinned = layer.pinned;
  const tests = layer.ran.flatMap((state) => state.files).length;
  // One process for the whole ledger, so a repaint costs the same however much this checkout ran.
  const elsewhere = tests === 0 ? undefined : offBranch(cwd, layer.ran.map((state) => state.commit));
  const over = pinned === undefined
    ? "over the primary checkout's record, which is no mainline record"
    : `over mainline ${pinned.mainline} at ${short(pinned.commit)}, ${await since(cwd, pinned.commit)}`;
  const moved = repin === undefined ? '' : repin.repinned
    ? `; moved from ${short(repin.from)}${repin.dropped.length === 0 ? '' : `, and ${String(repin.dropped.length)} test file(s) that ran over older code than it are read from it now`}`
    : refused(repin.why);
  if (elsewhere === undefined) return `${head}, ${over}${moved}; this checkout has run no test of it itself`;
  const offHead = await elsewhere;
  return `${head}, ${over}${moved}; ${String(tests)} test file(s) ran here, every other is the mainline's: ` +
    layer.ran.map((state) => stateRead(state, offHead)).join('; ');
}

function stateRead(state: OwnState, offHead: ReadonlySet<string>): string {
  const files = state.files.length <= LISTED ? state.files.join(', ') : `${String(state.files.length)} test files`;
  const edits = state.tree === undefined ? '' : ` with uncommitted edits (tree ${short(state.tree)})`;
  return `${files} at ${short(state.commit)}${edits}${offHead.has(state.commit) ? ', not on this branch' : ''}`;
}

function refused(why: RepinRefusal): string {
  switch (why) {
    case 'not-ancestor': return "; the mainline's newest record is not kept as the base, because HEAD does not contain its commit";
    case 'behind': return "; the mainline's newest record is not kept as the base, because it does not descend from this one";
    case 'unknown': return "; the mainline's newest record is not kept as the base, because git cannot place it in this clone";
    case 'busy': return "; the mainline's newest record is not kept as the base yet: another process holds this record";
    case 'unreadable': return "; the mainline's newest record is not kept as the base: it or this record does not read";
    case 'other-mainline': return "; the mainline's newest record is of another mainline than this one, and is not kept as the base";
    case 'current':
    case 'unpinned': return '';
  }
}

/** How far HEAD is from `commit`, as a reader would say it. */
async function since(cwd: string, commit: string): Promise<string> {
  const count = await countPast(cwd, commit, 'HEAD');
  return count === undefined ? 'at a distance this clone cannot count' : `${String(count)} commit(s) before HEAD`;
}

/** Which of `commits` HEAD does not contain. A commit this clone does not hold is not among them: nothing says where it is. */
async function offBranch(cwd: string, commits: readonly string[]): Promise<ReadonlySet<string>> {
  const { code, out } = await ask(cwd, ['rev-list', '--ignore-missing', '--stdin', '^HEAD'], `${[...new Set(commits)].join('\n')}\n`);
  return new Set(code === 0 ? out.split('\n') : []);
}

function short(commit: string): string {
  return commit.slice(0, 12);
}
