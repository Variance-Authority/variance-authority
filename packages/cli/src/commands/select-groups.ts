// compass: variance-authority.reach
/**
 * The tests of one selection, grouped by the commit they last ran at, each
 * group judged on its own change to one tree.
 *
 * The journal's commit is where most tests ran, and a stand is where the rest
 * did (`standsOf`, in sense). Every
 * group's change is read to the same tree object, written once of the working
 * state, so a file that moves while the reading runs moves no group apart from
 * another. A group is charged its own change and nothing else: what moved since
 * the journal's commit is no change for a test that ran later on a branch that
 * merged it.
 *
 * A group whose change cannot be read, whose install cannot be compared, or
 * whose change moves what the suite rests on runs whole, and a note names it.
 * Only every group doing so runs the suite.
 */

import { preconditionDistance, type ExecutionNarrowing, type SelectionReason, type Snapshot, type Stand, type TestDistance } from '@variance-authority/sense/test-selection';
import type { InstallDiff } from './installed.js';
import { many } from './prose-counts.js';
import { diffToTree } from './since.js';

/** The tests that last ran at one commit, and what changed from there to the tree. */
export interface Group {
  /** The stand they last ran at; absent for the tests read from the journal's commit. */
  readonly stand?: Stand;
  /** The change from there to the tree, with no context lines; absent when git could not write it. */
  readonly diff?: string;
  /** The files the group's change names. */
  readonly changed: readonly string[];
}

/** Why a group runs whole: its change unread, its install not compared, or what the suite rests on moved by it. */
export type Hit =
  | { readonly kind: 'undiffable' }
  | { readonly kind: 'install'; readonly whole: string }
  | { readonly kind: 'before'; readonly says: string; readonly rests: readonly string[] };

/**
 * The journal's group first, charged `diff`, then one per stand, read from
 * its commit to the snapshot's tree.
 */
export async function groupsOf(stands: readonly Stand[], diff: string, snapshot: Extract<Snapshot, { tree: string }> | undefined, here: string): Promise<readonly Group[]> {
  const selection = await import('@variance-authority/sense/test-selection');
  const names = (change: string) => [...selection.changedLines(change).keys()];
  const own = names(diff);
  const theirs = await Promise.all(stands.map(async (stand): Promise<Group> => {
    const since = snapshot === undefined ? undefined : await diffToTree(stand.commit, snapshot.tree, { cwd: here, unified: 0, env: snapshot.env });
    return since === undefined ? { stand, changed: [] } : { stand, diff: since, changed: names(since) };
  }));
  return [{ diff, changed: own }, ...theirs];
}

/**
 * The groups that run whole before the graph is read: a change git could not
 * write, or an install that could not be compared. `installs` is keyed by the
 * stand's commit, `undefined` for the journal's own.
 */
export function unreadHits(groups: readonly Group[], installs: ReadonlyMap<string | undefined, InstallDiff | undefined>): Map<Group, Hit> {
  const hits = new Map<Group, Hit>();
  for (const group of groups) {
    const installed = installs.get(group.stand?.commit);
    if (group.diff === undefined) hits.set(group, { kind: 'undiffable' });
    else if (installed !== undefined && 'whole' in installed) hits.set(group, { kind: 'install', whole: installed.whole });
  }
  return hits;
}

/**
 * Why the suite runs whole, when every group in `hits` does; `undefined` while
 * one group is still read. A `before` hit answers first, with every rest any
 * group moved, then the journal's install: the journal's own change is never
 * unwritten, since without it nothing is selected at all.
 */
export function suiteHit(groups: readonly Group[], hits: ReadonlyMap<Group, Hit>): Exclude<Hit, { kind: 'undiffable' }> | undefined {
  if (hits.size < groups.length) return undefined;
  const journal = hits.get(groups[0]!)!;
  const befores = groups.flatMap((group) => {
    const hit = hits.get(group)!;
    return hit.kind === 'before' ? [hit] : [];
  });
  if (befores.length === 0) return journal.kind === 'install' ? journal : undefined;
  const says = (journal.kind === 'before' ? journal : befores[0]!).says;
  return { kind: 'before', says, rests: [...new Set(befores.flatMap((hit) => hit.rests))].sort() };
}

/** The note a group that runs whole gives, after the verdict; none for the journal's group when every group runs. */
export function hitNote(group: Group, hit: Hit, commit: string | undefined): string {
  const at = (group.stand?.commit ?? commit)?.slice(0, 12);
  if (group.stand === undefined) {
    const which = `every test file read from the journal's commit ${at}`;
    const why = hit.kind === 'before' ? hit.says : hit.kind === 'install' ? hit.whole : `git could not write the diff from ${at} to the tree`;
    return `${why}, so ${which} runs`;
  }
  const count = group.stand.tests.length;
  const they = count === 1 ? 'it runs' : 'they run';
  if (hit.kind === 'undiffable') return `git could not write the diff from ${at}, where ${many(count, 'test file')} last ran, to the tree, so ${they}`;
  if (hit.kind === 'install') return `${many(count, 'test file')} last ran at ${at}, and ${hit.whole}, so ${they}`;
  return `${hit.says}, so ${count === 1 ? 'the test file that last ran there runs' : `the ${count} test files that last ran there run`}`;
}

type Answer = { readonly narrowing: ExecutionNarrowing; readonly distances?: readonly TestDistance[] };

/**
 * The answer that runs every one of `tests`: a stand's, given without asking
 * the journal, or the journal's own with every test it holds entered. A moved
 * rest is each test's reason, as a precondition the suite runs first.
 */
export function everyTest(tests: readonly string[], hit: Hit, answer?: Answer): Answer {
  const all = answer === undefined ? tests : [...new Set([...answer.narrowing.entered, ...answer.narrowing.whole, ...(answer.narrowing.incomplete ?? [])])];
  const narrowing = answer?.narrowing ?? { whole: [], entered: [], unread: [], stale: [], because: [] };
  if (hit.kind !== 'before') return { ...answer, narrowing: { ...narrowing, entered: all } };
  const via: readonly SelectionReason[] = hit.rests.map((name) => ({ kind: 'precondition', name }));
  const from = hit.rests[0]!;
  return {
    ...answer,
    narrowing: { ...narrowing, entered: all, because: [...(narrowing.because ?? []), ...all.map((test) => ({ test, via }))] },
    distances: [...(answer?.distances ?? []), ...all.map((test) => preconditionDistance(test, from))],
  };
}
