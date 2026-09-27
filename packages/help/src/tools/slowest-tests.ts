/**
 * `docs_slowest_tests` — which recorded test files, and which test cases, took
 * longest, anywhere or somewhere.
 *
 * The duration is the one the test runner reported when the run was recorded:
 * for a file, Vitest's file result, Jest's `perfStats.runtime`, Rstest's file
 * duration; for a case, Vitest's task result, Jest's assertion result, Rstest's
 * test result. Nothing here times anything, and a file or case whose runner
 * reported no duration is counted apart rather than ranked as instant.
 *
 * *Slowest* means little without *where*, so a question may narrow it: `from`
 * keeps the tests declared under a path, `to` the tests the recording says
 * entered one. Both are answered by the recording (`recordedDurations`), which
 * owns what ran where; nothing here walks an import.
 *
 * The reading is `@variance-authority/sense`'s: it opens the snapshot the latest
 * recorded run published, suite by suite, the same way `docs_orient` finds the
 * recorded cases.
 */

// compass: variance-authority.report.agent-surface

import { spawnSync } from 'node:child_process';
import { didYouMean, type Tool } from '@variance-authority/mcp/tools';
import { recordedDurations, recordedPaths, type DurationScope } from '@variance-authority/sense';
import { formatSlowest } from './slowest-format.js';

export { formatSlowest, spent } from './slowest-format.js';

/** Files, and cases, listed per suite when the question names no limit. */
export const SLOWEST = 10;

/** The limit as asked: a whole number of at least one, or the default when none was given. */
export function limitOf(input: Readonly<Record<string, unknown>>): number {
  const said = input['limit'];
  if (said === undefined) return SLOWEST;
  const limit = typeof said === 'string' && said.trim() !== '' ? Number(said) : said;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1) {
    throw new Error(`\`--limit\` takes a whole number of rows, at least 1; it was given \`${String(said)}\`.`);
  }
  return limit;
}

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

/**
 * Refuse a path that is in neither the recording nor the checkout.
 *
 * Git owns what the checkout holds, and the recording what it recorded; a path
 * in either has an answer, even if the answer is that nothing entered it. A
 * path in neither is a typo, and the nearest recorded path is named beside it.
 */
function refuseUnknown(root: string, scope: DurationScope): void {
  let recorded: readonly string[] | undefined;
  for (const path of [...(scope.from ?? []), ...(scope.to ?? [])]) {
    if (tracked(root, path)) continue;
    recorded ??= recordedPaths(root);
    const bare = path.endsWith('/') ? path.slice(0, -1) : path;
    if (recorded.some((held) => held === bare || held.startsWith(`${bare}/`))) continue;
    throw new Error(
      `\`${path}\` is in neither the recording nor the files git tracks under ${root}.` +
        `${didYouMean(bare, withDirectories(recorded))}`,
    );
  }
}

function tracked(root: string, path: string): boolean {
  const listed = spawnSync('git', ['--literal-pathspecs', 'ls-files', '-z', '--', path], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  return listed.status === 0 && listed.stdout !== '';
}

/** Every recorded path and every directory above one, so a mistyped directory has a candidate too. */
function withDirectories(paths: readonly string[]): readonly string[] {
  const all = new Set<string>();
  for (const path of paths) {
    all.add(path);
    for (let cut = path.indexOf('/'); cut !== -1; cut = path.indexOf('/', cut + 1)) all.add(path.slice(0, cut));
  }
  return [...all];
}

const PATHS = { type: 'array', items: { type: 'string' } } as const;

/**
 * Typed over nothing, like `docs_orient`: it reads no workspace value. The
 * checkout is the one the host names on the call, as `invocation.root`; with
 * none named it refuses, because the process's working directory is where the
 * host was launched and not necessarily the checkout it serves.
 */
export const slowestTests: Tool<unknown> = {
  name: 'docs_slowest_tests',
  description:
    'The test files, then the test cases, that took longest in the latest recorded run, slowest first, with ' +
    'the duration the test runner reported for each; a case row names its file and its declaration path. ' +
    '`from` keeps the tests declared under the paths given, `to` the tests the recording says entered code ' +
    'in them, and the two combine. Counts are within that scope, a path the recording has no row for is ' +
    'named as unrecorded, and files and cases whose runner reported no duration are counted, not ranked. ' +
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
      limit: {
        type: 'integer',
        minimum: 1,
        description: `How many files, and how many cases, to list per suite. Defaults to ${SLOWEST}.`,
      },
    },
    additionalProperties: false,
  },

  run: (_subject, input, invocation) => {
    const limit = limitOf(input);
    const scope = scopeOf(input);
    const root = invocation?.root;
    if (root === undefined) {
      throw new Error('`slowest-tests` reads what a checkout published, and this host named no checkout to read');
    }
    refuseUnknown(root, scope);
    return formatSlowest(recordedDurations(root, limit, scope), scope);
  },
};
