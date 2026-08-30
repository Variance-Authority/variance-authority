/**
 * The previous run, fetched once and read by whoever needs a row of it.
 *
 * The crossing used to belong to one panel, which fetched the earlier build for
 * itself and rendered every row of it in one place at the bottom of the build
 * page. Both halves of that were wrong. A reviewer deciding whether to approve a
 * change in `Button` wants one sentence — *build 5 showed you this and nobody
 * decided it* — beside the change, and they will not scroll nine thousand pixels
 * to a section that also tells them about nineteen subjects they are not looking
 * at. And the section itself is worth keeping whole, for the reader who came to
 * ask what moved since Friday.
 *
 * So the fetch is a hook and the fold is [`shift.ts`](./shift.ts): one request,
 * one crossing, and three readings that cannot disagree — the whole table on the
 * run page, the rows under one change on its card, and the single row on a
 * subject.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { BuildDetail, BuildSummary } from '../review-types.js';
import type { ReviewClient } from './client.js';
import { divergeFrom, type Divergence, type Shifted } from './shift.js';

/** The earlier run, or the reason there is nothing to place this one against. */
export type Crossing =
  | { readonly state: 'loading' }
  | { readonly state: 'none' }
  | { readonly state: 'failed'; readonly why: string }
  | {
      readonly state: 'ready';
      readonly earlier: BuildDetail;
      readonly divergence: Divergence;
      /** This subject's row, or `undefined` when neither run named it. */
      readonly of: (subject: string) => Shifted | undefined;
    };

/**
 * This build against the one before it.
 *
 * A failure is a state and never a silence. An empty crossing reads as *nothing
 * has changed since the last run*, which is the sentence somebody merges on.
 */
export function useCrossing(client: ReviewClient, build: BuildDetail): Crossing {
  const [earlier, setEarlier] = useState<
    | { readonly state: 'loading' }
    | { readonly state: 'none' }
    | { readonly state: 'failed'; readonly why: string }
    | { readonly state: 'ready'; readonly value: BuildDetail }
  >({ state: 'loading' });

  const id = build.build;

  const load = useCallback(async (): Promise<void> => {
    try {
      const previous = previousOf(await client.builds(), id);
      if (previous === undefined) {
        setEarlier({ state: 'none' });
        return;
      }
      setEarlier({ state: 'ready', value: await client.build(previous.build) });
    } catch (error) {
      setEarlier({ state: 'failed', why: error instanceof Error ? error.message : String(error) });
    }
  }, [client, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const value = earlier.state === 'ready' ? earlier.value : undefined;

  return useMemo((): Crossing => {
    if (value === undefined) return earlier as Crossing;

    const divergence = divergeFrom(build, value);
    const rows = new Map(divergence.shifts.map((each) => [each.subject, each]));
    return {
      state: 'ready',
      earlier: value,
      divergence,
      of: (subject) => rows.get(subject),
    };
  }, [build, value, earlier]);
}

/**
 * The run before this one, as the store lists them.
 *
 * By position rather than by clock. Two runs pushed from one machine can carry
 * the same timestamp to the millisecond — both example builds here do — and
 * picking on `at` would compare a build against itself or against its own
 * successor. The listing is newest first and breaks a tied clock by arrival, so
 * position is a total order where the timestamp is not. The build it lands on is
 * named on the page, because a reader who disagrees with the pick can only say so
 * if they can see it.
 */
export function previousOf(
  builds: readonly BuildSummary[],
  build: string,
): BuildSummary | undefined {
  const at = builds.findIndex((each) => each.build === build);
  return at === -1 ? undefined : builds[at + 1];
}
