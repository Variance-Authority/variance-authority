import type { Band } from '../compare/band.js';
import type { Docket, DocketEntry } from './docket.js';
import type { AggregateImpact } from '../compare/impact.js';
import { formatSource, resolveSource, type SourceIndex } from '../attribute/source.js';
import type { Verdict } from './verdict.js';

/**
 * Intent, and the adjudication it enables (spec §7.2).
 *
 * Everything up to here answers *what changed*. That is not the question a review
 * asks. A real branch carries several deliberate changes at once — a token, a
 * component, a page — and the only thing anyone wants to know is **which of the
 * changes in front of me is not one I meant to make**.
 *
 * A tool that reports "23 screenshots differ" cannot answer that, and neither can
 * a tool that reports 5 roots without knowing which were intended. The missing
 * half is a declaration, written *before* the diff is read:
 *
 * > this branch changes `--va-color-accent` and `Button`
 *
 * Everything matching the declaration is `authorized` and needs no attention.
 * Everything else is the finding — and on a branch with four intended changes,
 * the accidental fifth is otherwise buried among them by construction.
 *
 * The declaration is deliberately about *roots*, not subjects or screenshots. A
 * root is stable across subjects and across builds, so an approval recorded
 * against one keeps applying as new subjects start consuming it — which is what
 * makes it a contract rather than a snapshot of one build's output.
 */

export interface IntentClaim {
  /**
   * Root id this claim covers, e.g. `token:--va-color-accent`, `component:Button`.
   *
   * Matched exactly. A prefix or fuzzy match would let a claim about one token
   * silently authorize a change to another, which is the one thing a declaration
   * must never do.
   */
  readonly root: string;

  /** Why. Not used for matching; carried into the report so review has context. */
  readonly reason: string;

  /**
   * Cap on how far the change may reach.
   *
   * The most useful field in practice. "I meant to restyle `Button`" is almost
   * always true; "I meant to restyle `Button` across 40 subjects" is the part
   * nobody checks. Exceeding a declared bound is not a violation — the change is
   * still the one that was intended — but it is no longer authorized silently.
   */
  readonly maxSubjects?: number;

  /**
   * Bands the author expects. A change that also reshapes the tree when only a
   * value change was declared is worth surfacing even though the root matches.
   */
  readonly bands?: readonly Band[];

  /** Impacts the author expects. Declaring `paint` and reflowing is a surprise. */
  readonly impact?: readonly AggregateImpact[];
}

export interface Intent {
  readonly claims: readonly IntentClaim[];
}

/**
 * What a project decides in advance, independent of any one branch (spec §7.2).
 *
 * Policy is the difference between "not declared" and "not allowed". An
 * undeclared token change is a review; an undeclared change to a protected
 * component is a violation, whatever the branch says about it.
 */
export interface Policy {
  /**
   * Bands that block when undeclared. Others advise.
   *
   * Empty means nothing blocks, which is a legitimate starting position for a
   * team adopting this — and one worth being able to express, since a tool that
   * blocks by default on day one gets switched off in week one.
   */
  readonly blocking?: readonly Band[];

  /** Any undeclared change here is a violation, whatever its band. */
  readonly protectedComponents?: readonly string[];

  /** Roots that never need declaring. Escape hatch for known-noisy areas. */
  readonly alwaysAuthorized?: readonly string[];
}

export interface Adjudication {
  readonly rootId: string;
  readonly label: string;
  readonly verdict: Verdict;
  /** The claim that authorized it, when one did. */
  readonly claim?: IntentClaim;
  /** One sentence a human or agent can act on without reading the diff. */
  readonly because: string;
  readonly entry: DocketEntry;
}

export interface Adjudicated {
  readonly adjudications: readonly Adjudication[];

  /**
   * Claims that matched no root.
   *
   * Declared and did not happen. Easy to omit and worth surfacing: on a branch
   * that says it changes a token and does not, either the edit was lost or the
   * declaration is stale, and both are worth a sentence before merge.
   */
  readonly undelivered: readonly IntentClaim[];

  /** Worst verdict present. What CI reports. */
  readonly verdict: Verdict;
  readonly authorized: number;
  readonly needsReview: number;
  readonly violations: number;
}

export function adjudicate(
  docket: Docket,
  intent: Intent,
  policy: Policy = {},
): Adjudicated {
  const claimed = new Map(intent.claims.map((claim) => [claim.root, claim]));
  const matched = new Set<string>();
  const adjudications: Adjudication[] = [];

  for (const entry of docket.entries) {
    const claim = claimed.get(entry.rootId);
    if (claim) matched.add(entry.rootId);

    adjudications.push(adjudicateEntry(entry, claim, policy));
  }

  const undelivered = intent.claims.filter((claim) => !matched.has(claim.root));

  const counts = {
    authorized: adjudications.filter((a) => a.verdict === 'authorized').length,
    needsReview: adjudications.filter((a) => a.verdict === 'needs-review').length,
    violations: adjudications.filter((a) => a.verdict === 'violation').length,
  };

  return {
    adjudications,
    undelivered,
    verdict: worst(adjudications.map((a) => a.verdict)),
    ...counts,
  };
}

