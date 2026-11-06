import { opening, PARAGRAPH_BREAK } from '@variance-authority/package/help';
import { describedWordsNative } from '@variance-authority/sense';

// compass: variance-authority.report.agent-surface

/** What a row prints of a doc. */
export type Said = (doc: string) => string;

/** A code block's fences and what they hold: code is no sentence of the doc. */
const CODE_BLOCK = /^[ \t]*```[\s\S]*?^[ \t]*```[ \t]*$/gm;

/** A sentence ends where a stop meets the capital, the code or the bracket that opens the next. */
const SENTENCE_BREAK = /(?<=[.!?])\s+(?=[A-Z`[(])/;

/** Each sentence of a doc, on one line, in order. A tag line starts a new one. */
function sentencesOf(doc: string): readonly string[] {
  return doc
    .replace(CODE_BLOCK, '')
    .split(PARAGRAPH_BREAK)
    .flatMap((paragraph) => paragraph.split(/\n(?=[ \t]*@)/))
    .flatMap((part) => part.replace(/\s+/g, ' ').trim().split(SENTENCE_BREAK))
    .filter((sentence) => sentence !== '');
}

/**
 * What a row prints of its doc for `query`: the sentence holding the most of the
 * question's distinct stems, the earliest of those that hold as many, read by the
 * rule the question is, so a reader can check `[holds: …]` on the row itself. A
 * doc that holds none of them, as a name reached by its own words has, prints its
 * opening.
 */
export function saidFor(query: string): Said {
  const asked = new Set(describedWordsNative(query).map(([stem]) => stem));
  if (asked.size === 0) return opening;
  return (doc) => {
    let best: string | undefined;
    let most = 0;
    for (const sentence of sentencesOf(doc)) {
      const held = describedWordsNative(sentence).filter(([stem]) => asked.has(stem)).length;
      if (held > most) [best, most] = [sentence, held];
    }
    return best ?? opening(doc);
  };
}
