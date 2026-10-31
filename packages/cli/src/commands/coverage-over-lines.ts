// compass: variance-authority.reach.crossings
/**
 * `variance coverage`'s split of what ran by the text it ran over, as the
 * cells, clauses and lines the text and the markdown answers print it in.
 *
 * Where the split is asked, the figure an answer leads with is what ran over
 * this text, and what ran over any text is printed beside it, named as such,
 * because a region run only over an older text says nothing about the one in
 * the checkout.
 */

import type { RunOver } from '@variance-authority/sense/test-selection';
import { grouped, ratio } from './coverage-summary.js';
import type { Coverage } from './coverage.js';

/** `3 over an older text · 1 not known`: what ran over no text known to be this one. */
function pastCell(over: RunOver): string {
  return `${grouped(over.older)} over an older text${over.notKnown === 0 ? '' : ` · ${grouped(over.notKnown)} not known`}`;
}

/** `2 over this text · 3 over an older text · 1 not known`; empty when no suite was asked. */
export function overCell(over: RunOver | undefined): string {
  return over === undefined ? '' : `${grouped(over.this)} over this text · ${pastCell(over)}`;
}

/** `over this text; ran in any text 5 (50.0%): 3 over an older text`, beside a figure of what ran over this text. */
export function historyCell(over: RunOver, ran: string): string {
  return `over this text; ran in any text ${ran}: ${pastCell(over)}`;
}

/** `; of them 2 over this text, 3 over an older text, 1 not known` after a total; empty when no suite was asked. */
export function overClause(over: RunOver | undefined): string {
  return over === undefined ? '' : `; of what a suite ran, ${overCell(over).replaceAll(' · ', ', ')}`;
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

/** The breakdown table's rows for what cases ran, parted by text, and each reason a text is not known. */
export function overMarkdown(over: NonNullable<Coverage['count']['over']>, regions: number): { readonly rows: readonly string[]; readonly reasons: readonly string[] } {
  const row = (label: string, count: number) => `| Executed by cases over ${label} | ${grouped(count)} | ${ratio(count, regions)} |`;
  return {
    rows: [row('this text', over.this), row('an older text', over.older), ...(over.notKnown === 0 ? [] : [row('a text not known', over.notKnown)])],
    reasons: over.why.length === 0 ? [] : ['', ...over.why.map((why) => `- Not known: ${why}`)],
  };
}
