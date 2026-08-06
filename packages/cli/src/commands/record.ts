import {
  formatSource,
  inspect,
  rankRegions,
  resolveSource,
  type Diagnostic,
  type RankedRegion,
  type SemanticSnapshot,
  type SourceIndex,
} from '@variance-authority/core';
import type { Observation } from '@variance-authority/observe';
import { DEFAULT_POLICY, STRICT_POLICY } from '@variance-authority/raster';
import type {
  FindingRecord,
  ObservationRecord,
  RegionRecord,
} from '@variance-authority/report';
import type { Collected } from './collector.js';
import type { CliObservationRecord } from './run-report.js';

/**
 * Everything an observation becomes on its way into the report.
 *
 * One file because this is where information gets lost if anyone is careless, and
 * the losses are not symmetric: a dropped diagnostic makes a run look complete
 * when it was not, a dropped `truncated` makes a capped list look exhaustive, and
 * a `nearest` node written into `component` makes a guess look like an
 * attribution. Every function below exists to stop one of those, and they are
 * worth reading together.
 *
 * All of it is testable on a hand-built `Observation` rather than behind a
 * browser, which is the second reason it is not inlined into the loop.
 */

/**
 * The observation as the report records it.
 *
 * Exported because this mapping is where information gets lost if anyone is
 * careless, and it is worth testing on a hand-built `Observation` rather than
 * only behind a browser.
 */
export function recordOf(
  observation: Observation,
  options: {
    readonly causes?: readonly string[];
    readonly source?: SourceIndex;
    readonly images?: ObservationRecord['images'];
    /** What the collection of this subject could not do. See {@link diagnosticsOf}. */
    readonly diagnostics?: readonly Diagnostic[];
    /** Defects in this render, from `inspect`. Independent of the verdict. */
    readonly findings?: readonly FindingRecord[];
    /** What a clean-world re-collection said. See `alone`. */
    readonly alone?: ObservationRecord['alone'];
  } = {},
): CliObservationRecord {
  // Net of exclusions, on both policies. The comparison counts every differing
  // pixel including the ones inside an excluded box, and a record that carried
  // that number would report a subject with a mask over half of it as a subject
  // that moved half of itself. What was absorbed is on `ignored` instead, where
  // it cannot be added to this one by accident (spec 0024).
  const absorbed = observation.ignored?.pixels ?? 0;
  const changed = Math.max(0, (observation.comparison?.changed[DEFAULT_POLICY.id] ?? 0) - absorbed);
  const strict = Math.max(0, (observation.comparison?.changed[STRICT_POLICY.id] ?? 0) - absorbed);
  // The collector's causes first, then the observation's own. A collector that
  // held both documents named them from a full semantic diff, which is strictly
  // better evidence than a comparison of per-component hashes; the hashes are
  // what the durable path has when nobody held two documents (spec 0017).
  const regions = rankRegions(
    observation.regions,
    options.causes ?? observation.causes ?? [],
  );
  const truncated = observation.isolation;
  // The collector's complaints and the comparison's own, in one list. A reader
  // asks "what is wrong with this subject" once, and a field that answered half
  // the question would send them looking for the other half.
  const diagnostics = [...(options.diagnostics ?? []), ...(observation.diagnostics ?? [])];

  return {
    subject: observation.subject,
    verdict: observation.verdict,
    because: because(observation, changed, strict) + qualification(diagnostics),
    changedPixels: changed,
    regions: regions.map((region) => regionRecordOf(region, options.source)),
    ...(truncated !== undefined && truncated.truncated > 0
      ? { truncated: { regions: truncated.truncated, pixels: truncated.truncatedPixels } }
      : {}),
    ...(observation.missingFonts.length > 0 ? { missingFonts: observation.missingFonts } : {}),
    // Carried whenever the subject had an excluded subtree, including when it
    // absorbed nothing: `pixels: 0, boxes: 2` is a rule that caught nothing this
    // run, which is exactly the state a register has to be able to report.
    ...(observation.ignored !== undefined ? { ignored: observation.ignored } : {}),
    ...(observation.relaxed !== undefined ? { relaxed: observation.relaxed } : {}),
    // Present-and-empty, not omitted. `[]` means the render was inspected and
    // was clean; absent means nothing inspected it, because the collector
    // supplied no snapshot. Those are different claims, and the second must
    // never print as the first — the same rule `notObserved` follows.
    ...(options.findings !== undefined ? { findings: options.findings } : {}),
    ...(options.images !== undefined ? { images: options.images } : {}),
    ...(options.alone !== undefined ? { alone: options.alone } : {}),
    ...(diagnostics.length > 0 ? { diagnostics } : {}),
  };
}

/** Spread helper, so `undefined` omits the key rather than setting it. */
export function findingsField(collected: {
  readonly snapshot?: SemanticSnapshot;
  readonly source?: SourceIndex;
}): { findings?: readonly FindingRecord[] } {
  const findings = findingsOf(collected.snapshot, collected.source);
  return findings === undefined ? {} : { findings };
}

/**
 * What this render says about itself, with no baseline consulted.
 *
 * Runs on every subject that produced a snapshot, including the ones that settle
 * without an image and the ones reported `new`. That is the point: a defect
 * present on the first run is the case a comparison can never reach, so the run
 * where there is nothing to compare against is exactly the run that most needs
 * this.
 */
