/**
 * The whole database, as statements rather than as a script.
 *
 * D1's `exec` accepts multiple statements only when each one is on a single
 * line, which a trigger body cannot be, and splitting a script on `;` would cut
 * every trigger in half — the semicolons inside `BEGIN … END` are part of the
 * statement. So the schema is a list from the start, applied with `batch`, and
 * there is no parser here that could get it wrong.
 *
 * ## Two halves, one file
 *
 * The first half is this spec's own: baselines, the render cache, builds,
 * per-subject verdicts, and decisions. The second half is
 * [spec 0002](../../../docs/specs/0002-history-store.md)'s, and it is a
 * deliberate transcription of
 * [`server/backend-sqlite.ts`](../../server/src/backend-sqlite.ts) — the same
 * columns, the same indexes, and above all the same append-only triggers with
 * the same wording. Two backends that disagree about what a row is are two
 * different records wearing one name, and the trigger messages are the part an
 * operator actually reads, so they are copied rather than paraphrased.
 *
 * ## Two rules the tables enforce that no code has to remember
 *
 * **The identity partition is the primary key.** `baselines` is keyed by
 * `(project, identity_digest, subject, label)`. A baseline written by one
 * machine is not reachable as this machine's, because it is a different row —
 * the same argument [ADR-0011](../../../docs/context/adr/0011-durable-and-ephemeral-retention.md)
 * makes about the directory store's layout, and with the same absence of a check
 * somebody could forget to write.
 *
 * **Instants are stored twice.** The original text, and its parsed
 * milliseconds; every window is compared on the number. ISO-8601 sorts lexically
 * only while every timestamp shares one offset, and a store fed by CI jobs in
 * two regions does not.
 */

import type { D1Like } from './bindings.js';

/** Bumped when the stored shape changes in a way an older build would misread. */
export const SCHEMA_VERSION = 5;

/** The version `INITIAL` alone leaves a database at. Frozen: it is deployed. */
const INITIAL_VERSION = 3;

/**
 * What a run kept, and what a review decided, in order — as this database first
 * shipped.
 *
 * Order matters: tables before their indexes, and both before the triggers that
 * reference them.
 *
 * Frozen at {@link INITIAL_VERSION}. Everything since is a step in
 * {@link MIGRATIONS}, for the reason given there; a new table added here would
 * reach a fresh deployment and no existing one.
 */
