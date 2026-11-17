// compass: variance-authority.reach.story
/**
 * A page that tells its own executions' stories, the way a server head does
 * under Vantage.
 *
 * A page clicked by hand has no runner to hand its drains to: `reportPage`
 * names an execution at load and at every click or submit, and sends what it
 * ran to the watcher. A build asked for stories puts {@link toldCollectorSource}
 * where the collector was, so the page tapes as a live head does
 * ({@link storyPageSource} given a part) and keeps a teller beside it. When an
 * execution ends, `reportPage` asks the teller for its story, which rides on
 * the execution's account as a server head's does.
 *
 * The page's tap is a live head's ([`story-tap.cts`](../instrument/story-tap.cts)):
 * one part, bounded as a head bounds an execution's, holding what a function
 * was handed and never what a module holds. Its bytes are `story-bytes.cts`',
 * the ones a test's story is written with, so a page's story reads as any other.
 */

import storyTap from '../instrument/story-tap.cjs';
import { TELLER_GLOBAL } from '../test-selection/execution-global.js';
import storyBytes from './story-bytes.cjs';
import { storyPageSource } from './page.js';

// The one part a page tapes into: a page runs one execution at a time, and `reportPage` names it when it is told.
const PART = 'page';

/**
 * The script that installs the teller on the realm it runs in. It takes the
 * page's part from the tap and writes it as a live head writes one. Nothing
 * says when a click has finished running, so an execution not ended is told
 * once a flush finds its part grew no more since the one before: what it
 * runs after that is told again. A part holding notes alone waits for the
 * end, so a page that only paints spends none of the watcher's tellings.
 * `reportPage` sets `telling` while it reports, so the collector's drains
 * leave the part to the teller, and clears it when a driver claims the page.
 * Given `room`, the story it tells is at most that long: the first of what ran
 * and what was said, and the rest counted, as a tape that stopped counts it.
 */
export function pageTellerSource(): string {
  return `(() => {
const MAGIC = ${JSON.stringify(storyBytes.MAGIC)};
const INDEX = ${storyBytes.INDEX};
const EVALUATING = ${storyBytes.EVALUATING};
const rowAt = (${storyBytes.rowAt.toString()});
const storyBytes = (${storyBytes.storyBytes.toString()});
const encoder = new TextEncoder();
let before = -1;
const encode = (part, key) => {
  const bytes = storyBytes(
    { ...part, keys: part.keys.map(() => key), notes: part.notes.map(([at, , text]) => [at, key, text]) },
    key, { file: key, name: '' }, (text) => encoder.encode(text),
  );
  let binary = '';
  for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
  return btoa(binary);
};
// The first \`kept\` visits of a part and the first \`said\` of the notes said by then.
const cut = (part, kept, said) => {
  const notes = part.notes.filter(([at]) => at <= kept).slice(0, said);
  const segments = part.at.flatMap((at, segment) => (segment === 0 || at < kept ? [segment] : []));
  return {
    ...part, taped: kept, at: segments.map((segment) => part.at[segment]), keys: segments.map((segment) => part.keys[segment]),
    notes, unnoted: part.unnoted + part.notes.length - notes.length,
  };
};
globalThis[${JSON.stringify(TELLER_GLOBAL)}] = {
  telling: false,
  tell(key, ended, room) {
    const tap = globalThis.__VA__?.[Symbol.for('variance-authority.story.tap')];
    if (tap === undefined) return undefined;
    if (!ended) {
      const { visits } = tap.holding();
      const grew = visits !== before;
      before = visits;
      if (visits === 0 || grew) return undefined;
    }
    before = -1;
    // An execution that ran nothing since it was last told tells nothing.
    const taken = tap.take(${JSON.stringify(PART)});
    if (taken.visits === 0 && taken.notes.length === 0 && taken.unnoted === 0) return undefined;
    let told = encode(taken, key);
    // Halved until it fits, the visits or the notes said by then, whichever weighs more.
    for (let kept = taken.taped, said = taken.notes.length; room !== undefined && told.length > room && kept + said > 0; ) {
      const notes = taken.notes.filter(([at]) => at <= kept).slice(0, said);
      const words = notes.reduce((sum, [, , text]) => sum + text.length, 0);
      if (kept > 0 && kept * 4 >= words) kept >>= 1;
      else said = notes.length >> 1;
      told = encode(cut(taken, kept, said), key);
    }
    return told;
  },
};
})();
`;
}

/**
 * The collector a build asked for stories serves: the page tape and the
 * teller first, each within the budget of one execution, then `collector`.
 * Only a page installs them; a realm whose seam already records, or one with
 * no document, evaluates the collector alone. A runner that tapes the page for
 * its own cases put its maker there before any document loaded, and the first
 * maker stays. Unlike a server head, which tapes only while a watcher listens,
 * a page tapes from its first module, before `reportPage` can say whether one does.
 */
export function toldCollectorSource(collector: string): string {
  return `if (globalThis.__VA__ === undefined && typeof document === 'object') {
${storyPageSource(storyTap.PART_LIMIT, PART)}
${pageTellerSource()}
}
${collector}`;
}
