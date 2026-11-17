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
 * The teller keeps what a live head keeps of one execution, with the live
 * head's own parts ([`story-parts.cts`](../instrument/story-parts.cts)): the
 * visits, the notes of each kind and their bytes up to the same budgets, the
 * rest counted, and what a function was handed — never what a module holds,
 * which a live head does not tell either. Its bytes are `story-bytes.cts`', the
 * ones a test's story is written with, so a page's story reads as any other.
 */

import storyParts from '../instrument/story-parts.cjs';
import storyTap from '../instrument/story-tap.cjs';
import { TELLER_GLOBAL } from '../test-selection/execution-global.js';
import storyBytes from './story-bytes.cjs';
import { storyPageSource } from './page.js';

/**
 * The script that installs the teller on the realm it runs in.
 *
 * The page tape is a test's, read out at every drain, so the teller plays each
 * drain into one live part as it ran: the notes said after a visit after it.
 * The realm's rows are the latest drain's, which one document's rows only add
 * to, so a visit's index means the same region in every drain.
 */
export function pageTellerSource(): string {
  return `(() => {
const MAGIC = ${JSON.stringify(storyBytes.MAGIC)};
const INDEX = ${storyBytes.INDEX};
const EVALUATING = ${storyBytes.EVALUATING};
const PART_LIMIT = ${storyParts.PART_LIMIT};
const PART_NOTES = ${storyParts.PART_NOTES};
const PART_TEXT_BYTES = ${storyParts.PART_TEXT_BYTES};
const utf8Length = (${storyParts.utf8Length.toString()});
const encodedLength = (${storyParts.encodedLength.toString()});
const rowAt = (${storyBytes.rowAt.toString()});
const storyBytes = { rowAt, storyBytes: (${storyBytes.storyBytes.toString()}) };
const createParts = (${storyParts.createParts.toString()});
const encoder = new TextEncoder();
// One part, under one key: a page runs one execution at a time, and \`reportPage\` names it when it is told.
const PART = 'page';
const rows = { ids: [], counts: [], bases: [] };
const parts = createParts({ root: { a: 0, s: null }, current: () => ({ key: PART }) }, PART_LIMIT, rows);
globalThis[${JSON.stringify(TELLER_GLOBAL)}] = {
  add(story) {
    for (const key of ['ids', 'counts', 'bases']) rows[key].splice(0, rows[key].length, ...story.rows[key]);
    const held = new Set(story.held.map(([, text]) => text));
    let said = 0;
    const speak = (until) => {
      for (; said < story.notes.length && story.notes[said][0] <= until; said += 1) {
        const text = story.notes[said][1];
        if (held.has(text)) continue;
        const into = parts.here();
        if (parts.room(into, text.startsWith('handed ') ? 'handed' : 'spoken')) parts.note(text);
      }
    };
    for (const [at, entry] of story.tape.entries()) {
      speak(at);
      parts.tape(entry);
    }
    speak(Infinity);
    // What the page counted and did not keep, the part counts as its own.
    if (story.visits > story.taped || story.unnoted > 0) {
      const into = parts.here();
      into.visits += story.visits - story.taped;
      into.unnoted += story.unnoted;
    }
  },
  tell(key) {
    // An execution that ran nothing since it was last told tells nothing.
    const taken = parts.take(PART);
    if (taken === undefined) return undefined;
    const bytes = storyBytes.storyBytes(
      {
        ...taken, taped: taken.tape.length, keys: taken.keys.map(() => key), lines: [], held: new Map(),
        notes: taken.notes.map(([at, , text]) => [at, key, text]), rows,
      },
      key, { file: key, name: '' }, (text) => encoder.encode(text),
    );
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
 * no document, evaluates the collector alone. A runner that tapes the page for
 * its own cases put its maker there before any document loaded, and the first
 * maker stays: a server head tapes only for a watcher, and so does a page.
 */
export function toldCollectorSource(collector: string): string {
  return `if (globalThis.__VA__ === undefined && typeof document === 'object') {
${storyPageSource(storyTap.PART_LIMIT)}
${pageTellerSource()}
}
${collector}`;
}
