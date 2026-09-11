/**
 * The shape of a corpus row, and the per-profile clauses that qualify it.
 *
 * Separate from `corpus.ts` because a reader arrives here for one of two
 * unrelated reasons: to *write* a case, which needs the fields and the argument
 * for each one, or to *score* one, which needs the resolution rules in
 * `corpus.ts` and none of this. Keeping them apart also lets the three
 * `corpus-*.ts` case files import the row type without importing the table they
 * are part of, which would be a cycle.
 */

import type { Band } from '@variance-authority/core/compare';
import type { ProfileId } from '@variance-authority/core/format';
import type { SubjectId } from './subjects.js';
import type { VariantId } from './variants.js';

/** `texture` is excluded: it is raster residue, and nothing here reaches raster. */
export type ExpectedBand = Exclude<Band, 'texture'>;

export type Verdict = 'hash-stable' | 'hash-changed';

/**
 * A different, equally correct answer under one profile (ADR-0008 state 2).
 *
 * Replaces the default clause wholesale rather than patching it, so a reader
 * never has to compose two partial expectations to know what is being claimed.
 */
export interface ProfileExpectation {
  readonly expect: Verdict;
  readonly band?: ExpectedBand;
  readonly roots?: number;
  readonly blames?: string;
  /**
   * The argument for the divergence — mandatory, because a divergence with no
   * stated reason is indistinguishable from a mistake, and the whole point of
   * declaring the legitimate ones is to leave the illegitimate ones exposed.
   */
  readonly because: string;
}

/**
 * The profile is structurally unable to decide this case (ADR-0008 state 1).
 *
 * Excluded from that profile's score in both directions. A profile is not
 * credited for an answer it reached by not looking, and not charged for a
 * limitation its `ObservationProfile` already declares.
 */
export interface Undecidable {
  readonly undecidable: string;
}

export type ProfileClause = ProfileExpectation | Undecidable;

export interface CorpusCase {
  readonly id: string;
  /** Which component fixture. */
  readonly subject: SubjectId;
  readonly baseVariant: VariantId;
  readonly perturbedVariant: VariantId;
  /**
   * The answer under any profile that has not said otherwise — not "the `jsdom`
   * answer". A profile-specific answer goes in {@link CorpusCase.byProfile}.
   */
  readonly expect: Verdict;
  /** Set when `hash-changed`. */
  readonly band?: ExpectedBand;
  /** Why this is the ground truth — the argument, not a description. */
  readonly rationale: string;
  /** Which ADR or spec section this case defends. */
  readonly spec: string;

  /**
   * Expected number of docket roots (spec §6.2). Almost always 1: "one root plus
   * counted collateral" is claim P2, and a differ that reports N roots for one
   * cause has failed even with a correct hash.
   */
  readonly roots?: number;

  /**
   * **Who the report blames** — the name it puts in front of a reviewer.
   *
   * `roots` counts how many explanations a change produces and says nothing
   * about whether any of them is the right one. That gap is not theoretical: a
   * `prop` root labelled `Hero → Button` was attributing to `Button` in the
   * per-component roles the report actually prints, so a reviewer opened a file
   * nobody had edited — and every case here passed throughout, because a count
   * of one is a count of one whichever component it names.
   *
   * For a `component` or `prop` root this is the component the entry marks as
   * the root, which for a `prop` root is the **provider** and not the component
   * the pixels moved in. For a `token` root no component is blamed — the token
   * is — so this carries the entry's label instead.
   */
  readonly blames?: string;
  /**
   * Lower bound on collateral nodes. A bound rather than an exact count because
   * the exact number depends on the computed-style allowlist, which is versioned
   * and expected to move; the bound is what distinguishes narrow fan-out from
   * wide, which is the thing being measured.
   */
  readonly minCollateral?: number;
  /**
   * Set when the ground truth is genuinely disputable. A harness MUST NOT count
   * contested cases toward a pass rate without saying so — they are discussion
   * items, and reporting them as failures or as successes both hide the fact that
   * nobody has decided.
   */
  readonly contested?: string;

  /**
   * Per-profile overrides (ADR-0008).
   *
   * Absent for a profile means the default {@link CorpusCase.expect} holds there.
   * Present it is either an {@link Undecidable} — exclude the case from that
   * profile's score — or a {@link ProfileExpectation}, meaning the profiles
   * legitimately disagree and both answers are correct.
   *
   * Those two are not the same thing and are never collapsed: exclusion says the
   * profile cannot see the case, divergence says it sees it differently. A third
   * situation — the profiles disagreeing when nothing here says they should — is
   * not declarable at all. It is the observation P4 exists to make.
   */
  readonly byProfile?: Readonly<Partial<Record<ProfileId, ProfileClause>>>;
}
