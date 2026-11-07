/**
 * `docs_containment` — how far the commits of a window reached across package
 * boundaries, read from the log and counted.
 *
 * It measures and stops there: nothing selects on these figures, nothing is
 * stored, and a share says what commits touched together, not what caused it.
 * The packages are the ones the workspace lists now, because a history holds no
 * list of its own.
 */

// compass: variance-authority.report.agent-surface

import { readFileSync } from 'node:fs';
import { dirname, relative, sep } from 'node:path';
import type { Tool } from '@variance-authority/mcp/tools';
import { members } from '@variance-authority/package';
import { firstParentChanges, trackedFiles, type CommitChanges } from '@variance-authority/sense';
import { operatorError } from '../operator.js';
import { countContainment, type ContainmentCount, type Share } from './containment-count.js';

/** The figures and what they were read over. */
export interface Containment extends ContainmentCount {
  /** What every figure is: commits touching things together, never a cause. */
  readonly reading: 'co-occurrence';
  readonly after: string;
  /** How many packages the workspace lists now. */
  readonly packages: number;
  readonly shallow: boolean;
}

/** A date git would not read as something else: its own reader takes `lately` for now. */
function dateOf(said: string): string {
  const real = /^\d{4}-\d{2}-\d{2}$/u.test(said) && !Number.isNaN(Date.parse(said)) && new Date(said).toISOString().startsWith(said);
  if (!real) throw operatorError(`\`--after\` takes a date as YYYY-MM-DD, not \`${said}\``);
  return said;
}

/** The day a year before `now`, the window a question that names none is read over. */
function yearBefore(now: Date): string {
  const then = new Date(now);
  then.setUTCFullYear(then.getUTCFullYear() - 1);
  return then.toISOString().slice(0, 10);
}

function packageDirectories(root: string): readonly string[] {
  const manifests = members(root, (path) => JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>);
  return manifests.map((manifest) => relative(root, dirname(manifest)).split(sep).join('/')).filter((dir) => dir !== '');
}

function changesOf(root: string, after: string): CommitChanges & { readonly tracked: readonly string[] } {
  try {
    return { ...firstParentChanges(root, after), tracked: trackedFiles(root) };
  } catch (error) {
    throw operatorError(`\`git log\` could not read this checkout's history: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

/** The figures for the checkout at `root`, over the window `input` names. */
export function containmentOf(root: string, input: Readonly<Record<string, unknown>>): Containment {
  const said = input['after'];
  const after = typeof said === 'string' ? dateOf(said) : yearBefore(new Date());
  const { commits, shallow, tracked } = changesOf(root, after);
  const packages = packageDirectories(root);
  return { reading: 'co-occurrence', after, packages: packages.length, shallow, ...countContainment(commits, tracked, packages) };
}

function shared({ count, of }: Share): string {
  return of === 0 ? `${String(count)} of ${String(of)}` : `${String(count)} of ${String(of)} (${(count / of * 100).toFixed(1)}%)`;
}

/** The figures as a person reads them, with what each counted beside it. */
export function formatContainment(figures: Containment): string {
  const { leftOut } = figures;
  const left = leftOut.noParent + leftOut.bot + leftOut.noSource + leftOut.noPackage;
  if (figures.packages === 0) {
    return `The workspace here lists no package, so there is no boundary to count across. ${String(figures.read)} first-parent commits read since ${figures.after}.`;
  }
  return [
    `${String(figures.counted)} commits since ${figures.after} changed source, of ${String(figures.read)} first-parent commits read from HEAD.`,
    'These count what commits touched together, not what caused it.',
    ...(figures.shallow ? ['This is a shallow clone, so the log holds only the commits it was fetched with.'] : []),
    '',
    `touched one package: ${shared(figures.onePackage)}`,
    `edited a test in another package: ${shared(figures.testInAnotherPackage)}`,
    `  of those that edited their own tests: ${shared(figures.anotherGivenOwnTests)}`,
    `  of those that did not: ${shared(figures.anotherGivenNoOwnTests)}`,
    `edited a test outside the packages they changed, in a test-only tree: ${shared(figures.testOnlyTree)}`,
    '',
    `Left out, ${String(left)} of ${String(figures.read)}:`,
    `  no parent to compare with: ${String(leftOut.noParent)}`,
    `  by a bot: ${String(leftOut.bot)}`,
    `  touched no source: ${String(leftOut.noSource)}`,
    `  touched source in no package: ${String(leftOut.noPackage)}`,
    '',
    `A merge is one commit, compared with its first parent. Packages are the ${String(figures.packages)} the workspace lists now, and one holding no source is a test-only tree.`,
    'A test is named as a test or sits with the tests, fixtures and snapshots included. Generated and vendored code is neither test nor source.',
  ].join('\n');
}

/** Typed over nothing, like `docs_orient`: the checkout is the one the host names on the call. */
export const containment: Tool<unknown> = {
  name: 'docs_containment',
  description:
    'How far the commits of a window reached across package boundaries, counted from `git log`: the share that ' +
    'touched one package, the share that edited a test in another package or in a test-only tree, and the share ' +
    'that edited a test in another package among commits that did and did not edit their own tests. Each is a ' +
    'count over its denominator, and what was left out is counted by reason. They say what commits touched ' +
    'together, not what caused it. Reads git and the workspace list; runs nothing and stores nothing.',
  inputSchema: {
    type: 'object',
    properties: {
      after: { type: 'string', description: 'Optional. The first day counted, as YYYY-MM-DD; a year ago when left out.' },
    },
    additionalProperties: false,
  },

  run: (_subject, input, invocation) => {
    const root = invocation?.root;
    if (root === undefined) throw new Error('`docs_containment` reads the history of a checkout, and this host named none');
    return formatContainment(containmentOf(root, input));
  },
};
