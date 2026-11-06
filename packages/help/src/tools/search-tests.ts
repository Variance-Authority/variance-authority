import { codeUnitOrder } from '@variance-authority/core/segment';
import { describedWordsNative, phraseOfNative, recordedCaseNames, wordStemsNative, type RecordedCaseName } from '@variance-authority/sense';
import { tokensOf } from '../search-index.js';
import type { CasesUnread, RecordedTests, TestMatch } from './search-matches.js';

// compass: variance-authority.report.agent-surface

/**
 * The recorded test cases a question names: each suite's nearest record, read
 * by the name its runner gave the case, so a block is found however its file
 * spelled it. A name holds a word of the question as a name holds one anywhere
 * in search: a word of it is that word, starts with it, or shares its stem. One
 * that writes the phrase comes first. The record lags the checkout, and the
 * section that prints these says so.
 */

/** What one suite answered, as far as search needs: its cases, or why it has none. */
export type SuiteCaseNames = CasesUnread | { readonly cases: readonly RecordedCaseName[] };

/**
 * Each suite's cases. The section adds to an answer that needs no suite, so a
 * root config that names none leaves it unread and the rest of the answer stands.
 */
export function suiteCaseNames(root: string): readonly SuiteCaseNames[] {
  try {
    return recordedCaseNames(root).map((answer) => ('unread' in answer ? { ...(answer.suite === undefined ? {} : { suite: answer.suite }), why: answer.unread } : answer));
  } catch (error) {
    return [{ why: error instanceof Error ? error.message : String(error) }];
  }
}

/** For each word asked, the words written that hold it. */
function holders(asked: readonly (readonly [string, string])[], written: readonly string[]): readonly ReadonlySet<string>[] {
  const stems = wordStemsNative(written);
  return asked.map(([stem, word]) => new Set(written.filter((one, at) => one.startsWith(word) || stems[at] === stem)));
}

/** The cases that answer `query`, the shown few of them, and what was read to say so. */
export function recordedTests(suites: readonly SuiteCaseNames[], query: string, within: ReadonlySet<string> | undefined, cap: number): RecordedTests {
  const unread = suites.filter((suite) => 'why' in suite);
  const read = suites.flatMap((suite) => ('cases' in suite ? [suite.cases] : []));
  const asked = describedWordsNative(query);
  if (read.length === 0 || asked.length === 0) return { total: 0, shown: [], unread };

  const rows = new Map<string, TestMatch & { readonly words: readonly string[] }>();
  for (const { file, name } of read.flat()) {
    if (within === undefined || within.has(file)) rows.set(`${file}\0${name}`, { source: 'test', name, at: file, words: tokensOf(name) });
  }
  const held = holders(asked, [...new Set([...rows.values()].flatMap((row) => row.words))]);
  const named = [...rows.values()].filter((row) => held.every((words) => row.words.some((word) => words.has(word))));
  const phrases = phraseOfNative(query, named.map((row) => row.name));
  const ordered = named
    .map((row, at) => ({ row, apart: phrases[at] === undefined ? 1 : 0 }))
    .sort((a, b) => a.apart - b.apart || codeUnitOrder(a.row.at, b.row.at) || codeUnitOrder(a.row.name, b.row.name));
  const shown = ordered.slice(0, cap).map(({ row: { source, name, at } }): TestMatch => ({ source, name, at }));
  return { total: named.length, shown, read: read.reduce((sum, cases) => sum + cases.length, 0), unread };
}
