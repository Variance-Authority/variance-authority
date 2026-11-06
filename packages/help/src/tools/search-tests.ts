import { codeUnitOrder } from '@variance-authority/core/segment';
import { recordedCaseNames } from '@variance-authority/sense';
import { tokensOf } from '../search-index.js';
import type { RecordedTests, TestMatch } from './search-matches.js';

// compass: variance-authority.report.agent-surface

/**
 * The recorded test cases a question names: each suite's nearest record, read
 * by the name its runner gave the case, so a block is found however its file
 * spelled it. A name holds every word read of the question, in any order; one
 * that writes the phrase comes first. The record lags the checkout, and the
 * section that prints these says so.
 */

/** Whether `name` holds every one of `words`, each lower case. */
const holdsEvery = (name: string, words: readonly string[]): boolean => {
  const lowered = name.toLowerCase();
  return words.every((word) => lowered.includes(word));
};

/** The cases that answer `query`, the shown few of them, and what was read to say so. */
export function recordedTests(root: string, query: string, within: ReadonlySet<string> | undefined, cap: number): RecordedTests {
  const words = tokensOf(query);
  const phrase = query.trim().toLowerCase();
  const found = new Map<string, TestMatch>();
  const unread: string[] = [];
  let read = 0;
  for (const answer of recordedCaseNames(root)) {
    if ('unread' in answer) {
      if (answer.suite !== undefined) unread.push(answer.suite);
      continue;
    }
    read += answer.cases.length;
    if (words.length === 0) continue;
    for (const { file, name } of answer.cases) {
      if ((within === undefined || within.has(file)) && holdsEvery(name, words)) found.set(`${file}\0${name}`, { source: 'test', name, at: file });
    }
  }
  const writesPhrase = (row: TestMatch): number => (row.name.toLowerCase().includes(phrase) ? 0 : 1);
  const rows = [...found.values()].sort((a, b) => writesPhrase(a) - writesPhrase(b) || codeUnitOrder(a.at, b.at) || codeUnitOrder(a.name, b.name));
  return { total: rows.length, shown: rows.slice(0, cap), read, unread };
}
