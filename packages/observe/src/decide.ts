import {
  attributeRegions,
  bandsBetween,
  excludedBoxes,
  isolateRegions,
  subtractRegions,
  type DiffRegion,
  type Isolation,
} from '@variance-authority/core/attribute';
import { mergeDiagnostics, type Pictured, type Raster } from '@variance-authority/core/format';
import { absorbsEntirely, relaxes, fingerprintOfMask } from '@variance-authority/core/judge';
import type { SemanticSnapshot } from '@variance-authority/core/format';
import { compareRasters } from '@variance-authority/png';
import { attributionOf } from './attribution.js';
import { count, describeChange, forgiveness, reshaped, unjoined, unrecorded, type BeforeSide } from './because.js';
import { unpackSnapshot } from './packed.js';
import { frameDiagnostics } from './frame.js';
import type { CompareInputs, IgnoredPixels, Observation } from './observe.js';

/**
 * Two rasters become a verdict.
 *
 * Split from the composition because it is the half that *decides*, and the two
 * are read for opposite reasons: `observe.ts` answers "what happens in which
 * order", and this answers "given these two images and what is known about the
 * document behind them, what does the run say". Everything here is a decision
 * with an argument attached — which pixels were excluded, which shapes were
 * absorbed, which components caused the rest, and which of the five verdicts
 * follows.
 *
 * The rule the whole file is arranged around: **a green verdict is never one
 * word.** `unchanged` means nothing moved and `ignored` means nothing moved
 * outside what the operator excluded, and collapsing them would make every count
 * downstream unable to say how much of a suite's green was earned (ADR-0026).
 */

/**
 * Both sides carry an image: this is the pixel tier, and it is reached only for
 * a pair the caller has already established is comparable — which includes both
 * having been photographed. A subject with no pixels never arrives here, and
 * `unpictured.ts` is the entry point that decides which of the two this is.
 *
 * `beforeIs` says what the before side is, so a sentence about it can name it:
 * a stored baseline, which accepting again rewrites, or an image the caller
 * handed in.
 */
