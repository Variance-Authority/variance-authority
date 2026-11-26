/**
 * `docs_not_run` — the declared checks a recorded run did not execute, each
 * named with the case that passed without it and where the case is declared.
 *
 * Nothing here runs a test: `recordedChecks` owns what the run declared and
 * entered. A case whose check did not run can still pass, and its verdict then
 * stands for less than it declared; here the two are told apart. The reading
 * speaks of the run's own scope, which it names, and of nothing it left out.
 */

// compass: variance-authority.report.agent-surface

import type { Tool } from '@variance-authority/mcp/tools';
import { recordedChecks, type ChecksScope, type RecordedChecks } from '@variance-authority/sense';
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
        'A run keeps them when its runner reports the steps each case entered.',
    ];
  }
  const scope = `Scope: ${scopeOf(suite.scope)}; a case outside it was not asked about.`;
  if (!suite.complete) {
    return [
      `${named}: none named; the run is incomplete, stopped before its runner ended it, so a case it cut short was not done.`,
      scope,
    ];
  }
  return [
    ...(suite.missing.length === 0
      ? [`${named}: none.`]
      : [
          `${named}:`,
          ...suite.missing.map(({ check, case: one, attempt }) =>
            `  expected check ${check} did not execute in case ${one.name} ` +
            `(${one.file}:${one.line}${one.project === undefined ? '' : `, project ${one.project}`}` +
            `${attempt === undefined ? '' : `, attempt ${attempt}`}), which passed`),
        ]),
    `${suite.entered} declared check(s) entered.`,
    scope,
  ];
}

/** The projects the run collected, their greps, the shard it was cut to and what a selection skipped. */
function scopeOf({ projects, grep, grepInvert, shard, skipped }: ChecksScope): string {
  const named = projects.map(({ name, grep, grepInvert }) =>
    [`project ${name === '' ? '(unnamed)' : name}`, grep === undefined ? undefined : `grep ${grep}`, grepInvert === undefined ? undefined : `grep-invert ${grepInvert}`]
      .filter((part) => part !== undefined)
      .join(', '));
  return [
    ...named,
    ...(grep === undefined ? [] : [`--grep ${JSON.stringify(grep)}`]),
    ...(grepInvert === undefined ? [] : [`--grep-invert ${JSON.stringify(grepInvert)}`]),
    ...(shard === undefined ? [] : [`shard ${shard.current} of ${shard.total}`]),
    ...(skipped === undefined ? [] : [`${skipped} spec file(s) a test selection skipped`]),
  ].join('; ') || 'every case';
}

/** Typed over nothing, like `docs_retried_tests`: the checkout is the one the host names on the call. */
export const notRun: Tool<unknown> = {
  name: 'docs_not_run',
  description:
    'Each check a test case declared, with the annotation `variance:check` and a step of the same ' +
    'title, that a passing attempt never executed in the latest recorded run, with the file and line ' +
    'declaring the case: a case can pass without its check. It also counts the checks that ran and ' +
    'the scope the run covered. Reads the recording; runs nothing.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },

  run: (_subject, _input, invocation) => {
    const root = invocation?.root;
    if (root === undefined) {
      throw new Error('`not-run` reads what a checkout published, and this host named no checkout to read');
    }
    return formatNotRun(recordedChecks(root), Date.now());
  },
};
