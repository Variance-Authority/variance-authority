// compass: variance-authority.reach.story
/**
 * A page that tells its own executions' stories, the way a server head does
 * under Vantage.
 *
 * A page clicked by hand has no runner to hand its drains to: `reportPage`
 * names an execution at load and at every click or submit, and sends what it
 * ran to the watcher. A build asked for stories puts {@link toldCollectorSource}
 * where the collector was, so the page tapes as a browser test's does
 * ({@link storyPageSource}) and keeps a teller beside it. `reportPage` hands the
 * teller every drain and, when an execution ends, asks it for the story, which
 * rides on the execution's account as a server head's does.
 *
 * The teller keeps what a live head keeps of one execution: the visits and
 * notes up to the same part budgets, the rest counted, and what a function was
 * handed — never what a module holds, which a live head does not tell either.
 * Its bytes are `story-bytes.cts`', the ones a test's story is written with, so a
 * page's story reads as any other.
 */

import storyTap from '../instrument/story-tap.cjs';
import { TELLER_GLOBAL } from '../test-selection/execution-global.js';
import storyBytes from './story-bytes.cjs';
import { storyPageSource } from './page.js';

/**
 * The script that installs the teller on the realm it runs in. Each drain is
 * laid after the one before it, the realm's rows kept as the latest drain
 * gives them: one document's rows only grow, so a visit's index means the same
 * region in every drain.
 */
export function pageTellerSource(): string {
  return `(() => {
const MAGIC = ${JSON.stringify(storyBytes.MAGIC)};
const INDEX = ${storyBytes.INDEX};
const EVALUATING = ${storyBytes.EVALUATING};
const PART_LIMIT = ${storyTap.PART_LIMIT};
const PART_NOTES = ${storyTap.PART_NOTES};
const rowAt = (${storyBytes.rowAt.toString()});
const storyBytes = (${storyBytes.storyBytes.toString()});
const encoder = new TextEncoder();
let told;
const fresh = () => { told = { tape: [], visits: 0, notes: [], unnoted: 0, rows: undefined, added: false }; };
fresh();
globalThis[${JSON.stringify(TELLER_GLOBAL)}] = {
  add(story) {
    const held = new Set(story.held.map(([, text]) => text));
    const offset = told.tape.length;
    for (const entry of story.tape) if (told.tape.length < PART_LIMIT) told.tape.push(entry);
    told.visits += story.visits;
    for (const [at, text] of story.notes) {
      if (held.has(text)) continue;
      if (told.notes.length < PART_NOTES) told.notes.push([Math.min(offset + at, told.tape.length), text]);
      else told.unnoted += 1;
    }
    told.unnoted += story.unnoted;
    told.rows = story.rows;
    // A drain the execution ran nothing in is no news: a quiet page tells nothing.
    if (story.visits > 0 || story.notes.some(([, text]) => !held.has(text)) || story.unnoted > 0) told.added = true;
  },
  tell(key) {
    if (!told.added) return undefined;
    const bytes = storyBytes(
      {
        tape: Int32Array.from(told.tape), taped: told.tape.length, visits: told.visits, at: [0], keys: [key],
        notes: told.notes.map(([at, text]) => [at, key, text]), lines: [], unnoted: told.unnoted, held: new Map(),
        rows: told.rows,
      },
      key, { file: key, name: '' }, (text) => encoder.encode(text),
    );
    fresh();
    let binary = '';
    for (let at = 0; at < bytes.length; at += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(at, at + 0x8000));
    return btoa(binary);
  },
};
})();
`;
}

/**
 * The collector a build asked for stories serves: the page tape and the
 * teller first, each within the budget of one execution, then `collector`.
 * Only a page installs them; a realm whose seam already records, or one with
 * no document, evaluates the collector alone.
 */
export function toldCollectorSource(collector: string): string {
  return `if (globalThis.__VA__ === undefined && typeof document === 'object') {
${storyPageSource(storyTap.PART_LIMIT)}
${pageTellerSource()}
}
${collector}`;
}
