import { summarizeObservation } from '@variance-authority/observe';
import type { SourceIndex } from '@variance-authority/core/attribute';
import type { Observation } from '@variance-authority/observe';
import { arrangedText, type SnapshotCase } from './arranged.js';

/**
 * What a failing assertion prints — one line of this package's own, over the
 * formatter the engine already ships.
 *
 * This file used to hold a second implementation of `summarizeObservation`,
 * written because the exported one was not called by anything and nobody looked.
 * They rendered the same value into two different strings, which is how a
 * Playwright user and an agent reading the run report end up describing the same
 * observation differently. The merged version lives in
 * [`summarize.ts`](../../observe/src/summarize.ts); the seam stays here because
 * *what a failing assertion prints* is this package's contract and
 * [`docket.test.ts`](./docket.test.ts) is where it is held.
 *
 * The message is the product. `1530 pixels differ` is what the incumbent prints
 * and it is unassignable — the only available response is to open the image and
 * look, which is the expensive act this is meant to replace.
 *
 * A snapshot taken inside a case closes with that case and what it had
 * arranged, so a reviewer reads the conditions beside the change.
 */
export function describeObservation(
  observation: Observation & { readonly case?: SnapshotCase },
  source?: SourceIndex,
): string {
  const summary = summarizeObservation(observation, source === undefined ? {} : { source });
  return observation.case === undefined ? summary : `${summary}\n${arrangedText(observation.case)}`;
}