export const INITIAL: readonly string[] = [
  `CREATE TABLE schema_version (
     version INTEGER NOT NULL
   ) STRICT`,
  `INSERT INTO schema_version (version) VALUES (${INITIAL_VERSION})`,

  // ---------------------------------------------------------------- baselines

  // `label` is NOT NULL with '' standing for absent, and an empty label is
  // refused at the door (see `store.ts`). SQLite permits NULL in the columns of
  // an ordinary PRIMARY KEY, which would make two unlabelled baselines for one
  // subject two rows that never collide — the uniqueness that stops a second
  // `put` overwriting the first would silently not exist.
  `CREATE TABLE baselines (
     project         TEXT NOT NULL,
     identity_digest TEXT NOT NULL,
     subject         TEXT NOT NULL,
     label           TEXT NOT NULL,
     identity        TEXT NOT NULL,
     document_digest TEXT NOT NULL,
     width           INTEGER NOT NULL,
     height          INTEGER NOT NULL,
     missing_fonts   TEXT NOT NULL,
     object_key      TEXT NOT NULL,
     at              TEXT NOT NULL,
     at_ms           INTEGER NOT NULL,
     PRIMARY KEY (project, identity_digest, subject, label)
   ) STRICT`,

  // The sibling scan. `find` must be able to say "we have seen this, on a
  // machine you are not", which is a lookup across identities for one key —
  // a different leading column from the primary key's, so it needs its own index
  // or every wrong-machine run becomes a full table scan.
  `CREATE INDEX baselines_across_identities ON baselines (project, subject, label, at_ms DESC)`,

  `CREATE TABLE render_cache (
     project         TEXT NOT NULL,
     identity_digest TEXT NOT NULL,
     document_digest TEXT NOT NULL,
     identity        TEXT NOT NULL,
     width           INTEGER NOT NULL,
     height          INTEGER NOT NULL,
     missing_fonts   TEXT NOT NULL,
     object_key      TEXT NOT NULL,
     at_ms           INTEGER NOT NULL,
     PRIMARY KEY (project, identity_digest, document_digest)
   ) STRICT`,

  // ------------------------------------------------------------------- review

  // `says_not_observed` is a flag about the *writer*, not about the run: `1`
  // means the report stated its coverage list, `0` means it never said. A report
  // that skipped nothing and a report that declined to say are different claims,
  // and collapsing them lets "nothing to review" be printed on the authority of a
  // writer that never looked (`report`'s `notObserved`).
  `CREATE TABLE builds (
     project           TEXT NOT NULL,
     build             TEXT NOT NULL,
     "commit"          TEXT NOT NULL,
     branch            TEXT,
     intent            TEXT,
     at                TEXT NOT NULL,
     at_ms             INTEGER NOT NULL,
     identity          TEXT NOT NULL,
     identity_digest   TEXT NOT NULL,
     retention         TEXT NOT NULL,
     run_version       INTEGER NOT NULL,
     says_not_observed INTEGER NOT NULL,
     PRIMARY KEY (project, build)
   ) STRICT`,
  `CREATE INDEX builds_recent ON builds (project, at_ms DESC)`,

  // No `label` column, and that is the report's shape rather than an omission:
  // `ObservationRecord` carries a subject and no label, so a build cannot
  // distinguish two images of one subject. `baselines` can, because `put` can.
  // The day a run reports labels this table grows a column and the promotion path
  // stops hard-coding ''.
  // The `candidate_*` columns are what makes approval a promotion rather than a
  // recording. A baseline is an image *plus* the document digest it was painted
  // from and the identity that painted it — the sidecar the cheap `describe` path
  // answers from. A review surface holding only pixels could not write one, so it
  // would have to re-render to approve, and a surface that can render can record
  // something nobody looked at. They are nullable because a build may carry a
  // verdict for a subject whose image it did not keep; approving that subject is
  // refused rather than invented.
  `CREATE TABLE build_subjects (
     project        TEXT NOT NULL,
     build          TEXT NOT NULL,
     subject        TEXT NOT NULL,
     verdict        TEXT NOT NULL,
     because        TEXT NOT NULL,
     changed_pixels INTEGER NOT NULL,
     regions        TEXT NOT NULL,
     truncated      TEXT,
     missing_fonts  TEXT,
     findings       TEXT,
     before_key     TEXT,
     after_key      TEXT,
     diff_key       TEXT,
     candidate_document_digest TEXT,
     candidate_width           INTEGER,
     candidate_height          INTEGER,
     candidate_missing_fonts   TEXT,
     PRIMARY KEY (project, build, subject)
   ) STRICT`,

  `CREATE TABLE build_not_observed (
     project TEXT NOT NULL,
     build   TEXT NOT NULL,
     subject TEXT NOT NULL,
     kind    TEXT NOT NULL,
     because TEXT NOT NULL,
     PRIMARY KEY (project, build, subject)
   ) STRICT`,

  // Append-only, like everything else that records a fact about a moment. A
  // reviewer who approves and then changes their mind leaves two rows; the second
  // decision is only reviewable because the first one is still there.
  `CREATE TABLE decisions (
     seq       INTEGER PRIMARY KEY AUTOINCREMENT,
     project   TEXT NOT NULL,
     build     TEXT NOT NULL,
     subject   TEXT NOT NULL,
     decision  TEXT NOT NULL,
     decided_by TEXT NOT NULL,
     note      TEXT,
     at        TEXT NOT NULL,
     at_ms     INTEGER NOT NULL
   ) STRICT`,
  `CREATE INDEX decisions_latest ON decisions (project, build, subject, seq DESC)`,

  `CREATE TRIGGER decisions_are_append_only BEFORE UPDATE ON decisions BEGIN
     SELECT RAISE(ABORT, 'decisions are append-only: a rewritten decision erases the review it replaced, and the earlier one is what makes the later one reviewable');
   END`,
  `CREATE TRIGGER decisions_are_permanent BEFORE DELETE ON decisions BEGIN
     SELECT RAISE(ABORT, 'decisions are append-only: a deleted approval leaves a promoted baseline nobody can attribute to anyone');
   END`,

  // ------------------------------------------------------------------ history
  // Transcribed from `server/backend-sqlite.ts`. Same columns, same indexes,
  // same trigger wording — see the note at the top of this file.

  `CREATE TABLE runs (
     project  TEXT NOT NULL,
     run      TEXT NOT NULL,
     "commit" TEXT NOT NULL,
     profile  TEXT NOT NULL,
     at       TEXT NOT NULL,
     at_ms    INTEGER NOT NULL,
     -- Nullable, and the null is load-bearing: a run that never said what it
     -- examined must not be read as one that examined nothing, because that
     -- number becomes the denominator of a flake rate.
     swept    INTEGER
   ) STRICT`,
  `CREATE UNIQUE INDEX runs_identity ON runs (project, run, profile)`,
  `CREATE INDEX runs_window ON runs (project, at_ms)`,

  `CREATE TABLE observations (
     project   TEXT NOT NULL,
     subject   TEXT NOT NULL,
     component TEXT NOT NULL,
     band      TEXT NOT NULL,
     hash      TEXT NOT NULL,
     profile   TEXT NOT NULL,
     "commit"  TEXT NOT NULL,
     run       TEXT NOT NULL,
     at        TEXT NOT NULL,
     at_ms     INTEGER NOT NULL,
     accepted  INTEGER NOT NULL,
     file      TEXT
   ) STRICT`,
  `CREATE INDEX observations_area      ON observations (project, subject, component, band, at_ms)`,
  `CREATE INDEX observations_component ON observations (project, component, at_ms)`,
  `CREATE INDEX observations_reach     ON observations (project, component, subject, at_ms)`,

  `CREATE TABLE token_values (
     project  TEXT NOT NULL,
     token    TEXT NOT NULL,
     value    TEXT NOT NULL,
     "commit" TEXT NOT NULL,
     at       TEXT NOT NULL,
     at_ms    INTEGER NOT NULL,
     run      TEXT NOT NULL,
     accepted INTEGER NOT NULL
   ) STRICT`,
  `CREATE INDEX token_values_journey ON token_values (project, token, at_ms)`,

  `CREATE TABLE instabilities (
     project     TEXT NOT NULL,
     subject     TEXT NOT NULL,
     component   TEXT,
     band        TEXT,
     profile     TEXT NOT NULL,
     "commit"    TEXT NOT NULL,
     run         TEXT NOT NULL,
     at          TEXT NOT NULL,
     at_ms       INTEGER NOT NULL,
     absorbed_by TEXT
   ) STRICT`,
  `CREATE INDEX instabilities_subject ON instabilities (project, subject, at_ms)`,

  `CREATE TABLE approvals (
     project  TEXT NOT NULL,
     subject  TEXT NOT NULL,
     run      TEXT NOT NULL,
     at       TEXT NOT NULL,
     at_ms    INTEGER NOT NULL,
     approver TEXT
   ) STRICT`,
  `CREATE UNIQUE INDEX approvals_identity ON approvals (project, subject, run)`,
  `CREATE INDEX approvals_window ON approvals (project, at_ms)`,

  `CREATE TRIGGER runs_are_append_only BEFORE UPDATE ON runs BEGIN
     SELECT RAISE(ABORT, 'runs are append-only: a recorded run is a fact about a moment, and rewriting one changes a denominator somebody already read');
   END`,
  `CREATE TRIGGER runs_are_permanent BEFORE DELETE ON runs BEGIN
     SELECT RAISE(ABORT, 'runs are append-only: deleting a quiet run inflates every rate computed over its window');
   END`,
  `CREATE TRIGGER observations_are_append_only BEFORE UPDATE ON observations BEGIN
     SELECT RAISE(ABORT, 'observations are append-only: two hashes for one key are two rows, and an update is the merge this store exists to avoid');
   END`,
  `CREATE TRIGGER observations_are_permanent BEFORE DELETE ON observations BEGIN
     SELECT RAISE(ABORT, 'observations are append-only: a deleted change is a change nobody can ever ask about again');
   END`,
  `CREATE TRIGGER token_values_are_append_only BEFORE UPDATE ON token_values BEGIN
     SELECT RAISE(ABORT, 'token values are append-only: a rewritten value breaks the journey that was the reason for keeping it');
   END`,
  `CREATE TRIGGER token_values_are_permanent BEFORE DELETE ON token_values BEGIN
     SELECT RAISE(ABORT, 'token values are append-only: a removed step turns a drift total into a lower bound with nothing saying so');
   END`,
  `CREATE TRIGGER instabilities_are_append_only BEFORE UPDATE ON instabilities BEGIN
     SELECT RAISE(ABORT, 'instabilities are append-only: an occurrence is a fact about one run, and rewriting one changes a rate somebody already acted on');
   END`,
  `CREATE TRIGGER instabilities_are_permanent BEFORE DELETE ON instabilities BEGIN
     SELECT RAISE(ABORT, 'instabilities are append-only: deleting an occurrence is how a flake that was fixed becomes a flake that never happened');
   END`,
  `CREATE TRIGGER approvals_are_append_only BEFORE UPDATE ON approvals BEGIN
     SELECT RAISE(ABORT, 'approvals are append-only: a rewritten acceptance changes what a reviewer agreed to after they agreed to it');
   END`,
  `CREATE TRIGGER approvals_are_permanent BEFORE DELETE ON approvals BEGIN
     SELECT RAISE(ABORT, 'approvals are append-only: a deleted acceptance turns a reviewed change back into an unreviewed one, and every drift total over it drops');
   END`,
];


