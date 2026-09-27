/**
 * `docs_slowest_tests` — which recorded test files took longest.
 *
 * The duration is the one the test runner reported for the file when the run
 * was recorded: Vitest's file result, Jest's `perfStats.runtime`, Rstest's file
 * duration. Nothing here times anything, and a file whose runner reported no
 * duration is counted apart rather than ranked as instant.
 *
 * The reading is `@variance-authority/sense`'s: it opens the snapshot the latest
 * recorded run published, suite by suite, the same way `docs_orient` finds the
 * recorded cases.
 */

// compass: variance-authority.report.agent-surface

import type { Tool } from '@variance-authority/mcp/tools';
import { recordedDurations, type RecordedDurations } from '@variance-authority/sense';

/** Files listed per suite when the question names no limit. */
export const SLOWEST = 10;

/** The limit as asked: a whole number of at least one, or the default when none was given. */
export function limitOf(input: Readonly<Record<string, unknown>>): number {
  const said = input['limit'];
  if (said === undefined) return SLOWEST;
  const limit = typeof said === 'string' && said.trim() !== '' ? Number(said) : said;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`\`--limit\` takes a whole number of files, at least 1; it was given \`${String(said)}\`.`);
  }
  return limit;
}

/** A duration as a reader compares them: milliseconds under a second, seconds to a tenth above. */
export function spent(milliseconds: number): string {
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

/** The answer, from what each suite's recording said. */
export function formatSlowest(suites: readonly RecordedDurations[]): string {
  const lines: string[] = [];
  for (const suite of suites) {
    const named = suite.suite === undefined ? 'Slowest recorded test files' : `Slowest recorded test files, suite ${suite.suite}`;
    if (lines.length > 0) lines.push('');
    if ('unread' in suite) {
      lines.push(`${named}: none read from ${suite.recording}, ${suite.unread}. A recorded test run writes it.`);
      continue;
    }
    const total = suite.timed + suite.untimed;
    if (suite.timed === 0) {
      lines.push(
        `${named}: none of the ${total} file(s) in ${suite.recording} has a recorded duration. ` +
          'The next recorded run stores what its runner reports.',
      );
      continue;
    }
    const widths = suite.slowest.map((row) => spent(row.duration).length);
    const wide = Math.max(...widths);
    lines.push(
      `${named}, as their runner reported them, from ${suite.recording}:`,
      ...suite.slowest.map((row) => `  ${spent(row.duration).padStart(wide)}  ${row.file}`),
      `${suite.slowest.length} of ${suite.timed} timed file(s) shown` +
        `${suite.untimed === 0 ? '.' : `; ${suite.untimed} recorded file(s) have no duration.`}`,
    );
  }
  return lines.join('\n');
}

/**
 * Typed over nothing, like `docs_orient`: it reads no workspace value. The
 * checkout is the working directory, or the root of a tree the host already
 * read.
 */
export const slowestTests: Tool<unknown> = {
  name: 'docs_slowest_tests',
  description:
    'The test files that took longest in the latest recorded run, slowest first, with the duration the test ' +
    'runner reported for each. Files whose runner reported no duration are counted, not ranked. Reads the ' +
    'recording a test run with test selection published; runs and times nothing itself.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: {
        type: 'integer',
        minimum: 1,
        description: `How many files to list per suite. Defaults to ${SLOWEST}.`,
      },
    },
    additionalProperties: false,
  },

  run: (_subject, input, invocation) => {
    const limit = limitOf(input);
    // TODO: a call served by `variance-authority-help --root <dir>` reads the
    // working directory, not that root, unless the host read a tree; the
    // invocation has no field for the root on its own.
    const root = invocation?.tree?.root ?? process.cwd();
    return formatSlowest(recordedDurations(root, limit));
  },
};
