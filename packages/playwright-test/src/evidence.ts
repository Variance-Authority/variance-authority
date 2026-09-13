import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Observation } from '@variance-authority/observe';
import { decode, diffImage } from '@variance-authority/png';
import { fileNameFor, pictured, type Raster } from '@variance-authority/core/format';
import type { BaselineKey, RasterStore } from '@variance-authority/raster';

/**
 * Where the three images a person looks at were written.
 *
 * A verdict sentence names the components and counts the pixels, and a reviewer
 * still asks to see it. Every incumbent answers that with a picture; a suite
 * driving this library from its own runner got the sentence and nothing else,
 * so the only way to look at a disagreement was to write a differ. That is the
 * gap this closes, and it is bytes on disk rather than bytes on `Observation`
 * because a 700-subject suite holding two PNGs per subject in memory is the
 * shape that makes the tool unusable on a real suite.
 */
export interface Evidence {
  /** The stored baseline. Absent when there was none to subtract from. */
  readonly before?: string;
  /**
   * What this run painted. Absent only when the subject occupies no pixels, in
   * which case there was nothing to paint and `before` is a picture of what it
   * used to occupy.
   */
  readonly after?: string;
  /** `before` subtracted from `after`. Absent exactly when either of them is. */
  readonly diff?: string;
}

/**
 * Which verdicts are worth a pair.
 *
 * `changed` and `incomparable` are what a person stops on. `ignored` joins them
 * for the reason the report writer takes it: the verdict means pixels *did*
 * differ and every one fell inside a mask somebody wrote, which makes it the one
 * verdict where the question is about the mask rather than the render -- and
 * "has this ignore grown over a regression?" is answerable from a `before` and a
 * diff and from nothing else.
 *
 * `unchanged` and `new` are not. There is nothing to look at in the first and
 * nothing to compare against in the second.
 */
function worthLooking(verdict: Observation['verdict']): boolean {
  return verdict === 'changed' || verdict === 'incomparable' || verdict === 'ignored';
}

/**
 * Write what this observation compared, and say where it went.
 *
 * The candidate is handed in rather than looked up: both capture paths already
 * hold it at the point they decide, and re-reading it would be a second lookup
 * for the few subjects that need one. The baseline is looked up here, after the
 * verdict check, because for a subject nobody will look at the read is waste.
 *
 * Returns nothing when the verdict is not one a person stops on, so a caller can
 * report the absence as "there was nothing to show" rather than as a failure to
 * write.
 */
export async function writeEvidence(
  directory: string,
  key: BaselineKey,
  observation: Observation,
  candidate: Raster,
  store: RasterStore,
): Promise<Evidence | undefined> {
  if (!worthLooking(observation.verdict)) return undefined;

  await mkdir(directory, { recursive: true });
  const base = join(directory, fileNameFor(key.subject));
  const stored = (await store.find(key, candidate.identity))?.raster;

  // A subject that occupies no pixels has no image to show, and is a reviewable
  // verdict all the same — its document or its accessibility tree moved. There
  // is nothing to write, and saying so lets the caller report "no images" rather
  // than a failed write; the sentence on the observation is the whole finding.
  if (!pictured(candidate)) {
    if (stored === undefined || !pictured(stored)) return undefined;
    // It had pixels and now has none. The baseline is the only picture of what
    // is gone, and it is the evidence.
    const only = `${base}.before.png`;
    await writeFile(only, decode(stored.bytes));
    return { before: only };
  }

  const after = `${base}.after.png`;
  const afterBytes = decode(candidate.bytes);
  await writeFile(after, afterBytes);

  // A baseline with no pixels is not a `before` anyone can look at: the subject
  // occupied nothing when it was recorded, and the candidate is the whole story.
  const before = stored === undefined || !pictured(stored) ? undefined : stored;
  // No stored image means nothing to subtract from, and a diff against nothing
  // is the candidate painted red. Omitted rather than written: an `incomparable`
  // subject whose baseline came from another environment has no `before` *here*
  // even though one exists in the store, and inventing one would show a reviewer
  // a comparison the run refused to make.
  if (before === undefined) return { after };

  const beforePath = `${base}.before.png`;
  const diff = `${base}.diff.png`;
  const beforeBytes = decode(before.bytes);
  await writeFile(beforePath, beforeBytes);
  // Two images of different sizes have no common canvas, so there is no diff to
  // draw -- the pair itself is the evidence, and it is the whole finding.
  if (observation.comparison?.dimensionsChanged === true) return { before: beforePath, after };
  await writeFile(diff, diffImage(beforeBytes, afterBytes));

  return { before: beforePath, after, diff };
}

/** An observation, and where its images were written when evidence was asked for. */
export interface Observed extends Observation {
  readonly evidence?: Evidence;
}

/**
 * Attach the evidence to an observation, when the caller asked for any.
 *
 * The candidate arrives as a thunk because the two capture paths reach it
 * differently -- in place it is already in hand, deferred it is a render-cache
 * lookup -- and neither should pay for it on the great majority of subjects that
 * agree with their baseline. A path with no candidate at all (a settled verdict,
 * which paints nothing) answers `null`, and the observation passes through
 * unchanged: there is no image to show because none was made.
 */
export async function withEvidence(
  runtime: { readonly evidence?: string; readonly store: RasterStore },
  key: BaselineKey,
  observation: Observation,
  candidate: () => Promise<Raster | null>,
): Promise<Observed> {
  if (runtime.evidence === undefined || !worthLooking(observation.verdict)) return observation;
  const raster = await candidate();
  if (raster === null) return observation;
  const evidence = await writeEvidence(runtime.evidence, key, observation, raster, runtime.store);
  return evidence === undefined ? observation : { ...observation, evidence };
}
