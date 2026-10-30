// compass: variance-authority.reach.crossings
/**
 * `variance coverage`'s split of what ran by the text it ran over, as the
 * cells, clauses and lines the text and the markdown answers print it in.
 */

import type { RunOver } from '@variance-authority/sense/test-selection';
import { grouped, ratio } from './coverage-summary.js';
import type { Coverage } from './coverage.js';

/** `3 over an older text · 1 not known`; empty when no suite was asked. */
export function overCell(over: RunOver | undefined): string {
  if (over === undefined) return '';
  return `${grouped(over.older)} over an older text${over.notKnown === 0 ? '' : ` · ${grouped(over.notKnown)} not known`}`;
}

/** `; 3 over an older text, 1 not known` after a total; empty when no suite was asked. */
export function overClause(over: RunOver | undefined): string {
  return over === undefined ? '' : `; ${overCell(over).replace(' · ', ', ')}`;
}

/** Each reason a region's text is not known, once. */
export function notKnownLines(answer: Coverage): readonly string[] {
  return (answer.count.over?.why ?? []).map((why) => `not known: ${why}`);
}

/** `, recorded at 1a2b3c4d` after the commit the answer is at, when a record was made at another. */
export function recordedClause(answer: Coverage, short: (commit: string) => string): string {
  if (answer.at === undefined) return '';
  const other = [...new Set(answer.suites.flatMap((suite) => suite.recorded ?? []))].filter((commit) => commit !== answer.at);
  return other.length === 0 ? '' : `, recorded at ${other.map(short).join(', ')}`;
}

/** The breakdown table's rows for the split, and each reason a text is not known. */
export function overMarkdown(answer: Coverage): { readonly rows: readonly string[]; readonly reasons: readonly string[] } {
  const { over, regions } = answer.count;
  if (over === undefined) return { rows: [], reasons: [] };
  return {
    rows: [
      `| Executed over an older text | ${grouped(over.older)} | ${ratio(over.older, regions)} |`,
      ...(over.notKnown === 0 ? [] : [`| Executed over a text not known | ${grouped(over.notKnown)} | ${ratio(over.notKnown, regions)} |`]),
    ],
    reasons: over.why.length === 0 ? [] : ['', ...over.why.map((why) => `- Not known: ${why}`)],
  };
}
