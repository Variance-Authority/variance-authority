/**
 * The manifest of expectations — the corpus's actual product.
 *
 * M0's exit criterion is *"is normalization quality achievable?"*, and its targets
 * are numbers: `<2% false semantic misses on no-op refactors`, `0 baseline breakage
 * across rebase` (spec §10). A number needs a denominator, and a denominator needs
 * a set of renders whose correct answer was fixed **before** anyone looked at what
 * the normalizer produced. That is this table. Written after the fact it would
 * measure nothing: any ruleset scores 100% against expectations derived from its
 * own output.
 *
 * So each row states a ground truth and, in `rationale`, the argument for it. The
 * rationale is not documentation. It is the thing a future reader disputes when
 * they think a case is wrong — and some of these *are* arguable, which is why
 * `contested` exists rather than a confident answer. A corpus that never admits
 * uncertainty is a corpus that has been fitted to an implementation.
 *
 * What this table does not contain: expected hashes. Hashes are the normalizer's
 * output and belong to whatever measures it. This file only says whether two
 * renders should agree.
 *
 * The rows themselves are in three sibling files — `corpus-stable.ts`,
 * `corpus-restyled.ts` and `corpus-restructured.ts` — divided along the seam the
 * banner comments below already drew. This file is what assembles them and what
 * resolves a row against a profile; the division is a reading convenience and
 * carries no meaning of its own, which is why {@link CORPUS} is the only order
 * anything is scored in.
 */

import type { ProfileId } from '@variance-authority/core/format';
import type {
  CorpusCase,
  ExpectedBand,
  ProfileClause,
  Undecidable,
  Verdict,
} from './corpus-case.js';
import { RESTRUCTURED_CASES } from './corpus-restructured.js';
import { RESTYLED_CASES } from './corpus-restyled.js';
import { STABLE_CASES } from './corpus-stable.js';

export type {
  CorpusCase,
  ExpectedBand,
  ProfileClause,
  ProfileExpectation,
  Undecidable,
  Verdict,
} from './corpus-case.js';

export const CORPUS: readonly CorpusCase[] = [
  // ===========================================================================
  // P1 — no-op refactors. Expected: the hash does not move.
  // ===========================================================================
  ...STABLE_CASES,

  // ===========================================================================
  // Real changes. Expected: the hash moves, with a declared band.
  //
  // These are the false-negative guard. A normalizer that deleted everything
  // would score a perfect run on the section above and fail every case below,
  // which is the only reason the section above means anything.
  // ===========================================================================
  ...RESTYLED_CASES,
  ...RESTRUCTURED_CASES,
];

/**
 * Cases whose ground truth is settled *for at least one profile*.
 *
 * Not the same as "scorable": a settled case can still be undecidable under a
 * given profile. Use {@link scorableFor} to get a profile's denominator, never
 * this list's length.
 */
export const SETTLED_CORPUS: readonly CorpusCase[] = CORPUS.filter((c) => c.contested === undefined);

/** Cases with disputed ground truth. Report them; do not score them silently. */
export const CONTESTED_CORPUS: readonly CorpusCase[] = CORPUS.filter((c) => c.contested !== undefined);

/**
 * What a given profile is expected to observe for a case (ADR-0008).
 *
 * Three outcomes, and the harness must handle all three differently. Folding
 * `undecidable` into either a pass or a miss is the specific dishonesty the
 * per-profile mechanism exists to prevent.
 */
export type Expectation =
  | {
      readonly kind: 'scorable';
      readonly expect: Verdict;
      readonly band?: ExpectedBand;
      readonly roots?: number;
      readonly blames?: string;
      /** True when this profile's answer was declared separately from the default. */
      readonly perProfile: boolean;
      /** The per-profile argument, when there is one. */
      readonly because?: string;
    }
  | { readonly kind: 'undecidable'; readonly reason: string }
  | { readonly kind: 'contested'; readonly reason: string };

function isUndecidable(clause: ProfileClause): clause is Undecidable {
  return 'undecidable' in clause;
}

/**
 * Resolve a case against a profile.
 *
 * Order is fixed: `contested` outranks everything, because a case nobody has
 * decided cannot be scored under any profile — a per-profile clause on a
 * contested case would be answering a question that is still open. Then the
 * profile clause, then the default.
 */
