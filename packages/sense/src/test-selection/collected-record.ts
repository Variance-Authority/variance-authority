/**
 * A suite's record cut to the test files its runner collects.
 *
 * A record is laid over the one before it, and a test file its run did not run
 * is carried, so a file the suite stopped collecting keeps its row forever: a
 * file deleted, renamed, or moved to another suite when the suite was split.
 * No run can retire it, because a run sees the files it was handed and would
 * retire what it merely did not look at. The runner's list of what the suite
 * collects at the record's commit is the one answer that can, and the mainline
 * publish is handed it.
 */

import { layerCaseIndex, openPrevious } from './case-layer.js';
import { caseSectionsOf, withCaseSections, type CaseSections } from './case-record.js';
import { encodeAsSetExecutionIndex } from './execution-set-format.js';
import { layEyes } from './eyes-record.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import type { TestCoverage } from './index.js';
import { codeUnitOrder } from './instrumented-modules.js';
import { withoutRetired } from './merge-carry.js';

/**
 * `record` without the test files `collected` does not name, and which those
 * were: their rows, their crossings, their cases and their cases' Eyes
 * journals. Their crossings go the way a merge retires a re-recorded file's,
 * so a module only they entered keeps its row with no test on it, as it would
 * there. When the suite collects every file the record holds, `record` itself
 * comes back, byte for byte.
 *
 * Throws when `collected` names none of the test files the record holds: that
 * list was asked of another runner, or names files some other way, and the cut
 * would empty the record.
 */
export function collectedRecord(
  record: Uint8Array,
  collected: ReadonlySet<string>,
): { readonly record: Uint8Array; readonly retired: readonly string[] } {
  // The rows are read off the columns: a record the suite still collects whole
  // is never decoded, and at a large repository's scale that is every publish.
  const view = openTestCoverage(record);
  const rows = Array.from({ length: view.testPath.length }, (_, test) => view.string(view.testPath.at(test)));
  const sections = caseSectionsOf(record);
  const retired = new Set(rows.filter((file) => !collected.has(file)));
  for (const index of [sections.index, sections.before]) {
    for (const test of openPrevious(index)?.tests ?? []) if (!collected.has(test.file)) retired.add(test.file);
  }
  if (retired.size === 0) return { record, retired: [] };
  const coverage = decodeTestCoverage(record);
  if (coverage.tests.length > 0 && coverage.tests.every((test) => retired.has(test.file))) {
    const named = [...retired].sort(codeUnitOrder)[0];
    throw new Error(`the list names none of the ${coverage.tests.length} test file(s) the record holds, ${named} among them, so every one would be retired`);
  }

  return {
    record: withCaseSections(encodeTestCoverage(withoutTests(coverage, retired)), withoutCases(sections, collected)),
    retired: [...retired].sort(codeUnitOrder),
  };
}

function withoutTests(coverage: TestCoverage, retired: ReadonlySet<string>): TestCoverage {
  return {
    ...coverage,
    tests: coverage.tests.filter((test) => !retired.has(test.file)),
    modules: coverage.modules.map((module) => withoutRetired(module, retired)),
  };
}

/**
 * The case sections with the cases of every file `collected` does not name
 * retired, the way a run retires a file the checkout no longer holds. An index
 * this build cannot lay over is carried as it was, for its reader to refuse,
 * and so are the last run's names.
 */
function withoutCases(sections: CaseSections, collected: ReadonlySet<string>): CaseSections {
  const nothing = encodeAsSetExecutionIndex({ tests: [], modules: [] });
  const none = new Set<string>();
  const cut = (index: Uint8Array | undefined): Uint8Array | undefined =>
    openPrevious(index) === undefined
      ? index
      : layerCaseIndex(index, nothing, { ran: none, finished: none, present: (file) => collected.has(file) }).merged;
  const index = cut(sections.index);
  const before = cut(sections.before);
  const cases = openPrevious(index)?.tests;
  const eyes = cases === undefined ? sections.eyes : layEyes(sections.eyes, undefined, cases.map((test) => test.id), []);
  return {
    ...(index === undefined ? {} : { index }),
    ...(before === undefined ? {} : { before }),
    ...(sections.last === undefined ? {} : { last: sections.last }),
    ...(eyes === undefined ? {} : { eyes }),
  };
}