export async function decide(
  subject: string,
  before: Pictured,
  after: Pictured,
  rendered: boolean,
  options: CompareInputs,
  beforeIs: BeforeSide,
): Promise<Observation> {
  const comparison = await compareRasters(before, after, {
    ...options.compare,
    ...(options.decoder !== undefined ? { decoder: options.decoder } : {}),
    ...(options.steps !== undefined ? { steps: options.steps } : {}),
  });
  const missingFonts = [...new Set([...before.missingFonts, ...after.missingFonts])];

  const attribution = attributionOf(before.components, after.components);

  // The collector's complaints travel with the snapshot, and this is the only
  // place a library caller meets them: `recordOf` merges them for the CLI, and a
  // suite driving this from its own runner has no record. A subject whose
  // typeface the host chose said so at collection and the observation said
  // nothing -- the one finding that explained the moved pixels was produced,
  // carried, and dropped one call short of the person who needed it.
  const diagnostics = mergeDiagnostics(
    options.snapshot?.diagnostics,
    frameDiagnostics(options.snapshot, after),
  );
  const diagnosticsField = diagnostics.length === 0 ? {} : { diagnostics };

  // Excluded subtrees travel *on the snapshot*, so the raster tier needs no
  // configuration of its own to honour them: the same declaration that dropped
  // the semantic deltas arrives here as boxes, resolved against the tree that was
  // actually rendered. Two configurations would be two chances to disagree about
  // what the subject is (spec 0024).
  const boxes =
    options.snapshot === undefined
      ? []
      : excludedBoxes(options.snapshot, { scale: after.identity.deviceScaleFactor });

  // `comparison.mask` is the isolation policy's own mask, so its count is that
  // policy's count — reading it here rather than re-indexing `comparison.changed`
  // keeps the number and the pixels it was subtracted from provably the same.
  const subtraction = subtractRegions(comparison.mask, boxes);
  const remaining = subtraction.mask.changed;
  const documentMoved = before.documentDigest !== after.documentDigest;
  const accessibility = accessibilityBetween(before, after);
  // Rows that moved are pixels that moved, even where each matches the row it
  // came from: the alignment keeps the shift out of the mask and says so here.
  const moved = reshaped(comparison);
  const pixelsMoved = remaining > 0 || moved;
  // The before side's tree, for the region join. Asked only when this run has a
  // tree of its own: without one there is nothing to join, and nothing an
  // accepting run could record in its place.
  const left = options.snapshot === undefined ? undefined : unpackSnapshot(before.snapshot);
  const signals = {
    document: documentMoved ? ('changed' as const) : ('unchanged' as const),
    pixels: pixelsMoved ? ('changed' as const) : ('unchanged' as const),
    ...(accessibility === undefined ? {} : { accessibility }),
    // A stored baseline only: an image handed in is nobody's to re-stamp.
    ...(beforeIs === 'baseline' && options.snapshot !== undefined && left === undefined
      ? { snapshot: 'unrecorded' as const }
      : {}),
  };
  // Said on every verdict the mark is set on, so the sentence explains the render.
  const short = signals.snapshot === undefined ? '' : unrecorded();

  const byRule: Record<string, number> = {};
  for (const [index, box] of boxes.entries()) {
    byRule[box.rule] = (byRule[box.rule] ?? 0) + (subtraction.cleared[index] ?? 0);
  }

  const ignoredField =
    boxes.length === 0
      ? {}
      : {
          ignored: {
            pixels: subtraction.ignored,
            boxes: boxes.length,
            inert: subtraction.inert.length,
            byRule,
          },
        };

  // The second cheap exit, and it is the one a route-level test is for.
  //
  // A subject declared `layout` asserts that the page still assembles. A rebrand
  // repaints every surface on it, moves no box and changes no accessible name —
  // so every band the two revisions' component hashes disagree on is one this
  // subject is not asserted on, and there is nothing here to review. Reported
  // `ignored` rather than `unchanged`, because a difference was absorbed by a
  // declaration somebody wrote and the ledger has to be able to say so
  // (ADR-0026).
  //
  // Before isolation on purpose. Clustering a mask, attributing its regions and
  // fingerprinting each one is the expensive half of a comparison, and a relaxed
  // route under a rebrand is exactly the case where all of it would be computed
  // and then thrown away. This is the cheaper-and-faster half of the feature and
  // it is not incidental: forty routes in a token PR pay for one hash comparison
  // each instead of forty isolations.
  //
  // It cannot run before the exclusion subtraction above, because a subject may
  // be both relaxed and masked, and the ignore register's numbers are computed
  // there. It runs after, so both accounts are complete.
  const relaxed = relaxedVerdict(options, before, after, forgiveness(comparison, options));

  if (
    relaxed !== null &&
    remaining > 0 &&
    !moved &&
    accessibility?.verdict !== 'changed'
  ) {
    return {
      subject,
      verdict: 'ignored',
      because: relaxed.because + short,
      relaxed: relaxed.relaxed,
      comparison,
      regions: [],
      rendered,
      missingFonts,
      signals,
      ...ignoredField,
      ...attribution,
      ...diagnosticsField,
    };
  }

  // The cheap exit, and it must come before isolation: a run where nothing moved
  // outside an exclusion should not pay to cluster a mask that is already empty.
  // Shape ignores cannot apply here, because there is no region to fingerprint.
  if (
    remaining === 0 &&
    !moved &&
    accessibility?.verdict !== 'changed'
  ) {
    // Two green verdicts, never one. `unchanged` is a fact about the render;
    // `ignored` is a fact about what somebody decided not to look at, and folding
    // the second into the first is the failure the whole mechanism is written
    // around — a suite could then never be asked how much of its green it earned.
    const wasIgnored = subtraction.ignored > 0;
    const beyond = forgiveness(comparison, options);

    return {
      subject,
      verdict: wasIgnored ? 'ignored' : 'unchanged',
      because: (wasIgnored
        ? `${count(subtraction.ignored, 'pixel')} differ and all of them fall inside ` +
          `${count(boxes.length, 'excluded region')}; nothing outside them moved${beyond}`
        : missingFonts.length > 0
          ? `no pixels differ${beyond}, but the renderer lacked ${missingFonts.join(', ')} ` +
            'on both sides, so both images are of a substituted font'
          : `no pixels differ${beyond}`) + short,
      comparison,
      regions: [],
      rendered,
      missingFonts,
      signals,
      ...ignoredField,
      ...attribution,
      ...diagnosticsField,
    };
  }

  // A browser accessibility change is reviewable even when the screenshot is
  // byte-for-byte quiet. There is no rectangle to invent: the retained
  // before/after ARIA snapshots are the evidence. Document movement remains a
  // named signal, but is not itself a raster verdict: reconstruction inputs can
  // differ while both independently observed outputs agree.
  if (remaining === 0 && !moved) {
    return {
      subject,
      verdict: 'changed',
      because:
        (accessibility?.before === undefined
          ? 'the baseline has no browser accessibility snapshot and this run captured one, while no pixels changed'
          : accessibility.after === undefined
            ? 'this run captured no browser accessibility snapshot where the baseline has one, while no pixels changed'
            : 'the browser accessibility tree changed while no pixels changed') + short,
      comparison,
      regions: [],
      rendered,
      missingFonts,
      signals,
      ...ignoredField,
      ...attribution,
      ...diagnosticsField,
    };
  }

  const found = isolateRegions(subtraction.mask, {
    ...(options.cell !== undefined ? { cell: options.cell } : {}),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
  });

  const shapes = options.ignoreShapes ?? {};
  const kept: DiffRegion[] = [];
  const prints = new Map<DiffRegion, string>();
  let byShape = 0;

  for (const region of found.regions) {
    const fingerprint = fingerprintOfMask(subtraction.mask, region);
    const rule = shapes[fingerprint];
    if (rule === undefined) {
      prints.set(region, fingerprint);
      kept.push(region);
      continue;
    }
    byShape += region.pixels;
    byRule[rule] = (byRule[rule] ?? 0) + region.pixels;
  }

  const isolation: Isolation = { ...found, regions: kept };
  const absorbed = subtraction.ignored + byShape;
  const outstanding = remaining - byShape;

  const ignoredHere =
    absorbed === 0 && boxes.length === 0 && Object.keys(byRule).length === 0
      ? {}
      : {
          ignored: {
            pixels: absorbed,
            boxes: boxes.length,
            inert: subtraction.inert.length,
            byRule,
          },
        };

  if (
    outstanding === 0 &&
    !moved &&
    accessibility?.verdict !== 'changed'
  ) {
    return {
      subject,
      verdict: 'ignored',
      because:
        `${count(absorbed, 'pixel')} differ and every one of them was absorbed by an ignore; ` +
        `nothing else moved${forgiveness(comparison, options)}${short}`,
      comparison,
      regions: [],
      rendered,
      missingFonts,
      signals,
      ...ignoredHere,
      ...attribution,
      ...diagnosticsField,
    };
  }

  // Every surviving region carries its own fingerprint, so writing a shape-scoped
  // ignore is copying a digest out of the report rather than deriving one.
  const regions = (
    options.snapshot === undefined
      ? []
      : attributeRegions(isolation.regions, options.snapshot, {
          scale: after.identity.deviceScaleFactor,
          before: left,
          ...(comparison.alignment === undefined ? {} : { inserted: comparison.alignment.inserted }),
        })
  ).map((attributed) => {
    const fingerprint = prints.get(attributed.region);
    return fingerprint === undefined ? attributed : { ...attributed, fingerprint };
  });

  return {
    subject,
    verdict: 'changed',
    because:
      describeChange(comparison, isolation, regions, outstanding) +
      (absorbed > 0 ? `, with ${absorbed}px absorbed by an ignore` : '') +
      (regions.length > 0 && left === undefined ? unjoined(beforeIs) : short),
    comparison,
    isolation,
    regions,
    rendered,
    missingFonts,
    signals,
    ...ignoredHere,
    ...attribution,
    ...diagnosticsField,
  };
}

