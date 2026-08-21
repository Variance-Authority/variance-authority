import type { ObservationRecord } from './format.js';

/**
 * Whether a promotion would land, decided before anything is promoted.
 *
 * `accept` used to be the only thing that knew these rules, and it knew them by
 * running: the answer to *what would this update record* was the update. That is
 * fine for a person at a terminal and useless to anything asking beforehand — an
 * agent proposing a command, a reader previewing a commit message — because the
 * only way to find out was to do it.
 *
 * So the rules are a function over one observation and the command applies them
 * rather than owning them. What that buys is the property the whole changelog
 * argument rests on: a preview and the acceptance it previews cannot disagree,
 * because there is one set of rules and both read it. A second copy that drifted
 * would produce the worst available artifact here — a confident account of a
 * baseline update that did not happen.
 *
 * Every refusal is the sentence `accept` prints, unchanged. The wording is part
 * of the rule: it names what to do next, and an agent that gets a different
 * sentence from the preview than from the command has to decide which one is the
 * product.
 */

/**
 * What would happen to this subject, and why.
 *
 * Three outcomes rather than a boolean, because *already the baseline* is not a
 * refusal and printing it as one turns the ordinary case — the two hundred and
 * ninety-eight subjects a run did not change — into a wall of failures. It is
 * also not a promotion: nothing is written, and a record that counted it would
 * describe a baseline update nobody made.
 */
export type Promotion =
  | {
      readonly kind: 'promotable';
      /**
       * The candidate image that would become the baseline, as the report named
       * it.
       *
       * Carried on the answer rather than looked up again by the caller. A
       * command that re-read `images.after` after being told a subject is
       * promotable would be asking a second time whether the run left an image,
       * and two readings of one fact are two answers waiting to differ.
       */
      readonly from: string;
    }
  | { readonly kind: 'already-baseline'; readonly because: string }
  | { readonly kind: 'refused'; readonly because: string };

/**
 * The rules, in the order they are asked.
 *
 * The order is load-bearing in one place: instability is asked *before* the
 * verdict. A subject that read two ways and settled on `unchanged` is not a
 * subject that did not change — `--flakes` reached the same baseline twice and
 * got two answers — and answering "already the baseline" there hides the
 * diagnostic that makes this refusable at all.
 */
export function promotionOf(observation: ObservationRecord): Promotion {
  if (observation.unstable !== undefined && observation.unstable.absorbed === undefined) {
    return {
      kind: 'refused',
      because:
        `${observation.unstable.because}. Accepting it would promote one of two readings ` +
        'as the baseline; fix what moves between them, or re-run once it is fixed',
    };
  }

  if (observation.verdict === 'unchanged') {
    return {
      kind: 'already-baseline',
      because: 'it did not change, so it already is the baseline; nothing to accept',
    };
  }

  if (observation.alone?.reproduced === false) {
    return {
      kind: 'refused',
      because:
        `${observation.alone.because}. Accepting it would make the leak the baseline; ` +
        'fix the subject that writes the shared state, or re-run once it is fixed',
    };
  }

  const after = observation.images?.after;
  if (after === undefined) {
    return { kind: 'refused', because: noImage(observation) };
  }

  return { kind: 'promotable', from: after };
}

/**
 * Subjects a set of shapes can and cannot settle.
 *
 * `whole` is the safe bulk: every difference this subject has carries one of the
 * named shapes, so promoting the shape here promotes nothing else. `partial` is
 * the refusal that makes the bulk safe — the shape is present, something the
 * shape does not name also moved, and accepting it there would baseline a
 * difference nobody reviewed.
 *
 * A subject with no region at all is in neither list. It is not evidence about
 * these shapes in either direction.
 */
export function selectByShape(
  observations: readonly ObservationRecord[],
  shapes: ReadonlySet<string>,
): { whole: readonly ObservationRecord[]; partial: readonly ObservationRecord[] } {
  const whole: ObservationRecord[] = [];
  const partial: ObservationRecord[] = [];

  for (const observation of observations) {
    if (observation.regions.length === 0) continue;

    const hits = observation.regions.filter(
      (region) => region.fingerprint !== undefined && shapes.has(region.fingerprint),
    );
    if (hits.length === 0) continue;

    // A capped list is not a complete one. Regions the run found and chose not
    // to record could be anything, so a subject whose evidence was truncated
    // cannot support "this shape is the entire change" however its recorded
    // regions look.
    const capped = observation.truncated !== undefined && observation.truncated.regions > 0;

    if (!capped && hits.length === observation.regions.length) whole.push(observation);
    else partial.push(observation);
  }

  return { whole, partial };
}

/**
 * Why a shape present in this subject cannot settle it.
 *
 * Two different facts wearing one outcome, and they send a reader to different
 * places: the run recorded another difference, or the run stopped recording. The
 * second is not evidence that something else moved — it is the absence of
 * evidence that nothing did, which is why it refuses in exactly the same way.
 */
export function whyNotWhole(observation: ObservationRecord): string {
  return observation.truncated !== undefined && observation.truncated.regions > 0
    ? `this shape is present, but the run capped its region list ` +
        `(${String(observation.truncated.regions)} more, ${String(observation.truncated.pixels)}px), so ` +
        'there is no evidence it is the whole change; accept this subject by name'
    : 'this shape is present and something else changed too, so accepting it here ' +
      'would baseline that as well; accept this subject by name once you have read it';
}

/**
 * Why a subject has no image, phrased around what to do next.
 *
 * The two causes are opposite and a single message would serve neither. A
 * settlement means nothing was rendered *because nothing needed to be*; an
 * incomparable baseline means the comparison was refused, and the fix is a
 * decision about machines rather than about this subject.
 */
function noImage(observation: ObservationRecord): string {
  if (observation.verdict === 'incomparable') {
    return (
      'its baseline belongs to another machine, so the run refused to compare and produced ' +
      'no image. Delete that baseline and re-run here to record one for this machine, or ' +
      'run where the baseline was written — accepting across identities is the failure the ' +
      'partition exists to prevent'
    );
  }
  return (
    'the run recorded no image for it. Re-run on this machine so the candidate exists; ' +
    'this command promotes an image that was already reviewed and never renders one'
  );
}
