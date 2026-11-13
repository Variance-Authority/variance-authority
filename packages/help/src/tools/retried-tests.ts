/**
 * `docs_retried_tests` — which recorded test cases ended differently from one
 * attempt to the next, with every attempt of each.
 *
 * Nothing here runs a test or retries one: `recordedAttempts` owns what the
 * runner said of each attempt. A runner reports a retried case as its last
 * attempt, so a case that failed and then passed reads as passed everywhere
 * else; here it is listed with both.
 */

// compass: variance-authority.report.agent-surface

import type { Tool } from '@variance-authority/mcp/tools';
import { recordedAttempts, type RecordedAttempts, type RetriedCase } from '@variance-authority/sense';
import { limitOf, spellingOf } from '@variance-authority/mcp/tools';
import { recordLine, spent } from './slowest-format.js';

/** Cases listed per suite when the question names no limit. */
export const RETRIED = 10;

/** How much of a failure's first line an attempt row prints. */
const MESSAGE_WIDTH = 120;

const NAMED = 'Ended differently across attempts';

/** An attempt the record has no row of: the process running it died before the runner said how it ended. */
const UNSAID = 'ended unreported';

/** The answer, from what each suite's recording said, read at `now`. */
export function formatRetried(suites: readonly RecordedAttempts[], now: number): string {
  return suites
    .map((suite) => {
      const named = `${NAMED}${suite.suite === undefined ? '' : `, suite ${suite.suite}`}`;
      return [...recordLine(suite, now).flatMap((line) => [line, '']), ...told(suite, named)].join('\n');
    })
    .join('\n\n');
}

function told(suite: RecordedAttempts, named: string): string[] {
  if ('unread' in suite) return [`${named}: none read from ${suite.recording}, ${suite.unread}.`];
  if ('unkept' in suite) {
    return [
      `${named}: attempts were not kept in ${suite.recording}, so it does not say whether a case was retried. ` +
        'A run keeps them when its runner reports each attempt and every shard of it kept them.',
    ];
  }
  if (suite.retried === 0) return [`${named}: none; no case of the ${suite.cases} recorded ran more than once.`];
  if (suite.differing === 0) return [`${named}: none; the ${suite.retried} retried case(s) ended the same way every attempt.`];
  const same = suite.retried - suite.differing;
  return [
    `${named}:`,
    ...suite.differed.flatMap(caseLines),
    `${suite.differed.length} of ${suite.differing} case(s) shown` +
      `${same === 0 ? '.' : `; ${same} other retried case(s) ended the same way every attempt.`}`,
  ];
}

/** One case and, under it, each attempt: how it ended, how long it ran, and where and with what it failed. */
function caseLines({ file, name, limit, attempts }: RetriedCase): string[] {
  return [
    `  ${file}  ${name}${limit === undefined ? '' : `  (limit ${spent(limit)})`}`,
    ...Array.from({ length: attempts.at(-1)?.attempt ?? 0 }, (_, at) => {
      const { ended, duration, frame, message } = attempts.find(({ attempt }) => attempt === at + 1) ?? { ended: UNSAID };
      return [`    attempt ${at + 1}`, ended, duration === undefined ? undefined : spent(duration), frame, firstLine(message)]
        .filter((part) => part !== undefined)
        .join('  ');
    }),
  ];
}

function firstLine(message: string | undefined): string | undefined {
  const line = message?.split('\n', 1)[0]?.trim();
  if (line === undefined || line === '') return undefined;
  return line.length > MESSAGE_WIDTH ? `${line.slice(0, MESSAGE_WIDTH - 1).trimEnd()}…` : line;
}

/** Typed over nothing, like `docs_slowest_tests`: the checkout is the one the host names on the call. */
export const retriedTests: Tool<unknown> = {
  name: 'docs_retried_tests',
  description:
    'Which record it read, whose run, at which commit and how old; then the test cases whose attempts ended ' +
    'differently in that run, such as one that failed and then passed on retry, which its runner reported as ' +
    'passed. Each case names its file, its declaration path and its limit, then every attempt in order: how it ' +
    'ended as its runner said it, how long it ran, and for one that did not pass the frame inside the checkout ' +
    'and the first line of what it failed with. Retried cases that ended the same way every attempt are counted, ' +
    'not listed, and a case that ran once has no attempts. An attempt whose process died before the runner said ' +
    'how it ended reads `ended unreported`. A record whose run kept no attempts is said to be that, never that ' +
    'no case was retried. It speaks of one recorded run, not of how often a case fails. ' +
    'Reads the recording a test run with test selection published; runs and retries nothing itself.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        minimum: 1,
        description: `How many cases to list per suite. Defaults to ${RETRIED}.`,
      },
    },
    additionalProperties: false,
  },

  run: (_subject, input, invocation) => {
    const limit = limitOf(input, RETRIED, spellingOf(invocation));
    const root = invocation?.root;
    if (root === undefined) {
      throw new Error('`retried-tests` reads what a checkout published, and this host named no checkout to read');
    }
    return formatRetried(recordedAttempts(root, limit), Date.now());
  },
};