export function accessibilityBetween(
  before: Raster,
  after: Raster,
): NonNullable<NonNullable<Observation['signals']>['accessibility']> | undefined {
  const left = before.accessibility;
  const right = after.accessibility;
  if (left === undefined && right === undefined) return undefined;
  // Evidence on one side only is a change in what the subject is recorded as,
  // never an empty tree: accepting it gives the axis its baseline.
  if (left === undefined || right === undefined) {
    return {
      verdict: 'changed',
      ...(left === undefined ? {} : { before: left }),
      ...(right === undefined ? {} : { after: right }),
    };
  }
  // The digest covers the producer and the engine, so trees from two engines
  // are compared by what they expose; the engine that moved is the cause.
  const same =
    left.digest === right.digest ||
    (left.roots.length === right.roots.length &&
      left.roots.every((root, index) => root === right.roots[index]));
  return { verdict: same ? 'unchanged' : 'changed', before: left, after: right };
}

/**
 * What the snapshot declared, before anything was compared.
 *
 * Every path that returns before a comparison — `new` and the
 * settlement that answers from a digest — still has an operator's exclusions on
 * its snapshot, and used to report none. The run-level ledger derives "this rule
 * resolved nowhere" from the absence, so a fresh checkout with no baselines told
 * the operator that every ignore they had written was dead and should be deleted.
 *
 * Pixels are `0` by construction and `inert` is `0` rather than "all of them": a
 * box that was never compared covered no changed pixel because there were no
 * changed pixels, which is not the same claim as the box being useless. The
 * ledger tells the two apart by asking whether the subject was compared at all.
 *
 * Keyed from `ignoreSites` rather than from the boxes, so a profile with no
 * layout engine still reports which rules resolved — it observed no box and it
 * did observe a site, and those are different facts.
 */
