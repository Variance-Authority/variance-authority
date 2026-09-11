import type { ComponentHash, Digest, ProfileId } from '@variance-authority/core/format';

/**
 * What a run is allowed to leave behind.
 *
 * One row per `(subject, component, band)` whose hash moved, plus the token
 * values the run resolved. Roughly a hundred bytes, written only on movement, so
 * a 300-subject run in which two components changed writes two rows.
 *
 * **Never a pixel, an image, a coordinate, a rect, or a pixel count.** That is not
 * squeamishness about size; it is a measurement. The first version of this package
 * accumulated `changedPixels` per subject and was killed inside an hour by a 1px
 * edit to `--va-space-3` that produced 4949 changed pixels, because the count is
 * dominated by how much page sits below the edit. A pixel count measures
 * *displacement*, not magnitude, and it is machine-bound on top of that — so
 * summing one across runs both answers the wrong question and compares two
 * machines while doing it (epitaphs, ADR-0011).
 *
 * A content hash has neither problem. It moves when the component's own code moves
 * (ADR-0018) and it means the same thing on every machine.
 */

/**
 * The band a hash belongs to.
 *
 * Not `core`'s `Band`. Core's bands (`a11y` / `geometry` / `token` / `content` /
 * `texture`) classify a delta by how *often* that kind of thing changes, to
 * decide how loudly to report it. These name the three hashes `hashComponents` produces, which is a different
 * axis entirely: what part of a component's content was hashed. Importing both
 * into one file is a compile error rather than a silent mix-up, which is the point
 * of leaving the names as the specs wrote them.
 */
export type Band = 'structure' | 'style' | 'geometry';

/** In the order they are reported. Structure first: it is the portable one. */
export const BANDS: readonly Band[] = ['structure', 'style', 'geometry'];

export interface Observation {
  readonly project: string;
  readonly subject: string;
  readonly component: string;
  readonly band: Band;
  readonly hash: Digest;

  /**
   * Which tier observed it.
   *
   * Recorded on every row, including `structure`, even though structure is the
   * one band that compares across tiers. Recording it costs a few bytes; omitting
   * it makes "which tier saw this" unanswerable after the fact, and the whole
   * reason `style` and `geometry` are profile-scoped is that a question asked
   * across tiers returns a change caused by the CI configuration rather than by an
   * edit (measured: style agrees across profiles on 0 of 107 component
   * boundaries).
   */
  readonly profile: ProfileId;

  readonly commit: string;
  readonly run: string;
  readonly at: string;

  /**
   * Whether this row arrived already approved.
   *
   * Almost always `false`, and that is not a defect: a run writes its rows when
   * it observes them, and approval happens afterwards, in `variance accept` or in
   * a review surface. The flag is only true for a caller that submits a decision
   * it has already made.
   *
   * So it is provenance about the write, never the answer to *was this change
   * approved*. That question is answered by joining the approvals table, which is
   * what `churnFrom` and `journeyFrom` do; a reader that filtered on this flag
   * instead would report a component that changed forty times as never having
   * changed, and be believed.
   */
  readonly accepted: boolean;

  /** Repository-relative, when the component's declaring file is known. */
  readonly file?: string;
}

export interface TokenValue {
  readonly project: string;
  readonly token: string;
  /** The resolved value as a string — `12px`, `#0b6bcb`. Never a pixel measurement. */
  readonly value: string;
  readonly commit: string;
  readonly at: string;
}

/**
 * That a run happened, whether or not anything moved.
 *
 * The unglamorous row that makes every rate honest. Churn is a fraction, and a
 * store that only writes when something changes has no denominator — it reports
 * "changed in 4 of 4 runs" for a component that changed in 4 of 40. Recording the
 * quiet run costs one row per run and is the difference between a rate and a
 * count dressed up as one.
 *
 * A run that captured under two profiles records one `RunRecord` per profile, so
 * that a band no profile could observe is never counted as a quiet run for that
 * band. The run *id* is shared, and the arithmetic counts distinct ids where the
 * question is profile-independent.
 */
export interface RunRecord {
  readonly project: string;
  readonly run: string;
  readonly commit: string;
  readonly profile: ProfileId;
  readonly at: string;

  /**
   * Whether this run read **every** subject twice, or only the ones it was going
   * to review anyway.
   *
   * The denominator for flakiness, and the reason it is a property of the run
   * rather than of a finding. A normal run asks *does this subject read the same
   * way twice* only after the comparison already called it `changed`, so a
   * subject that was green in eighteen runs was never asked — and "unstable in 2
   * of 20" would divide by a denominator that never existed. `variance run
   * --flakes` sweeps, and a sweep is the only run whose *silence* about a subject
   * is evidence of anything.
   *
   * Optional so that absent stays distinguishable from false. A run recorded
   * before this field existed never said what it examined, and reading that as
   * "did not sweep" would make an old history look like a suite nobody ever
   * swept — which is a claim, and a wrong one.
   */
  readonly swept?: boolean;
}

