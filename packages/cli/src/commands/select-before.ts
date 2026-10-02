// compass: variance-authority.reach
/**
 * What a suite rests on before any of its tests imports anything, and whether
 * this diff moved it.
 *
 * The runner config, the setup it loads, the environment package that setup
 * imports: each runs before the first test does, so no test's recording holds a
 * line of it, and the record would answer a change to one with nobody. Which
 * files those are is a fact only the repository knows, so it is declared — the
 * suite's own `before` beside its kind, and the repository's `before` under
 * every suite — and each entry is walked forward through the whole file graph,
 * so what it loads, directly or not, rests under it too. A change anywhere in
 * that closure runs the whole suite.
 *
 * Nothing declared is nothing before reach. A changed config file then answers
 * like any other file the record holds no line of, and a note says so: the
 * declaration is the operator's to make, and no name rule makes it for them.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeReach, changedBefore, type Relations } from '@variance-authority/core/relate';
import { listed, many } from './reach.js';

/** Whether the diff moved what the suite rests on, and what to say either way. */
export interface Rests {
  /** The files and packages the diff moved before reach, as they were named; empty when it moved none. */
  readonly rests: readonly string[];
  /** Said after the verdict whichever way it went. */
  readonly notes: readonly string[];
}

/**
 * Walk `suite`'s declared entries down `relations`, and name what of `changed`
 * and `packages` lies in that closure. `suite` is the suite whose record is
 * read; `undefined` reads what every suite rests on, which is the repository's
 * own list when it declares no suites.
 */
export async function restsOf(
  root: string,
  suite: string | undefined,
  relations: Relations,
  changed: readonly string[],
  packages: readonly string[],
): Promise<Rests> {
  const selection = await import('@variance-authority/sense/test-selection');
  const entries = suite === undefined
    ? [...selection.beforeOf(root, undefined), ...(selection.declaredSuites(root) ?? []).flatMap((one) => one.before ?? [])]
    : selection.beforeOf(root, suite);
  const whose = suite === undefined ? 'this repository' : `the suite ${suite}`;
  if (entries.length === 0) {
    return {
      rests: [],
      notes: [
        `${whose} declares nothing before reach, so a change to its runner config or the setup it loads ` +
          'is read like any other file; name them in `before` to run the whole suite when they change',
      ],
    };
  }

  const before = beforeReach(relations, entries);
  const rests = [...new Set(changedBefore(before, changed, packages))].sort();
  // An entry the scan does not hold is ordinary when it is a `.nvmrc` or a
  // workflow directory, which load nothing. One that is not on disk at all is
  // a declaration that covers nothing, and is named.
  const missing = before.unread.filter((entry) => !existsSync(join(root, entry)));
  return {
    rests,
    notes:
      missing.length === 0
        ? []
        : [
            `\`before\` names ${many(missing.length, 'path')} not in this checkout (${listed(missing)}), so ` +
              `${missing.length === 1 ? 'it covers' : 'each covers'} only a change that adds it back`,
          ],
  };
}

/** The sentence a whole run gives for what it rests on. */
export function restsSaid(suite: string | undefined, rests: readonly string[]): string {
  const whose = suite === undefined ? 'every suite here' : `the suite ${suite}`;
  return `${whose} rests on ${listed(rests)} before any test imports ${rests.length === 1 ? 'it' : 'them'}, and this diff moves ${rests.length === 1 ? 'it' : 'them'}`;
}

/** What a selection carries from {@link restsOf}: its notes, and the reason for a whole run when the diff moved what the suite rests on. */
export interface Resting {
  readonly resting?: readonly string[];
  readonly whole?: string;
}

/** {@link restsOf}, said: the notes as a selection carries them, and the sentence a whole run gives. */
export async function restingOf(
  root: string,
  suite: string | undefined,
  relations: Relations,
  changed: readonly string[],
  packages: readonly string[],
): Promise<Resting> {
  const rest = await restsOf(root, suite, relations, changed, packages);
  return {
    ...(rest.notes.length === 0 ? {} : { resting: rest.notes }),
    ...(rest.rests.length === 0 ? {} : { whole: restsSaid(suite, rest.rests) }),
  };
}

/**
 * The suite a journey file speaks for: the one named, or the only one declared.
 *
 * Undefined otherwise. A journey file is not kept per suite, so several suites
 * with none named is not refused here as it is where a record is read: the file
 * may be any suite's, and what every one of them rests on is read.
 */
export async function journeySuite(root: string, named: string | undefined): Promise<string | undefined> {
  if (named !== undefined) return named;
  const selection = await import('@variance-authority/sense/test-selection');
  const declared = selection.declaredSuites(root);
  return declared?.length === 1 ? declared[0]!.name : undefined;
}
