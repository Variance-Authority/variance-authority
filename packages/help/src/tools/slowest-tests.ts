/**
 * `docs_slowest_tests` — which recorded test cases are closest to their limit,
 * and which test files and cases took longest, anywhere or somewhere.
 *
 * Nothing here times anything or walks an import: `recordedDurations` owns what
 * the runner reported and what ran where. `from`, `to` and `over` narrow its
 * answer, and `formatSlowest` tells it.
 */

// compass: variance-authority.report.agent-surface

import type { Tool } from '@variance-authority/mcp/tools';
import { recordedDurations, type DurationScope } from '@variance-authority/sense';
import { limitOf, spellingOf, type Spelling } from '@variance-authority/mcp/tools';
import { formatSlowest } from './slowest-format.js';
import { recordedOnce, refuseUnknownPath } from './unknown-path.js';
import { oneQuestion } from './one-question.js';

/** Files, and cases, listed per suite when the question names no limit. */
export const SLOWEST = 10;

/** `from` and `to` as asked: each a list of paths, a lone string read as a list of one. */
export function scopeOf(input: Readonly<Record<string, unknown>>): DurationScope {
  const paths = (which: 'from' | 'to'): readonly string[] | undefined => {
    const said = input[which];
    const listed: readonly unknown[] = typeof said === 'string' ? [said] : Array.isArray(said) ? said : [];
    const kept = listed
      .filter((path): path is string => typeof path === 'string')
      .map((path) => path.trim().replace(/^\.\//, ''))
      .filter((path) => path !== '');
    return kept.length === 0 ? undefined : kept;
  };
  const from = paths('from');
  const to = paths('to');
  return { ...(from === undefined ? {} : { from }), ...(to === undefined ? {} : { to }) };
}

const TIME = /^(\d+(?:\.\d+)?)(ms|s)$/u;

/** `over` as asked, in milliseconds: `3s`, `1.5s`, `500ms`. Anything else is refused, never read as no filter. */
export function overOf(input: Readonly<Record<string, unknown>>, spell: Spelling): number | undefined {
  const said = input['over'];
  if (said === undefined) return undefined;
  const time = typeof said === 'string' ? TIME.exec(said.trim()) : null;
  if (time === null) {
    throw new Error(`\`${spell.input('over')}\` takes a time such as \`3s\` or \`500ms\`; it was given \`${String(said)}\`.`);
  }
  return Math.round(Number(time[1]) * (time[2] === 's' ? 1000 : 1));
}

/** Refuse a `from` or `to` path that is in neither the recording nor the checkout. */
function refuseUnknown(root: string, scope: DurationScope): void {
  const recorded = recordedOnce(root);
  for (const path of [...(scope.from ?? []), ...(scope.to ?? [])]) refuseUnknownPath(root, path, recorded);
}

const PATHS = { type: 'array', items: { type: 'string' } } as const;

/**
 * Typed over nothing, like `docs_orient`: it reads no workspace value. The
 * checkout is the one the host names on the call, as `invocation.root`; with
 * none named it refuses, because the process's working directory is where the
 * host was launched and not necessarily the checkout it serves.
 */
export const slowestTests: Tool<unknown> = oneQuestion({
  name: 'docs_slowest_tests',
  description:
    'Which record it read, whose run, at which commit and how old; then the test cases closest to their limit, ' +
    'each as its run and its limit; then the test files and the test cases that took longest in that run, slowest ' +
    'first, with what each took as its test runner timed it, a file\'s time including its environment, setup files ' +
    'and import before its first case; a case row names its file and its declaration path. ' +
    'A case that recorded its slowest statement carries it on one more line: the file line, its time on the real ' +
    'clock, and its share of the case. ' +
    'A run spans hooks and attempts and a limit one attempt, so a passing case can read above its limit. ' +
    '`from` keeps the tests declared under the paths given, `to` the tests the recording says entered code ' +
    'in them, and the two combine. `over` keeps only the cases that ran at least that long, and leaves the files ' +
    'out. Counts are within that scope, a path the recording has no row for is named as unrecorded, and files and ' +
    'cases whose runner reported no duration are counted, not ranked; a case with no limit is ranked by time alone. ' +
    'Reads the recording a test run with test selection published; runs and times nothing itself.',
  inputSchema: {
    type: 'object',
    properties: {
      from: {
        ...PATHS,
        description:
          'Optional. Repo-relative paths; only tests declared in a file at or under one. A directory ' +
          'matches on a `/` boundary, a file exactly.',
      },
      to: {
        ...PATHS,
        description:
          'Optional. Repo-relative paths; only tests the recording says entered code in a file at or ' +
          'under one. Read from the recording, not from imports.',
      },
      over: {
        type: 'string',
        description: 'Optional. A time such as `3s` or `500ms`; only the cases that ran at least that long.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        description: `How many files, and how many cases, to list per suite. Defaults to ${SLOWEST}.`,
      },
    },
    additionalProperties: false,
  },

  run: (_subject, input, invocation) => {
    const spell = spellingOf(invocation);
    const limit = limitOf(input, SLOWEST, spell);
    const over = overOf(input, spell);
    const scope = scopeOf(input);
    const root = invocation?.root;
    if (root === undefined) {
      throw new Error('`slowest-tests` reads what a checkout published, and this host named no checkout to read');
    }
    refuseUnknown(root, scope);
    return formatSlowest(recordedDurations(root, limit, scope, over), scope, over, Date.now());
  },
});
