import { documentDigest } from '@variance-authority/core';
import { observeAgainstBaseline, observePair } from '@variance-authority/observe';
import type { BaselineKey } from '@variance-authority/raster';
import { alone } from './alone.js';
import type { Collected, PlannedSubject } from './collector.js';
import { images } from './images.js';
import { diagnosticsOf, findingsField, findingsOf, qualification, recordOf } from './record.js';
import type { ObserveContext, Outcome } from './run-context.js';
import { settle } from './settle.js';

/**
 * One subject, from a collected document to the line the report will carry.
 *
 * Separate from the loop because the two answer different questions. `run.ts`
 * answers *which subjects were looked at and which were not*; this file answers
 * *what was decided about this one, and how much it cost to decide it*. Reading
 * either one to find out about the other is what made them one 1600-line file.
 *
 * The order below is the economy: diagnostics first because every exit needs
 * them, then the settlement query — a sidecar read, not an image — and only then
 * the observation pipeline for the subjects that could not be settled without
 * one.
 */
export async function observeOne(
  planned: PlannedSubject,
  collected: Extract<Collected, { ok: true }>,
  context: ObserveContext,
  /** Serializes collector access. See `serial`. */
  collecting: <T>(job: () => Promise<T>) => Promise<T>,
): Promise<Outcome> {
  const { config, deps, renderer } = context;
  const id = planned.subject.id;

  // Read once, before any branch, because every path out of this function
  // produces a record and none of them is entitled to a subject's diagnostics
  // being someone else's problem. The settled path in particular produces no
  // `Observation` at all, which is how these came to be dropped.
  const diagnostics = diagnosticsOf(collected);

  const observeOptions = {
    renderer,
    store: deps.store,
    ...(collected.snapshot !== undefined ? { snapshot: collected.snapshot } : {}),
    ...(collected.source !== undefined ? { source: collected.source } : {}),
    ...(context.decoder !== undefined ? { decoder: context.decoder } : {}),
  };

  if (config.retention === 'ephemeral') {
    if (collected.before === undefined) {
      return {
        kind: 'not-observed',
        entry: {
          subject: id,
          kind: 'failed',
          because:
            'ephemeral retention compares two renders made in this run, and the collector ' +
            'supplied no previous-revision document for this subject; nothing was observed',
        },
      };
    }

    const observation = await observePair(
      collected.before,
      collected.document,
      observeOptions,
    );
    return {
      kind: 'observed',
      record: recordOf(observation, {
        ...(collected.causes !== undefined ? { causes: collected.causes } : {}),
        ...(collected.source !== undefined ? { source: collected.source } : {}),
        ...(await images(id, observation, collected.document, renderer, config, deps, null)),
        diagnostics,
        ...findingsField(collected),
        ...(await alone(planned, observation, null, context, collecting)),
      }),
    };
  }

  const key: BaselineKey = { subject: id };

  // The settlement query, and it reads no image. `describe` answers from the
  // sidecar — a few hundred bytes of text against a base64-encoded PNG — which
  // on a suite where almost nothing moved is the whole cost of the durable path.
  //
  // When it does not settle, the observation pipeline runs and looks the baseline
  // up properly: one extra lookup per unsettled subject, paid so that comparison,
  // isolation, and attribution are not reimplemented here where they would be a
  // second, untested copy.
  const described = await deps.store.describe(key, renderer.identity);
  const settlement = settle(documentDigest(collected.document), described, renderer.identity);

  if (settlement.kind === 'settled') {
    const missingFonts = settlement.missingFonts ?? [];

    // Findings are attached here too, on the path that settles without rendering
    // anything. A subject whose document digest matched its baseline has changed
    // nothing and may still contain a control with no name — that is the whole
    // reason inspection is not a comparison.
    const findings = findingsOf(collected.snapshot, collected.source);

    return {
      kind: 'observed',
      record: {
        subject: id,
        verdict: settlement.verdict,
        because: settlement.because + qualification(diagnostics),
        changedPixels: 0,
        regions: [],
        ...(findings !== undefined ? { findings } : {}),
        ...(missingFonts.length > 0 ? { missingFonts } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      },
    };
  }

  const observation = await observeAgainstBaseline(collected.document, key, observeOptions);

  return {
    kind: 'observed',
    record: recordOf(observation, {
      ...(collected.causes !== undefined ? { causes: collected.causes } : {}),
      ...(collected.source !== undefined ? { source: collected.source } : {}),
      ...(await images(id, observation, collected.document, renderer, config, deps, key)),
      diagnostics,
      ...findingsField(collected),
      ...(await alone(planned, observation, key, context, collecting)),
    }),
  };
}
