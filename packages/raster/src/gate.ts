import {
  locateInstability,
  summarizeInstability,
  type Digest,
  type Instability,
  type SemanticSnapshot,
  type SourceIndex,
} from '@variance-authority/core';

/**
 * Decide whether a subject is worth photographing — without photographing it.
 *
 * The usual instability check is to shoot, wait, shoot again, and keep going
 * until two frames agree. It is slow by construction: two captures minimum on
 * every subject, more on the ones that are actually moving, on the most
 * expensive step in the pipeline. And when it succeeds it destroys the finding —
 * the run goes green, nobody learns which component would not sit still, and the
 * same cost is paid again tomorrow.
 *
 * The check belongs on the cheap tier. A second *document* — markup plus the
 * applicable CSS — costs a read of a page that is already mounted: no render, no
 * navigation, no image. If two documents of one subject disagree, the subject is
 * moving, and that is knowable before a browser has been asked for a single
 * frame.
 *
 * **Nothing here retries.** One disagreement is the answer. A third sample could
 * only tell you how often it happens, which is not the question — the question is
 * where it comes from, and the semantic snapshots already carry that.
 */

export interface StabilitySample {
  /** Digest of the document acquired for this sample. */
  readonly documentDigest: Digest;
  /**
   * The snapshot behind it, when one was taken.
   *
   * Optional, and the difference between "this subject moved" and "this subject
   * moved in `Spinner`, at `transform`, in `src/ds/components.tsx:88`". Without
   * it the gate can refuse to render and cannot say what to fix.
   */
  readonly snapshot?: SemanticSnapshot;
}

export interface StabilityVerdict {
  /**
   * Three states, not two.
   *
   * `unknown` is the one that matters: a single sample proves nothing, and
   * reporting it as stable would be a verdict resting on a comparison nobody
   * made. It is not a failure — a project may reasonably decline the second
   * sample — but it must never be printed as though the check had passed.
   */
  readonly state: 'stable' | 'unstable' | 'unknown';
  /** Whether a render should happen at all. */
  readonly render: boolean;
  readonly because: string;
  /** Present when the subject moved and snapshots were supplied. */
  readonly instability?: Instability;
}

/**
 * Compare samples of one subject that ought to be identical.
 *
 * An unstable subject is **not rendered**. An image of something that was moving
 * is a baseline that never corresponded to a state of the product, and every
 * later run compares against it — so the cheapest moment to refuse is before the
 * shutter, and the only useful output is a name and a file.
 */
export function gateStability(samples: readonly StabilitySample[]): StabilityVerdict {
  const first = samples[0];

  if (first === undefined) {
    return {
      state: 'unknown',
      render: false,
      because: 'no sample was taken, so there is nothing to render and nothing to conclude',
    };
  }

  if (samples.length === 1) {
    return {
      state: 'unknown',
      render: true,
      because:
        'only one document was acquired, so stability was not checked. This is not a finding ' +
        'that the subject is stable — it is the absence of the check',
    };
  }

  const moved = samples.find((sample) => sample.documentDigest !== first.documentDigest);

  if (moved === undefined) {
    return {
      state: 'stable',
      render: true,
      because: `${samples.length} documents of this subject are identical`,
    };
  }

  const instability =
    first.snapshot !== undefined && moved.snapshot !== undefined
      ? locateInstability(first.snapshot, moved.snapshot)
      : undefined;

  return {
    state: 'unstable',
    render: false,
    because:
      instability === undefined
        ? 'two documents of this subject at one commit disagree, so it was moving when it was ' +
          'observed and no image was taken. Supply snapshots to learn where'
        : instability.because,
    ...(instability !== undefined ? { instability } : {}),
  };
}

/**
 * The verdict as the sentence a person is meant to act on.
 *
 * Deliberately blunt about ownership. A subject that will not hold still is a
 * property of the subject, and the fix is in the component — pausing the
 * animation, seeding the clock — not in this tool learning to wait longer. Every
 * wait added here is paid by every subject forever; the fix is paid once.
 */
export function summarizeGate(
  verdict: StabilityVerdict,
  options: { readonly source?: SourceIndex } = {},
): string {
  if (verdict.state === 'stable') return verdict.because;

  if (verdict.state === 'unknown') return `[unchecked] ${verdict.because}`;

  const head =
    '[unstable] this subject was still changing when it was observed, so no image was taken.\n' +
    'Re-photographing it until two frames agree would hide this and cost every run;\n' +
    'the fix is in the component named below.';

  return verdict.instability === undefined
    ? `${head}\n${verdict.because}`
    : `${head}\n\n${summarizeInstability(verdict.instability, options)}`;
}