export function expectationFor(corpusCase: CorpusCase, profile: ProfileId): Expectation {
  if (corpusCase.contested !== undefined) {
    return { kind: 'contested', reason: corpusCase.contested };
  }

  const clause = corpusCase.byProfile?.[profile];

  if (clause !== undefined && isUndecidable(clause)) {
    return { kind: 'undecidable', reason: clause.undecidable };
  }

  if (clause !== undefined) {
    return {
      kind: 'scorable',
      expect: clause.expect,
      ...(clause.band !== undefined ? { band: clause.band } : {}),
      ...(clause.roots !== undefined ? { roots: clause.roots } : {}),
      // A per-profile clause replaces the default wholesale, except for blame:
      // who is responsible for a change is not a thing two profiles can
      // legitimately disagree about. A clause that means to override it says so;
      // one that does not inherits, rather than silently dropping the assertion.
      ...(clause.blames !== undefined
        ? { blames: clause.blames }
        : corpusCase.blames !== undefined
          ? { blames: corpusCase.blames }
          : {}),
      perProfile: true,
      because: clause.because,
    };
  }

  return {
    kind: 'scorable',
    expect: corpusCase.expect,
    ...(corpusCase.band !== undefined ? { band: corpusCase.band } : {}),
    ...(corpusCase.roots !== undefined ? { roots: corpusCase.roots } : {}),
    ...(corpusCase.blames !== undefined ? { blames: corpusCase.blames } : {}),
    perProfile: false,
  };
}

/** A profile's denominator. Everything else is reported, never scored. */
export function scorableFor(profile: ProfileId): readonly CorpusCase[] {
  return CORPUS.filter((c) => expectationFor(c, profile).kind === 'scorable');
}

/** Cases a profile declares itself unable to decide. Reported with reasons. */
export function undecidableFor(profile: ProfileId): readonly CorpusCase[] {
  return CORPUS.filter((c) => expectationFor(c, profile).kind === 'undecidable');
}

/**
 * Cases on which two profiles may be compared to each other — claim P4's
 * denominator.
 *
 * Requires both to be scorable. A case one profile cannot see says nothing about
 * whether the two agree, and including it would let blindness look like consensus.
 */
export function comparableCases(a: ProfileId, b: ProfileId): readonly CorpusCase[] {
  return CORPUS.filter(
    (c) => expectationFor(c, a).kind === 'scorable' && expectationFor(c, b).kind === 'scorable',
  );
}

/**
 * True when the corpus declares that the two profiles reach *different verdicts*.
 *
 * A band-level divergence is not a verdict-level one: `prop-size/button` is
 * `hash-changed` under both profiles and differs only in band, so the two
 * verdicts must still match. Only a case listed here is allowed to disagree.
 */
export function declaresDivergence(corpusCase: CorpusCase, a: ProfileId, b: ProfileId): boolean {
  const left = expectationFor(corpusCase, a);
  const right = expectationFor(corpusCase, b);
  if (left.kind !== 'scorable' || right.kind !== 'scorable') return false;
  return left.expect !== right.expect;
}

export function casesFor(expect: CorpusCase['expect']): readonly CorpusCase[] {
  return CORPUS.filter((c) => c.expect === expect);
}

export interface CorpusSummary {
  readonly total: number;
  readonly stable: number;
  readonly changed: number;
  readonly geometry: number;
  readonly token: number;
  readonly contested: readonly string[];
}

/**
 * Shape of the corpus, for a harness to print beside its results.
 *
 * A pass rate is uninterpretable without it. "97% of cases passed" means nothing
 * if the reader cannot see that the failures were concentrated in the twenty cases
 * where the hash was supposed to *move* — which is the failure that matters, since
 * a normalizer that erases too much passes every stability case there is.
 */
export function corpusSummary(): CorpusSummary {
  return {
    total: CORPUS.length,
    stable: casesFor('hash-stable').length,
    changed: casesFor('hash-changed').length,
    geometry: CORPUS.filter((c) => c.band === 'geometry').length,
    token: CORPUS.filter((c) => c.band === 'token').length,
    contested: CONTESTED_CORPUS.map((c) => c.id),
  };
}
