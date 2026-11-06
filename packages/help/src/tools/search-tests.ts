import { codeUnitOrder } from '@variance-authority/core/segment';
import { describedWordsNative, nameTermsOf, phraseOfNative, recordedCaseNames, type RecordedCaseName } from '@variance-authority/sense';
import { dictionaryOf } from './loose-declared.js';
import { matchingTerms, termsOfStems } from './loose.js';
import type { CasesUnread, RecordedTests, TestMatch } from './search-matches.js';

// compass: variance-authority.report.agent-surface

/**
 * The recorded test cases a question names: each suite's nearest record, read
 * by the name its runner gave the case, so a block is found however its file
 * spelled it. A name is cut as an exported name is, so it holds a word of the
 * question as a name holds one anywhere in search: a word of it is that word,
 * starts with it, or shares its stem. One that writes the phrase comes first. The record lags the checkout, and the
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

/** The cases that answer `query`, the shown few of them, and what was left unread. */
export function recordedTests(suites: readonly SuiteCaseNames[], query: string, within: ReadonlySet<string> | undefined, cap: number): RecordedTests {
  const unread = suites.filter((suite) => 'why' in suite);
  const asked = describedWordsNative(query);
  if (asked.length === 0) return { total: 0, shown: [], unread };

  const rows = new Map<string, TestMatch>();
  for (const { file, name } of suites.flatMap((suite) => ('cases' in suite ? suite.cases : []))) {
    if (within === undefined || within.has(file)) rows.set(`${file}\0${name}`, { source: 'test', name, at: file });
  }
  const cases = [...rows.values()];
  const { terms, held } = nameTermsOf(cases.map((row) => row.name));
  const dictionary = dictionaryOf(terms);
  const stemmed = termsOfStems(dictionary, asked.map(([stem]) => stem));
  const reached = asked.map(([, word], at) => new Set([...matchingTerms(dictionary, word, 0), ...(stemmed[at] ?? [])]));
  const named = cases.filter((_, at) => reached.every((words) => held[at]?.some((term) => words.has(term))));
  const phrases = phraseOfNative(query, named.map((row) => row.name));
  const ordered = named
    .map((row, at) => ({ row, apart: phrases[at] === undefined ? 1 : 0 }))
    .sort((a, b) => a.apart - b.apart || codeUnitOrder(a.row.at, b.row.at) || codeUnitOrder(a.row.name, b.row.name));
  return { total: named.length, shown: ordered.slice(0, cap).map(({ row }) => row), unread };
}
