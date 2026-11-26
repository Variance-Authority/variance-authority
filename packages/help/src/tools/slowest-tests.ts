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
import { formatSlowest, RECORDING } from './slowest-format.js';
import { recordedOnce, refuseUnknownPath } from './unknown-path.js';

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
export const slowestTests: Tool<unknown> = {
  name: 'docs_slowest_tests',
  description:
    'The test files and cases that took longest in the latest recorded run, slowest first, as the ' +
    'runner timed them, after the cases closest to their timeout. A file\'s time includes its ' +
    'environment, setup files and imports; a case\'s slowest statement is named when it held a ' +
    `millisecond or more. ${RECORDING}; runs and times nothing.`,
  inputSchema: {
    type: 'object',
    properties: {
      from: {
        ...PATHS,
        description:
          'Optional. Repo-relative paths; only tests declared in a file at or under one, a folder matched on a `/` boundary.',
      },
      to: {
        ...PATHS,
        description:
          'Optional. As `from`, for tests the recording says ran code there. With `from`, a test must meet both.',
      },
      over: {
        type: 'string',
        description: 'Optional. A time such as `3s`; only the cases that ran at least that long, and no files.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        description: `Files, and cases, per suite; ${SLOWEST} when not said.`,
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
};