export function declaredIgnores(
  snapshot: SemanticSnapshot | undefined,
  scale: number,
): IgnoredPixels | undefined {
  const sites = snapshot?.ignoreSites ?? [];
  if (snapshot === undefined || sites.length === 0) return undefined;

  const byRule: Record<string, number> = {};
  for (const site of sites) byRule[site.rule] = 0;

  return { pixels: 0, boxes: excludedBoxes(snapshot, { scale }).length, inert: 0, byRule };
}

/**
 * Whether a declared sensitivity absorbs this subject entirely, and why.
 *
 * `null` for every reason not to absorb, and they are not the same reason:
 * nothing was declared, the level asserts on everything, one side carried no
 * component hashes, or a band that *is* asserted on moved. Only the last is a
 * decision; the rest are absences, and each of them fails towards reporting.
 *
 * The third is the one worth being careful about. A baseline written before
 * component hashes existed — or by a store that dropped them — cannot be asked
 * which bands moved, and a relaxed subject compared against one must be reported
 * in full rather than silently absorbed. A declaration that cannot be evaluated
 * has not been satisfied.
 *
 * A dimension change is never absorbed. The canvas itself moved, which is the
 * one thing no level can call somebody else's business — the same rule an ignore
 * already obeys.
 */
function relaxedVerdict(
  options: CompareInputs,
  before: Raster,
  after: Raster,
  beyond: string,
): { readonly because: string; readonly relaxed: NonNullable<Observation['relaxed']> } | null {
  const rule = options.sensitivity;
  if (rule === undefined || rule.level === 'strict') return null;
  if (before.components === undefined || after.components === undefined) return null;

  const moved = bandsBetween(before.components, after.components);
  if (!absorbsEntirely(rule.level, moved)) return null;

  const absorbed = relaxes(rule.level, moved).absorbed;

  return {
    because:
      `pixels differ${beyond}, and every band that moved (${absorbed.join(', ')}) is one this subject ` +
      `is not asserted on: \`${rule.rule}\` declares it asserts on ${rule.level} — ${rule.reason}`,
    relaxed: { rule: rule.rule, level: rule.level, bands: absorbed },
  };
}
