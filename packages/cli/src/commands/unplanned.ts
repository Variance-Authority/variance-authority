// compass: variance-authority.cli

import { identityDigest, type RenderIdentity } from '@variance-authority/core/format';
import type { BaselineKey, RasterStore } from '@variance-authority/raster';
import { keyFor, type PlannedSubject } from './collector.js';
import { many } from './reach.js';

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
 */
export async function unplanned(
  store: RasterStore,
  subjects: readonly PlannedSubject[],
  identityOf: IdentityOf,
): Promise<readonly string[]> {
  const list = store.unplanned;
  if (list === undefined) return [];

  // Grouped by identity because that is the partition the store is asked about:
  // a suite planned at two widths is two renderer identities and two directories
  // of approved images, and asking about one with the other's keys would report
  // every subject in the suite as unplanned at the width it is not.
  const groups = new Map<string, { identity: RenderIdentity; keys: BaselineKey[] }>();
  for (const planned of subjects) {
    const identity = identityOf(planned);
    const key = keyFor(planned);
    const digest = identityDigest(identity);
    const group = groups.get(digest) ?? { identity, keys: [] };
    group.keys.push(key);
    groups.set(digest, group);
  }

  const names = new Set<string>();
  for (const group of groups.values()) {
    for (const name of await list.call(store, group.keys, group.identity)) names.add(name);
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
 */
export function unplannedNote(names: readonly string[]): string | undefined {
  if (names.length === 0) return undefined;
  return (
    `the baseline store holds ${many(names.length, 'approved subject')} this run did not plan: ` +
    `${names.join(', ')}. Each one keeps its image and was compared against nothing. That is a ` +
    'subject the collector stopped listing, or a second suite sharing this baseline root — not ' +
    'a verdict either way, and not a reason to delete an image before you know which.'
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
): Promise<readonly string[]> {
  let names: readonly string[];
  try {
    names = await unplanned(store, subjects, identityOf);
  } catch (error) {
    return [
      'the baseline store could not be asked what it holds, so a subject dropped from the plan ' +
        `would not be reported here: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
  const note = unplannedNote(names);
  return note === undefined ? [] : [note];
}