function adjudicateEntry(
  entry: DocketEntry,
  claim: IntentClaim | undefined,
  policy: Policy,
): Adjudication {
  const base = { rootId: entry.rootId, label: entry.label, entry };

  if (policy.alwaysAuthorized?.includes(entry.rootId)) {
    return {
      ...base,
      verdict: 'authorized',
      because: `\`${entry.rootId}\` is always authorized by project policy`,
    };
  }

  // Protection is checked before the claim, deliberately. A protected component
  // is protected *from* the person editing it — letting a branch authorize its
  // own change to one would make the setting decorative.
  const protectedHit = entry.components.find((component) =>
    policy.protectedComponents?.includes(component.name),
  );
  if (protectedHit && !claim) {
    return {
      ...base,
      verdict: 'violation',
      because:
        `\`${protectedHit.name}\` is a protected component and this change was not declared; ` +
        `${entry.kind} \`${entry.label}\` reached it across ${entry.subjectCount} subject(s)`,
    };
  }

  if (!claim) {
    const blocks = policy.blocking?.includes(entry.band) ?? false;
    return {
      ...base,
      verdict: blocks ? 'violation' : 'needs-review',
      because:
        `undeclared ${entry.kind} change: \`${entry.label}\` ` +
        `(${entry.band}/${entry.impact}) reached ${entry.subjectCount} subject(s)` +
        (entry.structureIntact ? '' : ', and reshaped the tree'),
    };
  }

  const exceeded = claim.maxSubjects !== undefined && entry.subjectCount > claim.maxSubjects;
  const unexpectedBand = claim.bands !== undefined && !claim.bands.includes(entry.band);
  const unexpectedImpact = claim.impact !== undefined && !claim.impact.includes(entry.impact);

  if (exceeded || unexpectedBand || unexpectedImpact) {
    const surprises = [
      exceeded ? `reached ${entry.subjectCount} subjects, declared at most ${claim.maxSubjects}` : null,
      unexpectedBand ? `banded ${entry.band}, declared ${claim.bands!.join('/')}` : null,
      unexpectedImpact ? `impact ${entry.impact}, declared ${claim.impact!.join('/')}` : null,
    ].filter((part): part is string => part !== null);

    return {
      ...base,
      verdict: 'needs-review',
      claim,
      // Not a violation: the change *is* the declared one. What failed is the
      // author's estimate of its blast radius, which is exactly the thing worth
      // showing them rather than blocking on.
      because: `declared (${claim.reason}), but ${surprises.join('; ')}`,
    };
  }

  return {
    ...base,
    verdict: 'authorized',
    claim,
    because: `declared: ${claim.reason}`,
  };
}

export interface ReportOptions {
  /**
   * Component → file, so a finding names an edit rather than an identifier.
   *
   * Optional, and the report degrades to component names without it — which is
   * what it said before this existed. Better a coarser sentence than a confident
   * wrong path.
   */
  readonly source?: SourceIndex;
}

/**
 * Render an adjudication as the thing a reviewer or agent actually reads.
 *
 * The shape follows what a report has to defeat. "Looks right, merge" happens
 * when the output is a picture, so this is a sentence with a cause in it. "100
 * changes? merge" happens when the output is a list as long as the change is
 * wide, so authorized roots collapse to a count and only findings get a line.
 *
 * Each finding carries three things in order: *what* changed, *where* it is, and
 * *which file* to open. Anything less and the reader has to go and find out —
 * which, at review time, means they will not.
 */
export function summarizeAdjudication(result: Adjudicated, options: ReportOptions = {}): string {
  const notable = result.adjudications.filter((a) => a.verdict !== 'authorized');

  const header =
    `${result.adjudications.length} root(s): ` +
    `${result.authorized} authorized, ${result.needsReview} to review, ` +
    `${result.violations} violation(s).`;

  const lines = notable
    .sort((a, b) => (a.verdict === 'violation' ? -1 : b.verdict === 'violation' ? 1 : 0))
    .flatMap((a) => {
      const roots = a.entry.components.filter((component) => component.role === 'root');

      const files = roots
        .map((component) => (options.source ? resolveSource(component.name, options.source) : null))
        .filter((resolution): resolution is NonNullable<typeof resolution> => resolution !== null)
        .map(formatSource);

      const named = roots.map((component) => component.name).join(', ');
      const head = `  [${a.verdict}] ${a.label}${named ? ` — ${named}` : ''}`;

      // Location comes from the deltas rather than the entry: a root spans
      // subjects, and "where" is only meaningful for a place. The first one is
      // representative and the count says how many others there are.
      const places = a.entry.places;
      const place =
        places.length === 0
          ? null
          : `      in ${places[0]}${places.length > 1 ? ` (+${places.length - 1} more places)` : ''}`;

      return [
        head,
        `      ${a.because}`,
        place,
        files.length > 0 ? `      ${files.join(' | ')}` : null,
      ].filter((line): line is string => line !== null);
    });

  const undelivered = result.undelivered.map(
    (claim) => `  [undelivered] ${claim.root} — declared (${claim.reason}) but nothing changed`,
  );

  return [header, ...lines, ...undelivered].join('\n');
}

function worst(verdicts: readonly Verdict[]): Verdict {
  if (verdicts.includes('violation')) return 'violation';
  if (verdicts.includes('needs-review')) return 'needs-review';
  if (verdicts.includes('authorized')) return 'authorized';
  return 'unchanged';
}