export function findingsOf(
  snapshot: SemanticSnapshot | undefined,
  source: SourceIndex | undefined,
): readonly FindingRecord[] | undefined {
  // `undefined`, not `[]`. A collector that supplies no snapshot has not been
  // inspected, which is not the same as having been inspected and found clean.
  if (snapshot === undefined) return undefined;

  return inspect(snapshot).map((finding) => {
    const resolved =
      source !== undefined && finding.component !== undefined
        ? resolveSource(finding.component, source)
        : null;

    return {
      rule: finding.rule,
      what: finding.what,
      path: finding.path,
      ...(finding.where !== undefined ? { where: finding.where } : {}),
      ...(finding.component !== undefined ? { component: finding.component } : {}),
      ...(resolved !== null ? { file: formatSource(resolved) } : {}),
    };
  });
}

/**
 * The sentence, with the forgiven pixels added back.
 *
 * `DEFAULT_POLICY` forgives antialiasing, which is what every deployed pixel
 * differ does and why "zero pixels changed" is not the same claim as "the images
 * are identical". When the strict policy disagrees, the disagreement is stated:
 * an unobservable difference is never reported as no difference, and a difference
 * that is only visible under a stricter reading is exactly that.
 */
function because(observation: Observation, changed: number, strict: number): string {
  // Both green verdicts, not one. `ignored` is the other way a subject reports
  // nothing to review, and gating this on `unchanged` alone meant a subject that
  // went green through an exclusion stopped disclosing the differences the
  // default policy forgave — an unobservable difference rendered as no
  // difference, in the one place this project refuses that (ADR-0002, ADR-0026).
  const green = observation.verdict === 'unchanged' || observation.verdict === 'ignored';
  if (!green || strict <= changed) return observation.because;

  return (
    `${observation.because}; ${strict} pixel(s) do differ under the strict policy ` +
    '(antialiasing counted), which the default policy forgives'
  );
}

/**
 * The clause that keeps a diagnostic from being a field only a machine reads.
 *
 * `variance_summary` lists the subjects whose verdict is not `unchanged`, so a
 * settled subject appears in the human-facing output only through its own
 * sentence — and that sentence is what a reviewer sees when they ask about it by
 * name. Codes and severities only: the messages are already on the record, and
 * repeating three paragraphs of them here would make the one line nobody can skip
 * the one line everybody does.
 *
 * Severity is printed because it is what `exitFor` reads, and a reader who sees a
 * complaint quoted at them and a `0` exit code is owed the reason those agree.
 */
export function qualification(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) return '';

  const named = diagnostics.map((entry) => `${entry.code} (${entry.severity})`).join(', ');
  return (
    `; the collection of this subject reported ${named}, so what was compared may be less ` +
    'than the whole subject'
  );
}

/**
 * Every diagnostic the cheap tiers produced for this subject, once each.
 *
 * **Why both sources.** The document and the snapshot are two views of one
 * capture, and they do not carry the same complaints: a cross-origin stylesheet
 * is dropped while the document is being assembled, and a dangling accessible-name
 * reference is found while the snapshot is being normalized. Taking either alone
 * loses half of what the run knows about how complete its own inputs were.
 *
 * **Why deduplicated.** Because they are two views of one capture, a diagnostic
 * raised before the split appears in both. Printing it twice would invite the
 * reader to count two unreadable stylesheets where there is one, which is a
 * fabricated number — and identical severity, code, message and node carry no
 * second fact. Diagnostics that differ in any of those four are kept apart.
 *
 * The `before` document of an ephemeral pair is deliberately not merged in: its
 * complaints are about the *previous* revision's collection, and a record that
 * blended them could not say which side of the comparison was incomplete.
 */
export function diagnosticsOf(
  collected: Extract<Collected, { ok: true }>,
): readonly Diagnostic[] {
  const byIdentity = new Map<string, Diagnostic>();

  for (const diagnostic of [
    ...collected.document.diagnostics,
    ...(collected.snapshot?.diagnostics ?? []),
  ]) {
    const key = JSON.stringify([
      diagnostic.severity,
      diagnostic.code,
      diagnostic.message,
      diagnostic.nodePath ?? null,
    ]);
    if (!byIdentity.has(key)) byIdentity.set(key, diagnostic);
  }

  return [...byIdentity.values()];
}

function regionRecordOf(region: RankedRegion, source?: SourceIndex): RegionRecord {
  const resolved =
    source !== undefined && region.component !== undefined
      ? resolveSource(region.component, source)
      : null;

  if (region.unattributed) {
    // `nearest` is orientation and never attribution, so it is not written into
    // `component` — a trace tool would then count this as an appearance of a
    // component no box actually contained. It goes into the landmark phrase
    // instead, where it reads as "what this is near" and nothing more.
    const near = region.nearest;
    const phrase =
      near === undefined
        ? undefined
        : `near ${near.component ?? near.path}${near.where !== undefined ? ` (${near.where})` : ''}`;

    return {
      x: region.region.x,
      y: region.region.y,
      width: region.region.width,
      height: region.region.height,
      pixels: region.region.pixels,
      cause: region.cause,
      unattributed: true,
      ...(region.fingerprint !== undefined ? { fingerprint: region.fingerprint } : {}),
      ...(phrase !== undefined ? { where: phrase } : {}),
    };
  }

  return {
    x: region.region.x,
    y: region.region.y,
    width: region.region.width,
    height: region.region.height,
    pixels: region.region.pixels,
    cause: region.cause,
    ...(region.component !== undefined ? { component: region.component } : {}),
    ...(region.path !== undefined ? { path: region.path } : {}),
    ...(region.where !== undefined ? { where: region.where } : {}),
    ...(resolved !== null ? { file: formatSource(resolved) } : {}),
    ...(region.fingerprint !== undefined ? { fingerprint: region.fingerprint } : {}),
  };
}
