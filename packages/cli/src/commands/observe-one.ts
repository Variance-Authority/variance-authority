import { locateSites } from '@variance-authority/core/attribute';
import { documentDigest } from '@variance-authority/core/format';
import type { Level } from '@variance-authority/core/judge';
import {
  declaredIgnores,
  observeAgainstBaseline,
  observePair,
  type Observation,
} from '@variance-authority/observe';
import { settle, type BaselineKey } from '@variance-authority/raster';
import { again } from './again.js';
import { alone } from './alone.js';
import type { Collected, PlannedSubject } from './collector.js';
import { liveIgnores, scopedTo } from './ignores.js';
import { images } from './images.js';
import {
  dated,
  diagnosticsOf,
  findingsField,
  findingsOf,
  inherited,
  marksOf,
  qualification,
  recordOf,
} from './record.js';
import type { ObserveContext, Outcome } from './run-context.js';
import type { CliObservationRecord } from './run-report.js';
import type { Config } from '../config.js';

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

  // Inspection runs once, above every branch, for the same reason diagnostics
  // do: all three paths out of this function report findings, and one of them —
  // the settled path — reports them having read no image at all. Hoisting it
  // also puts the list in the hands of `images`, which writes it onto the
  // candidate sidecar so that the run *after* this one can say which of these
  // defects it inherited.
  const found = await findingsOf(collected.snapshot, collected.source, deps.collector.callSites);
  const marks = marksOf(found);

  // Shape-scoped ignores, flattened to the lookup the comparison actually does.
  // Built per subject rather than once, because a rule may name the subjects it
  // applies to and a digest that absorbed a region in the wrong story would be
  // the exact failure a scoped rule exists to prevent.
  const shapes = shapesFor(config, planned, deps.now());

  const relaxation = sensitivityFor(config, planned);

  const observeOptions = {
    renderer,
    store: deps.store,
    ...(relaxation !== undefined ? { sensitivity: relaxation } : {}),
    ...(Object.keys(shapes).length > 0 ? { ignoreShapes: shapes } : {}),
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

    const observation = await located(
      await observePair(collected.before, collected.document, observeOptions),
      collected,
      context,
    );
    return {
      kind: 'observed',
      record: recordOf(observation, {
        ...(collected.causes !== undefined ? { causes: collected.causes } : {}),
        ...(collected.source !== undefined ? { source: collected.source } : {}),
        ...(collected.presentation !== undefined ? { presentation: collected.presentation } : {}),
        ...(await images(
          id,
          observation,
          collected.document,
          renderer,
          config,
          deps,
          null,
          collected.snapshot,
          marks,
        )),
        diagnostics,
        // No `standing` on this path, and none is inferrable. Ephemeral
        // retention compares two renders made in this run, and the earlier one
        // arrives as a document rather than a snapshot — so there is nothing to
        // inspect on the other side, and absent says so.
        ...findingsField(found),
        ...(await investigate(planned, collected, observation, null, context, collecting)),
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
  // `identityFor`, never `renderer.identity`. The two differ by exactly the
  // document's scale factor, so at 1x they coincide and above it the settlement
  // asks about an identity nothing was ever written under — which does not
  // produce a wrong verdict, because the observation below looks the baseline up
  // properly, but it does switch this whole economy off for every run above 1x
  // and say nothing. That is the drift `Renderer.identityFor` exists to prevent.
  const identity = renderer.identityFor(collected.document);
  const described = await deps.store.describe(key, identity);
  const settlement = settle(documentDigest(collected.document), described, identity);

  if (settlement.kind === 'settled') {
    const missingFonts = settlement.missingFonts ?? [];

    // Findings are attached here too, on the path that settles without rendering
    // anything. A subject whose document digest matched its baseline has changed
    // nothing and may still contain a control with no name — that is the whole
    // reason inspection is not a comparison.
    //
    // And this is the one path where *when it arrived* needs no stored evidence.
    // Settling means this render's document digest is the baseline's, so the
    // document that would be inspected on the other side is this one: every
    // defect here is a defect the baseline had, by identity rather than by
    // lookup. A baseline written before marks existed still gets a true answer.
    const findings = dated(found, inherited(described, true));

    // The exclusions this subject declared, on the path that compares nothing.
    // A settled subject reached its verdict from a digest, so no ignore had
    // anything to absorb — and reporting no ignore at all is what told the
    // run-level ledger that every rule the operator wrote had resolved nowhere.
    const declared = declaredIgnores(collected.snapshot, identity.deviceScaleFactor);

    // The sweep reaches here or it reaches almost nothing. A green suite settles
    // on its digests and never builds an `Observation` at all, so a mode whose
    // whole purpose is finding the subjects that would flake *tomorrow* has to be
    // asked on the path that today's green subjects actually take.
    const swept = await again(
      planned,
      collected,
      settlement.verdict,
      relaxation,
      context,
      collecting,
    );

    return {
      kind: 'observed',
      record: {
        subject: id,
        verdict: settlement.verdict,
        because: settlement.because + qualification(diagnostics),
        changedPixels: 0,
        regions: [],
        ...swept,
        ...(collected.presentation === undefined
          ? {}
          : { signals: { presentation: collected.presentation } }),
        ...(findings !== undefined ? { findings } : {}),
        ...(declared !== undefined ? { ignored: declared } : {}),
        ...(missingFonts.length > 0 ? { missingFonts } : {}),
        ...(diagnostics.length > 0 ? { diagnostics } : {}),
      },
    };
  }

  const observation = await located(
    await observeAgainstBaseline(collected.document, key, observeOptions),
    collected,
    context,
  );

  return {
    kind: 'observed',
    ...(collected.stabilization !== undefined ? { stabilization: collected.stabilization } : {}),
    record: recordOf(observation, {
      ...(collected.causes !== undefined ? { causes: collected.causes } : {}),
      ...(collected.source !== undefined ? { source: collected.source } : {}),
      ...(collected.presentation !== undefined ? { presentation: collected.presentation } : {}),
      ...(await images(
        id,
        observation,
        collected.document,
        renderer,
        config,
        deps,
        key,
        collected.snapshot,
        marks,
      )),
      diagnostics,
      // Crossed against the marks the baseline recorded, from the sidecar this
      // subject already read to try to settle. A baseline that recorded none
      // leaves every finding undated rather than calling it new.
      ...findingsField(dated(found, inherited(described, false))),
      ...(await investigate(planned, collected, observation, key, context, collecting)),
    }),
  };
}

/**
 * The signal, and the only place a captured frame is ever spent.
 *
 * A page reads a stack off every fiber because reading one is nearly free.
 * Turning a stack into `src/Button.tsx:12` is not: it means fetching the module
 * the frame names and decoding the map beside it. So the question is asked here,
 * after attribution has already decided which nodes the report is going to
 * print, and it is asked about those nodes only — a subject with one changed
 * button resolves one call site, and a subject the comparison found nothing in
 * resolves none.
 *
 * Nothing degrades when this does nothing. No resolver means no browser to fetch
 * through; no snapshot means nothing carried frames; and a region whose node
 * already recorded its own line — React ≤18, or `@variance-authority/jsx-source`
 * — was never going to reach the map. All three are a report with the same
 * component names and one fewer file path on it.
 */
async function located(
  observation: Observation,
  collected: Extract<Collected, { ok: true }>,
  context: ObserveContext,
): Promise<Observation> {
  const resolver = context.deps.collector.callSites;
  if (resolver === undefined || collected.snapshot === undefined) return observation;

  const regions = await locateSites(observation.regions, collected.snapshot, resolver);
  return regions === observation.regions ? observation : { ...observation, regions };
}

/**
 * The two second passes, in the one order that makes either of them mean
 * anything.
 *
 * `again` holds the world and lets time pass; `alone` rebuilds the world and
 * holds time. Both re-collect a subject the run called `changed`, and the whole
 * value of the second depends on the first having come back quiet: `alone`
 * concludes *the clean reading differs from the shared one, therefore the world
 * moved it*, and that inference is only available when two readings of one world
 * would have agreed. Asked in the other order, a subject with a clock in it
 * produces a confident sentence about suite pollution and sends somebody to
 * bisect a run order that has nothing to do with it.
 *
 * So when the subject fails to agree with itself, `alone` is not asked. Nothing
 * it could return would be evidence, and the run keeps a collection and a render.
 */
async function investigate(
  planned: PlannedSubject,
  collected: Extract<Collected, { ok: true }>,
  observation: Observation,
  key: BaselineKey | null,
  context: ObserveContext,
  collecting: <T>(job: () => Promise<T>) => Promise<T>,
): Promise<{
  unstable?: CliObservationRecord['unstable'];
  alone?: CliObservationRecord['alone'];
}> {
  const unstable = await again(
    planned,
    collected,
    observation.verdict,
    sensitivityFor(context.config, planned),
    context,
    collecting,
  );
  if (unstable.unstable !== undefined) return unstable;

  return alone(planned, observation, key, context, collecting);
}

/**
 * The `fingerprint → rule` map for one subject.
 *
 * A rule that lists subjects contributes nothing to the subjects it does not
 * list. Applying it everywhere would make a scoped ignore unscoped in the one
 * tier where the operator has least visibility of what it caught.
 */
function shapesFor(config: Config, planned: PlannedSubject, now: string): Record<string, string> {
  const shapes: Record<string, string> = {};

  // Expiry, by the same predicate that decides what reaches the collector. A
  // place-scoped rule expires by never being sent; a shape-scoped rule has no
  // collector to be withheld from, so it expires here or nowhere — and the ledger
  // prints `[expired]` either way, which made the report assert the opposite of
  // what the run did.
  for (const rule of liveIgnores(config.ignore ?? [], now)) {
    if (rule.fingerprints === undefined) continue;
    if (!scopedTo(rule, { id: planned.subject.id, ...(planned.tags ? { tags: planned.tags } : {}) })) {
      continue;
    }
    for (const fingerprint of rule.fingerprints) shapes[fingerprint] = rule.id;
  }

  return shapes;
}

/**
 * The sensitivity that applies to one subject, or nothing.
 *
 * **The last matching rule wins**, which is the opposite of how the ignore list
 * composes and is deliberate. Ignores accumulate — every rule that matches
 * absorbs what it names, and two rules absorb more than one. A sensitivity is a
 * statement about how much of *this subject* is under test, and two contradictory
 * answers to that cannot both hold; taking the last lets an operator write the
 * broad rule first and the exception after it, reading top to bottom the way the
 * file does.
 *
 * `strict` is a real answer here rather than an absence. It is how the exception
 * is spelled — a route inside a relaxed group that is asserted on in full — and
 * `absorbsEntirely` turns it into no absorption without a special case.
 */
function sensitivityFor(
  config: Config,
  planned: PlannedSubject,
): { readonly rule: string; readonly reason: string; readonly level: Level } | undefined {
  let found: { rule: string; reason: string; level: Level } | undefined;

  for (const rule of config.sensitivity ?? []) {
    if (!scopedTo(rule, { id: planned.subject.id, ...(planned.tags ? { tags: planned.tags } : {}) })) {
      continue;
    }
    found = { rule: rule.id, reason: rule.reason, level: rule.level };
  }

  return found;
}