/**
 * Everything a row needs that a `ComponentHash` does not carry.
 *
 * Extends `RunRecord` so one object serves both the rows and the run's own
 * registration — two objects would let them disagree about which commit a run was
 * on, and a run whose rows claim a different commit than the run does is a
 * history nobody can query by lineage.
 */
export interface RunContext extends RunRecord {
  readonly subject: string;

  /**
   * Whether this run's changes were approved, applied to every row produced here.
   *
   * Run-level rather than a per-component map on purpose. A map with a default
   * would record an unreviewed component as approved the moment somebody forgot a
   * key, and drift sums approved changes — the failure would be silent and would
   * inflate every total. A run whose components were decided separately calls this
   * twice with the two halves of the hash list, which is visible in the calling
   * code.
   */
  readonly accepted: boolean;

  /**
   * Component name → repository-relative file, for the rows it covers.
   *
   * Names absent from the map produce rows with no `file`, which is correct:
   * `resolveSource` reports an ambiguous name rather than picking a file, and a
   * row that guessed would send an agent to edit the wrong one with full
   * confidence.
   */
  readonly files?: Readonly<Record<string, string>>;
}

/**
 * Turn one subject's component hashes into rows worth writing.
 *
 * Two rules do all the work here.
 *
 * **A band the profile could not observe produces no row at all.** `geometry` is
 * absent under `jsdom`, and absent is not empty (ADR-0002): an empty geometry
 * digest would compare equal between a run that saw no movement and a run that
 * could not see movement, which is the false `unchanged` this system exists to
 * refuse. No row means the question "did geometry move" is answered by "nothing
 * observed it", not by "it did not".
 *
 * **A hash is compared against the last recorded row for the same scope, and the
 * scope differs by band.** `structure` is portable across tiers, so the previous
 * row from *any* profile is a valid comparison; re-recording structure once per
 * tier would double every structural rate in the store. `style` and `geometry` are
 * not portable, so they compare only against a previous row from the same profile
 * — a `chromium` style hash checked against a `jsdom` one differs on essentially
 * every component (0 of 107 agree) and would write the entire component list on
 * every run.
 *
 * `previous` empty means everything is recorded, which is what a first run must
 * do: a component observed for the first time is a change from nothing, and a
 * store that skipped it could never answer when the component arrived.
 */
export function observationsFrom(
  hashes: readonly ComponentHash[],
  run: RunContext,
  previous: readonly Observation[] = [],
): readonly Observation[] {
  const known = new Map<string, { readonly hash: Digest; readonly at: string }>();

  for (const row of previous) {
    if (row.project !== run.project || row.subject !== run.subject) {
      // Loud, because the quiet version is the worst failure available here. A
      // component's hash is scoped to the subject it was hashed in; a previous row
      // from another subject that happened to match would suppress a real change,
      // and a suppressed change is a change nobody can ever ask about again.
      throw new Error(
        `previous rows must belong to ${run.project}/${run.subject}; ` +
          `received one for ${row.project}/${row.subject}`,
      );
    }
    // Newest wins, and it has to be decided here rather than left to the order
    // the rows arrived in. `structure` is scoped without a profile, so a store
    // holding a jsdom row and a chromium row for one component hands back two
    // rows that land on one key — and if the older one wins, this run records a
    // change back to a hash the project already moved away from. The comparison
    // is on the instant rather than on arrival order because a bulk read is
    // grouped per scope and no ordering between scopes is promised.
    const key = scopeKey(row.component, row.band, row.profile);
    const held = known.get(key);
    if (held === undefined || Date.parse(row.at) >= Date.parse(held.at)) {
      known.set(key, { hash: row.hash, at: row.at });
    }
  }

  const rows: Observation[] = [];

  for (const hash of hashes) {
    const file = run.files?.[hash.component];

    for (const band of BANDS) {
      const digest = digestOf(hash, band);
      if (digest === undefined) continue;

      const key = scopeKey(hash.component, band, run.profile);
      if (known.get(key)?.hash === digest) continue;

      rows.push({
        project: run.project,
        subject: run.subject,
        component: hash.component,
        band,
        hash: digest,
        profile: run.profile,
        commit: run.commit,
        run: run.run,
        at: run.at,
        accepted: run.accepted,
        ...(file !== undefined ? { file } : {}),
      });
    }
  }

  return rows;
}

/**
 * The key under which two hashes of one band may be compared.
 *
 * `instances` is deliberately not part of a row and not part of this key. A
 * component's `structure` digest already covers the ordered list of its instance
 * hashes, so a change in instance count moves it; a separate count column could
 * therefore never disagree with the hash, and a column that can only ever restate
 * another one is a column somebody will eventually query instead.
 */
function scopeKey(component: string, band: Band, profile: ProfileId): string {
  return band === 'structure'
    ? `structure\u0000${component}`
    : `${band}\u0000${profile}\u0000${component}`;
}

function digestOf(hash: ComponentHash, band: Band): Digest | undefined {
  switch (band) {
    case 'structure':
      return hash.structure;
    case 'style':
      return hash.style;
    case 'geometry':
      return hash.geometry;
  }
}
