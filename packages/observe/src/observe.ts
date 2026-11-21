import { timeOn, type Raster, type RenderDocument } from '@variance-authority/core/format';
import {
  identityCause,
  type BaselineKey,
  type IdentityCause,
  type Relocated,
} from '@variance-authority/raster';
import { declaredIgnores } from './decide.js';
import type { CompareInputs, Observation, ObserveOptions } from './observation.js';
import { componentsOf, renderOnce } from './render-once.js';
import { decideRasters } from './unpictured.js';

/**
 * The composition — the phases, wired, and nothing else.
 *
 * Every step below is a function defined elsewhere and testable without this one:
 * acquisition needs a DOM, rendering needs a renderer, comparison needs two PNGs,
 * isolation needs a bitmask, attribution needs a snapshot. Keeping the wiring in
 * its own file is what stops the pipeline from becoming the only place any of it
 * can be exercised — the failure that makes a system with a browser in it
 * untestable in practice.
 *
 * What this file adds is the part that is genuinely about *composition*: which
 * verdicts exist, and which of them are allowed to be `unchanged`.
 */

/**
 * Two images that are already in hand, decided against each other.
 *
 * The same function every other path in this package ends at, reachable without
 * a renderer or a store. `observePair` renders two documents and calls it;
 * `observeAgainstBaseline` renders one and looks the other up; this one is for
 * the caller who has both and no document behind either.
 *
 * `rendered` is `false` and cannot be otherwise: nothing was painted here, and a
 * run reporting otherwise would be claiming a render cost it did not pay.
 *
 * What it *cannot* do is not hidden by this entry point — it is decided by what
 * the two rasters carry. No `components` on either side means no causes; no
 * snapshot means no attribution, no exclusions and no bands. Each of those is
 * already an `undefined` that `decide` handles by saying less, so the reduction
 * arrives as absent fields in the observation rather than as a second code path.
 *
 * **Two identities are a cause, never a refusal.** This entry point is handed
 * two rasters from anywhere, so a caller can compare a WebKit baseline against
 * a Chromium run, or an iOS simulator capture against a Figma export. The
 * pixels are compared all the same, and the identity that moved is named as
 * the cause of whatever they show (ADR-0090): a wall of red with its cause
 * attached is reviewable, and silence is not.
 */
export async function observeRasters(
  subject: string,
  before: Raster,
  after: Raster,
  options: CompareInputs = {},
): Promise<Observation> {
  return withCause(
    await decideRasters(subject, before, after, false, options, 'image'),
    identityCause(before.identity, after.identity, {
      stored: 'the before image',
      current: 'the after image',
    }),
    documentMoved(before, after),
  );
}

/**
 * **Ephemeral**: render both sides now, compare, keep nothing.
 *
 * No baseline, no store, no pinned machine — the two images come from one
 * renderer in one run, so the machine-bound inputs are identical by construction
 * rather than by container. This is the cheap mode and it is cheap because it
 * removes a requirement instead of satisfying it.
 */
export async function observePair(
  before: RenderDocument,
  after: RenderDocument,
  options: ObserveOptions,
): Promise<Observation> {
  const left = await renderOnce(options.renderer, options.store, before, undefined, undefined, options.steps);
  const components = componentsOf(options.snapshot);
  const right = await renderOnce(options.renderer, options.store, after, components, undefined, options.steps);

  return await decideRasters(
    after.subject.id,
    left.raster,
    right.raster,
    left.rendered || right.rendered,
    options,
    'image',
  );
}

/**
 * **Durable**: render this side, compare against a stored baseline.
 *
 * The baseline is looked up under *any* identity, its own first. One found
 * under another identity is compared all the same, and the identity that moved
 * is the cause the observation carries, so a run on another machine or after
 * an upgrade shows every diff with the reason beside it.
 *
 * The key is `identityFor(document)`, never `renderer.identity`: the raster this
 * run is about to produce will be *written* under the former, and a lookup that
 * asks a different question from the write it is trying to find answers it
 * wrong in both directions — see {@link Renderer.identityFor}.
 */
export async function observeAgainstBaseline(
  document: RenderDocument,
  key: BaselineKey,
  options: ObserveOptions,
): Promise<Observation> {
  const identity = options.renderer.identityFor(document);

  const components = componentsOf(options.snapshot);
  const found = await timeOn(options.steps, 'baseline', async () => options.store.find(key, identity));
  const fresh = await renderOnce(
    options.renderer,
    options.store,
    document,
    components,
    options.accessibility,
    options.steps,
  );

  // Carried on the paths that never reach a comparison. What the operator
  // excluded is a fact about this subject whether or not anything was compared,
  // and a run that omitted it told the ledger the rule had resolved nowhere.
  const declared = declaredIgnores(options.snapshot, fresh.raster.identity.deviceScaleFactor);
  const declaredField = declared === undefined ? {} : { ignored: declared };

  if (found === null) {
    return {
      subject: document.subject.id,
      verdict: 'new',
      because: 'no baseline under this renderer; nothing to compare against',
      regions: [],
      rendered: fresh.rendered,
      missingFonts: fresh.raster.missingFonts,
      ...declaredField,
    };
  }

  return withRelocation(
    withCause(
      await decideRasters(
        document.subject.id,
        found.raster,
        fresh.raster,
        fresh.rendered,
        options,
        'baseline',
      ),
      identityCause(found.storedUnder, identity),
      documentMoved(found.raster, fresh.raster),
    ),
    found.relocated,
    documentMoved(found.raster, fresh.raster),
  );
}

/**
 * An observation with the identity that moved between its two images as its
 * cause: named first in the sentence, and typed in `signals` for a report to
 * group an avalanche by. Unchanged when nothing moved.
 */
export function withCause(
  observation: Observation,
  cause: IdentityCause | undefined,
  document: 'unchanged' | 'changed',
): Observation {
  if (cause === undefined) return observation;
  return {
    ...observation,
    because: `${cause.because}; ${observation.because}`,
    signals: {
      document,
      ...observation.signals,
      identity: cause.identity,
      moved: cause.moved,
    },
  };
}

/**
 * An observation with the place its baseline was read from as a cause: a
 * baseline the layout before `baselines.path` kept is compared all the same,
 * and the move is named first, so an upgrade that renames every baseline
 * reads as one move and never as a suite of `new` subjects. Unchanged when the
 * baseline was where the template puts it.
 */
export function withRelocation(
  observation: Observation,
  relocated: Relocated | undefined,
  document: 'unchanged' | 'changed',
): Observation {
  if (relocated === undefined) return observation;
  return {
    ...observation,
    because:
      `the baseline was read from ${relocated.from}, a directory named for its renderer ` +
      `identity, and accepting moves it to ${relocated.to}, the path \`baselines.path\` names; ` +
      observation.because,
    signals: { document, ...observation.signals, relocated },
  };
}

/** Whether two rasters were painted from different documents. */
export function documentMoved(
  before: Pick<Raster, 'documentDigest'>,
  after: Pick<Raster, 'documentDigest'>,
): 'unchanged' | 'changed' {
  return before.documentDigest === after.documentDigest ? 'unchanged' : 'changed';
}