/**
 * One entry per version after {@link INITIAL_VERSION}, in order.
 *
 * A database that is already deployed cannot be given a new table by editing the
 * statements that created it — `wrangler d1 migrations apply` tracks which files
 * it has run, and a rewritten `0001` is a file it will never run again. So the
 * initial set is frozen at the version it shipped at and every later shape is a
 * step, generated into its own `.sql` beside it.
 *
 * Each step ends by writing its own version, so a database is never at a version
 * whose shape it does not have — and a fresh database applying the initial set
 * and every step in order arrives at exactly the same place as one that was
 * deployed three versions ago.
 *
 * Additive only. A step that dropped or rewrote a column would be asking an
 * append-only store to forget something, which is the one thing every trigger in
 * this file exists to refuse.
 */
export const MIGRATIONS: readonly (readonly string[])[] = [
  // 3 → 4: why a baseline in this database is what it is.
  [
    // Why a baseline in this database is what it is. One row per **approval**, and
    // the columns are copies rather than a join on purpose: `builds` and
    // `build_subjects` expire under `sweep`, and the explanation of a baseline has
    // to last exactly as long as the baseline, which is forever. A view over those
    // tables would answer correctly right up until the retention window passed and
    // then answer "nothing was ever explained" — the one failure this whole
    // subsystem exists to refuse. It is the same trade the git-LFS half makes by
    // writing the explanation into the commit message instead of a sidecar.
    `CREATE TABLE changelog (
       seq            INTEGER PRIMARY KEY AUTOINCREMENT,
       project        TEXT NOT NULL,
       build          TEXT NOT NULL,
       subject        TEXT NOT NULL,
       "commit"       TEXT NOT NULL,
       intent         TEXT,
       decided_by     TEXT NOT NULL,
       note           TEXT,
       -- The region list the build reported, frozen. Shapes are grouped when
       -- somebody reads: approval here is per subject, so there is no batch at
       -- write time to cluster, and a shape approved across three sessions should
       -- still read as one change.
       regions        TEXT NOT NULL,
       at             TEXT NOT NULL,
       at_ms          INTEGER NOT NULL
     ) STRICT`,
    `CREATE INDEX changelog_recent ON changelog (project, at_ms DESC)`,
    `CREATE INDEX changelog_subject ON changelog (project, subject, at_ms DESC)`,

    `CREATE TRIGGER changelog_is_append_only BEFORE UPDATE ON changelog BEGIN
       SELECT RAISE(ABORT, 'the changelog is append-only: an edited explanation is an explanation of a baseline that was promoted for a different reason');
     END`,
    `CREATE TRIGGER changelog_is_permanent BEFORE DELETE ON changelog BEGIN
       SELECT RAISE(ABORT, 'the changelog is append-only: a deleted entry leaves a baseline nobody can account for, which is the state this table exists to end');
     END`,
    `UPDATE schema_version SET version = 4`,
  ],
  // 4 → 5: browser accessibility evidence is verdict-bearing baseline state.
  [
    `ALTER TABLE baselines ADD COLUMN accessibility TEXT`,
    `ALTER TABLE build_subjects ADD COLUMN signals TEXT`,
    `ALTER TABLE build_subjects ADD COLUMN candidate_accessibility TEXT`,
    `UPDATE schema_version SET version = 5`,
  ],
];

/**
 * Every statement, in order — the initial set followed by each step.
 *
 * This is what a fresh database gets, and what the tests run against. The split
 * above is about *deployment*; nothing downstream of here needs to know a
 * database was built in more than one sitting.
 */
export const SCHEMA: readonly string[] = [...INITIAL, ...MIGRATIONS.flat()];

/**
 * Create the schema, once, in one batch.
 *
 * Exported for the operator to call from `wrangler d1 execute` equivalents or
 * from a one-off route they mount themselves — **not** called by the Worker on
 * request. A handler that migrates on first use is a handler that migrates
 * concurrently under load, and D1 has no advisory lock to serialize it with.
 *
 * Applying it twice fails on the first `CREATE TABLE`, which is the intended
 * behaviour: an operator who cannot tell whether the schema is applied should get
 * an error rather than a silent no-op that might have half-applied.
 */
export async function applySchema(db: D1Like): Promise<void> {
  await db.batch(SCHEMA.map((statement) => db.prepare(statement)));
}
