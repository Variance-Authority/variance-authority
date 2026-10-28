// compass: variance-authority.cli

import { atWidth, identityDigest, type RenderIdentity } from '@variance-authority/core/format';
import type { BaselineKey, RasterStore } from '@variance-authority/raster';
import { keyFor, type PlannedSubject } from './collector.js';
import { many } from './prose-counts.js';

/** How the caller turns a planned subject into the identity it will be rendered at. */
export type IdentityOf = (planned: PlannedSubject) => RenderIdentity;

/**
 * Baselines the store holds that this run's plan never mentioned.
 *
 * A plan that is *discovered* — from a sitemap, a story index, a directory of
 * built HTML — is a list nobody reviews. Adding a subject to it is loud: the
 * run reports `new` and exits `1`, because there is no baseline to compare
 * against. Removing one is silent in both directions: the subject is not
 * collected, so no verdict names it, and its approved image stays on disk where
 * it looks exactly like a baseline still being honoured. The suite gets smaller
 * and greener at the same time, which is the one combination worth saying out
 * loud.
 *
 * This is the other half of the plan, asked of the only thing that knows it.
 *
 * **Not a question about what ran.** Every narrowing this CLI does — `--since`,
 * `--subjects`, a selection index — happens downstream of the plan and leaves
 * `plan.subjects` whole, so a partial run asks this question with the full
 * suite in hand. That is the invariant the caller owes: asked with the subjects
 * that were *observed*, this would report the entire saving of a narrowed run
 * as a suite of abandoned baselines, on the run whose whole point was to skip
 * them.
 *
 * **Nor about widths the run never read.** A story's widths live in its own
 * parameters and are read at its visit, so a visited story is asked about by
 * the subjects its visit realized, and `unvisited` — every story a narrowed or
 * sharded run did not reach — counts a baseline at any width of it as planned.
 */
export async function unplanned(
  store: RasterStore,
  subjects: readonly PlannedSubject[],
  identityOf: IdentityOf,
  unvisited: readonly PlannedSubject[] = [],
): Promise<readonly string[]> {
  const list = store.unplanned;
  if (list === undefined) return [];

  // Grouped by identity because the store renders `{engine}` and finds
  // identity-directory baselines from it: a suite planned on two engines is two
  // sets of files, and asking about one with the other's keys would report every
  // subject in the suite as unplanned on the engine it is not.
  type Group = { identity: RenderIdentity; keys: BaselineKey[]; widths: ((width: number) => BaselineKey)[] };
  const groups = new Map<string, Group>();
  const groupOf = (planned: PlannedSubject): Group => {
    const identity = identityOf(planned);
    const digest = identityDigest(identity);
    const group = groups.get(digest) ?? { identity, keys: [], widths: [] };
    groups.set(digest, group);
    return group;
  };
  for (const planned of subjects) groupOf(planned).keys.push(keyFor(planned));
  for (const planned of unvisited) groupOf(planned).widths.push((width) => keyFor(atWidth(planned, width)));

  const names = new Set<string>();
  for (const group of groups.values()) {
    for (const name of await list.call(store, group.keys, group.identity, group.widths)) names.add(name);
  }
  return [...names].sort();
}

/**
 * What the report says about them, or nothing because there is nothing to say.
 *
 * Every name, not a sample. A sample is right for the reasons a run narrows —
 * the reader wants the shape of a large set and can get the rest from the JSON —
 * and wrong here, because the whole complaint is that these subjects are not
 * named anywhere else in the run. Truncating the list would reproduce the
 * silence in a shorter form.
 *
 * Each is named by its path under the baseline root, without the extension,
 * because the path is what a person deletes or moves, and under a
 * `baselines.path` template it already says which story and which variant.
 *
 * Both readings are named because a record does not say which suite approved
 * it. Neither is a verdict, and neither is a reason to delete an image before
 * the operator knows which one holds.
 */
export function unplannedNote(names: readonly string[]): string | undefined {
  if (names.length === 0) return undefined;
  return (
    `the baseline store holds ${many(names.length, 'approved baseline')} this run did not plan: ` +
    `${names.join(', ')}. Either the collector stopped listing them or a second suite shares ` +
    'this baseline root.'
  );
}

/**
 * The same question, answered as a sentence even when it could not be answered.
 *
 * A failure to list a directory is not a reason to end a run that has already
 * compared everything it planned: this signal is about the subjects the run was
 * never going to observe. But it is also not nothing — a store that could not be
 * enumerated is a store whose silence means less than usual — so the failure is
 * reported in the place the answer would have gone.
 */
export async function unplannedNotes(
  store: RasterStore,
  subjects: readonly PlannedSubject[],
  identityOf: IdentityOf,
  unvisited: readonly PlannedSubject[] = [],
): Promise<readonly string[]> {
  let names: readonly string[];
  try {
    names = await unplanned(store, subjects, identityOf, unvisited);
  } catch (error) {
    return [
      'the baseline store could not be asked what it holds, so a subject dropped from the plan ' +
        `would not be reported here: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  const note = unplannedNote(names);
  return note === undefined ? [] : [note];
}
