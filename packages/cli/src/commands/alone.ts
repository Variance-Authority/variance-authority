import {
  observeAgainstBaseline,
  observePair,
  type Observation,
} from '@variance-authority/observe';
import type { BaselineKey } from '@variance-authority/raster';
import { DEFAULT_ALONE_LIMIT } from '../config.js';
import type { PlannedSubject } from './collector.js';
import type { ObserveContext } from './run-context.js';
import type { CliObservationRecord } from './run-report.js';

/**
 * The second pass, and the one question a comparison cannot answer about itself.
 *
 * Kept in its own file because it is the counterweight to ADR-0009. The saving
 * this whole tool is built on is that the world is not rebuilt between subjects;
 * the risk that saving buys is that subject B renders differently because subject
 * A ran first, and this is the only code that goes looking for it. A reader
 * auditing the corner that was cut should be able to read the check that was
 * added in exchange, without reading the loop around it.
 */

/**
 * Re-collect a changed subject with nothing else in the world, and compare again.
 *
 * The question a comparison cannot answer on its own. `changed` means the pixels
 * moved; it does not say whether they moved because somebody edited the
 * component or because the subject that ran three before this one left a
 * stylesheet behind. Those need opposite actions — one is a review, the other is
 * a bug in the suite — and today they arrive identical.
 *
 * **This is not a retry.** A retry runs again and reports the better answer; the
 * failure it hides is the one where the second run is wrong. Here both outcomes
 * are reported and neither clears anything: a change that reproduces alone is
 * still `changed`, and one that does not is still a finding — a different one,
 * against the suite instead of the component.
 *
 * The cost is one collection and *one* render. The shared render is already in
 * the render cache under its document digest (`renderOnce` in
 * `@variance-authority/observe`), so only the clean document is new.
 *
 * What this deliberately does not attempt is naming the subject that poisoned
 * this one. A probe can only see what it can read — stylesheets, custom
 * properties, attributes, stray body nodes — and the causes that actually bite
 * live in module scope, where a singleton store or a cached client is invisible
 * to any amount of DOM photography. So the run answers the question it can
 * answer with evidence, and the difference it hands over is already resolved to
 * a region, a node, a component, and a file. Finding the writer from there is a
 * bisection, and a bisection is the agent's job.
 */
export async function alone(
  planned: PlannedSubject,
  observation: Observation,
  key: BaselineKey | null,
  context: ObserveContext,
  collecting: <T>(job: () => Promise<T>) => Promise<T>,
): Promise<{ alone?: CliObservationRecord['alone'] }> {
  const { config, deps, renderer, budget } = context;

  // A subject that did not change has nothing to attribute, and this is the
  // reason a green run pays nothing at all for any of this.
  if (observation.verdict !== 'changed') return {};

  const limit = config.alone?.limit ?? DEFAULT_ALONE_LIMIT;
  if (limit === 0) return {};

  // Absent capability and exhausted budget are two different sentences, and a
  // reader who gets the wrong one draws the wrong conclusion: one means write
  // the method, the other means raise the number.
  if (deps.collector.collectAlone === undefined) {
    return {
      alone: {
        reproduced: true,
        // No clean world to compare against, so the change stands as observed.
        because: 'not re-run alone: collector has no `collectAlone`',
      },
    };
  }

  if (budget.remaining <= 0) {
    return {
      alone: {
        reproduced: true,
        because: `not re-run alone: budget of ${limit} subjects spent`,
      },
    };
  }

  budget.remaining -= 1;

  // Through the same lane as `collect`, because a clean world is still built out
  // of the collector's one browser: two of these at once is the identical hazard.
  const collectAlone = deps.collector.collectAlone.bind(deps.collector);
  const fresh = await collecting(async () => collectAlone(planned));
  if (!fresh.ok) {
    return {
      alone: {
        reproduced: true,
        because: `not re-run alone: collecting it failed: ${fresh.because}`,
      },
    };
  }

  const observeOptions = {
    renderer,
    store: deps.store,
    ...(fresh.snapshot !== undefined ? { snapshot: fresh.snapshot } : {}),
    ...(fresh.source !== undefined ? { source: fresh.source } : {}),
    ...(context.decoder !== undefined ? { decoder: context.decoder } : {}),
  };

  // The same comparison the first pass made, against the same other side. Not a
  // second implementation of it: reusing these means the clean-world answer
  // inherits attribution, font reporting, and the identity partition rather than
  // acquiring its own subtly different versions of all three.
  let clean: Observation;
  if (key === null) {
    if (fresh.before === undefined) {
      return {
        alone: {
          reproduced: true,
          because: 'not re-run alone: ephemeral retention compares two documents, and the clean collection gave one',
        },
      };
    }
    clean = await observePair(fresh.before, fresh.document, observeOptions);
  } else {
    clean = await observeAgainstBaseline(fresh.document, key, observeOptions);
  }

  if (clean.verdict === 'unchanged') {
    return {
      alone: {
        reproduced: false,
        because: 'matches its baseline when run alone; a subject that ran before it causes the change',
      },
    };
  }

  // Anything that is not `unchanged` leaves the change standing. `incomparable`
  // and `new` are folded in here deliberately: neither is evidence that the
  // change was a leak, and reporting "does not reproduce" on the strength of a
  // baseline we could not read would clear a real regression.
  return {
    alone: {
      reproduced: true,
      because:
        clean.verdict === 'changed'
          ? 'still there when run alone; the component changed'
          : `run alone, the comparison was \`${clean.verdict}\`; change neither confirmed nor cleared`,
    },
  };
}
