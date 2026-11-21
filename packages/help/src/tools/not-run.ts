/**
 * `docs_not_run` — the declared checks a recorded run did not execute, each
 * named with the case whose attempt passed without it, where the case is
 * declared and where it calls the check.
 *
 * Nothing here runs a test: `recordedChecks` owns what the cases declared and
 * each attempt entered. A case whose check did not run can still pass, and its
 * verdict then stands for less than it declared; here the two are told apart.
 * The reading speaks of the cases the run ran, under whichever runner ran them.
 */

// compass: variance-authority.report.agent-surface

import type { Tool } from '@variance-authority/mcp/tools';
import { recordedChecks, type RecordedChecks } from '@variance-authority/sense';
import { eachSuite } from './slowest-format.js';

const NAMED = 'Declared checks not executed';

/** The answer, from what each suite's recording said, read at `now`. */
export function formatNotRun(suites: readonly RecordedChecks[], now: number): string {
  return eachSuite(suites, now, NAMED, told);
}

function told(suite: RecordedChecks, named: string): string[] {
  if ('unread' in suite) return [`${named}: none read from ${suite.recording}, ${suite.unread}.`];
  if ('unkept' in suite) {
    return [
      `${named}: checks were not kept in ${suite.recording}, so it does not say whether a declared check ran. ` +
        'A run keeps them when a case it ran declares one with `checked(id, fn)`.',
    ];
  }
  return [
    ...(suite.missing.length === 0
      ? [`${named}: none.`]
      : [
          `${named}:`,
          ...suite.missing.map(({ check, line, case: one, attempt }) =>
            `  expected check ${check} did not execute in case ${one.name} ` +
            `(case ${one.file}:${one.line}, check line ${line}${one.project === undefined ? '' : `, project ${one.project}`}` +
            `${attempt === undefined ? '' : `, attempt ${attempt}`}), which passed`),
        ]),
    `${suite.entered} declared check(s) entered.`,
    ...(suite.incomplete.length === 0
      ? []
      : [`Incomplete, stopped before their runner ended them, so none of their checks is named: ${suite.incomplete.join(', ')}.`]),
  ];
}

/** Typed over nothing, like `docs_retried_tests`: the checkout is the one the host names on the call. */
export const notRun: Tool<unknown> = {
  name: 'docs_not_run',
  description:
    'Which record it read, whose run, at which commit and how old; then each check a test case declared that ' +
    'an attempt of it passed without executing, as `expected check <id> did not execute in case <name>`, with the ' +
    'file and line declaring the case, the line calling the check, its project, and the attempt when it ran more than once — ' +
    'a case can pass without its check. Then how many declared checks were entered, and the test files whose ' +
    'recording stopped before their runner ended them, which name no check missing. A record whose run kept no checks is said ' +
    'to be that, never that every check ran. A case declares a check by calling `checked(id, fn)` from ' +
    '`@variance-authority/sense/checked` in its body, or in a helper of its file it calls; an id built at run time declares nothing. ' +
    'Reads the recording a test run with test selection published; runs nothing itself.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },

  run: (_subject, _input, invocation) => {
    const root = invocation?.root;
    if (root === undefined) {
      throw new Error('`not-run` reads what a checkout published, and this host named no checkout to read');
    }
    return formatNotRun(recordedChecks(root), Date.now());
  },
};
