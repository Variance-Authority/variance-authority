import type { DatabaseSync } from 'node:sqlite';
import { number } from './sqlite-rows.js';

/**
 * The stored shape, and the refusal to open a file that is not it.
 *
 * Separate from the connection because this is the one part of the store with a
 * version number attached: the DDL below and `prepareSchema` move together or the
 * store lies about what it is. Everything else in this package reads rows; this
 * module decides what a row is allowed to be in the first place.
 *
 * Everything here is append-only, and that is enforced by the database rather
 * than by the code above it. `UPDATE` and `DELETE` triggers abort. The reason is
 * the argument the whole store rests on: two branches observing different hashes
 * for one key are two rows, not a conflict, and the moment anything is allowed to
 * overwrite a row the store acquires the merge problem it was built to escape.
 *
 * Instants are stored twice — the original text, and its parsed milliseconds.
 * Windows are compared on the number. ISO-8601 sorts lexically only while every
 * timestamp shares one offset, and a store fed by CI jobs in two regions does
 * not; a lexical window drops the other region's rows, and a drift total that is
 * quietly too small is exactly the failure this package exists to prevent.
 */

/**
 * Bumped when the stored shape changes in a way an older build would misread.
 *
 * Kept in `PRAGMA user_version`, which is a single integer in the database header
 * — no table to query, no chance of reading rows before discovering the schema is
 * not the one expected.
 */
export const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE runs (
  project  TEXT NOT NULL,
  run      TEXT NOT NULL,
  "commit" TEXT NOT NULL,
  profile  TEXT NOT NULL,
  at       TEXT NOT NULL,
  at_ms    INTEGER NOT NULL,
  -- Nullable, and the null is load-bearing: a run recorded before this column
  -- existed never said what it examined, and reading that as "did not sweep"
  -- would make an old history look like a suite nobody ever swept.
  swept    INTEGER
) STRICT;

-- A run is identified by (project, run, profile) and registering it again is a
-- no-op. A run counted twice halves every rate derived from it, and a caller that
-- approves half its components separately legitimately writes twice.
CREATE UNIQUE INDEX runs_identity ON runs (project, run, profile);
CREATE INDEX runs_window ON runs (project, at_ms);

CREATE TABLE observations (
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
) STRICT;

-- Deliberately no unique constraint on the observed key. Two commits reporting
-- different hashes for one (subject, component, band) is the case the service
-- exists for; a uniqueness rule here would turn it into a write error or, worse,
-- an upsert that discards one branch's observation.
CREATE INDEX observations_area      ON observations (project, subject, component, band, at_ms);
CREATE INDEX observations_component ON observations (project, component, at_ms);
CREATE INDEX observations_reach     ON observations (project, component, subject, at_ms);

CREATE TABLE token_values (
  project  TEXT NOT NULL,
  token    TEXT NOT NULL,
  value    TEXT NOT NULL,
  "commit" TEXT NOT NULL,
  at       TEXT NOT NULL,
  at_ms    INTEGER NOT NULL,
  run      TEXT NOT NULL,
  accepted INTEGER NOT NULL
) STRICT;

CREATE INDEX token_values_journey ON token_values (project, token, at_ms);

-- One row per (subject, component, band) that read differently in a run, plus a
-- row with neither named when the readings could not be resolved. Unlike
-- observations there is no write-only-on-movement rule: an occurrence is an
-- event, it is rare, and every firing is what a rate counts.
CREATE TABLE instabilities (
  project     TEXT NOT NULL,
  subject     TEXT NOT NULL,
  -- Null rather than empty: a collector that supplied no snapshot proved the
  -- instability and gave nobody the means to name it, which is not the same as
  -- the disagreement belonging to no component.
  component   TEXT,
  band        TEXT,
  profile     TEXT NOT NULL,
  "commit"    TEXT NOT NULL,
  run         TEXT NOT NULL,
  at          TEXT NOT NULL,
  at_ms       INTEGER NOT NULL,
  -- The sensitivity rule that absorbed it, when the subject declared one. An
  -- absorbed occurrence is working as declared and never gates; it is kept
  -- because a rule that has absorbed something in every run for six months is
  -- worth being able to ask about.
  absorbed_by TEXT
) STRICT;

CREATE INDEX instabilities_subject ON instabilities (project, subject, at_ms);

CREATE TRIGGER runs_are_append_only BEFORE UPDATE ON runs BEGIN
  SELECT RAISE(ABORT, 'runs are append-only: a recorded run is a fact about a moment, and rewriting one changes a denominator somebody already read');
END;
CREATE TRIGGER runs_are_permanent BEFORE DELETE ON runs BEGIN
  SELECT RAISE(ABORT, 'runs are append-only: deleting a quiet run inflates every rate computed over its window');
END;
CREATE TRIGGER observations_are_append_only BEFORE UPDATE ON observations BEGIN
  SELECT RAISE(ABORT, 'observations are append-only: two hashes for one key are two rows, and an update is the merge this store exists to avoid');
END;
CREATE TRIGGER observations_are_permanent BEFORE DELETE ON observations BEGIN
  SELECT RAISE(ABORT, 'observations are append-only: a deleted change is a change nobody can ever ask about again');
END;
CREATE TRIGGER token_values_are_append_only BEFORE UPDATE ON token_values BEGIN
  SELECT RAISE(ABORT, 'token values are append-only: a rewritten value breaks the journey that was the reason for keeping it');
END;
CREATE TRIGGER token_values_are_permanent BEFORE DELETE ON token_values BEGIN
  SELECT RAISE(ABORT, 'token values are append-only: a removed step turns a drift total into a lower bound with nothing saying so');
END;
CREATE TRIGGER instabilities_are_append_only BEFORE UPDATE ON instabilities BEGIN
  SELECT RAISE(ABORT, 'instabilities are append-only: an occurrence is a fact about one run, and rewriting one changes a rate somebody already acted on');
END;
CREATE TRIGGER instabilities_are_permanent BEFORE DELETE ON instabilities BEGIN
  SELECT RAISE(ABORT, 'instabilities are append-only: deleting an occurrence is how a flake that was fixed becomes a flake that never happened');
END;
`;

/**
 * Everything a version-1 database is missing, applied in order.
 *
 * A migration exists here where the first version of this file said there was
 * none, and the reason is the sentence that file already carries: an older
 * database is refused rather than migrated *because no migration exists yet*. One
 * does now. Refusing a version-1 file instead would tell an operator whose only
 * copy of their history is that file to delete it, and a store that costs its
 * contents to upgrade is a store nobody upgrades.
 *
 * Additive only, by construction. Both statements add something that was absent;
 * neither rewrites a row, so a database part-way through this list is still a
 * database whose existing answers mean exactly what they meant before. `ALTER
 * TABLE ADD COLUMN` on a `STRICT` table needs the column to be nullable or
 * defaulted, and `swept` is nullable for its own reasons anyway.
 */
const MIGRATIONS: readonly (readonly string[])[] = [
  // 1 → 2: instability rows, and whether a run examined every subject.
  [
    'ALTER TABLE runs ADD COLUMN swept INTEGER',
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
    'CREATE INDEX instabilities_subject ON instabilities (project, subject, at_ms)',
    `CREATE TRIGGER instabilities_are_append_only BEFORE UPDATE ON instabilities BEGIN
       SELECT RAISE(ABORT, 'instabilities are append-only: an occurrence is a fact about one run, and rewriting one changes a rate somebody already acted on');
     END`,
    `CREATE TRIGGER instabilities_are_permanent BEFORE DELETE ON instabilities BEGIN
       SELECT RAISE(ABORT, 'instabilities are append-only: deleting an occurrence is how a flake that was fixed becomes a flake that never happened');
     END`,
  ],
];

/**
 * Create the schema, or refuse a database this build cannot read correctly.
 *
 * Three outcomes, and the middle one is the reason this function is not a
 * `CREATE TABLE IF NOT EXISTS`:
 *
 * - an empty file becomes a store at the current version;
 * - a store written by a **newer** version is refused, because the alternative is
 *   reading its rows through this version's assumptions and answering drift
 *   questions from a shape that no longer means what it did;
 * - a file that already holds tables but carries no version of ours is refused
 *   too. `IF NOT EXISTS` would have adopted somebody else's database and started
 *   appending to it.
 *
 * An older version is **migrated** when {@link MIGRATIONS} carries a step for
 * every version between, and refused otherwise. The steps are additive by
 * construction and run in one transaction with the version bump, so a database is
 * never left at a version whose shape it does not have.
 */
export function prepareSchema(database: DatabaseSync, path: string): void {
  database.exec('PRAGMA journal_mode = WAL');
  // One process owns the file, but a crashed predecessor can still hold a lock
  // for a moment. Failing instantly on that is a service that will not restart.
  database.exec('PRAGMA busy_timeout = 5000');

  const version = number(
    database.prepare('PRAGMA user_version').get() ?? {},
    'user_version',
    'the schema version',
  );

  if (version > SCHEMA_VERSION) {
    throw new Error(
      `the history database at ${path} was written by schema version ${version}; this build ` +
        `understands ${SCHEMA_VERSION}. Refusing to open it: reading a newer shape through older ` +
        'assumptions answers drift questions with numbers that are wrong in a way nothing shows',
    );
  }

  if (version === SCHEMA_VERSION) return;

  if (version !== 0) {
    if (version < 1 || MIGRATIONS.length < SCHEMA_VERSION - 1) {
      throw new Error(
        `the history database at ${path} was written by schema version ${version}; this build ` +
          `understands ${SCHEMA_VERSION} and carries no migration from ${version}. Refusing to ` +
          'open it rather than guessing what its rows mean',
      );
    }

    // One transaction over every remaining step and the version bump together. A
    // database left at a version whose shape it does not have is worse than one
    // that refused to open: every query afterwards is against a table that may or
    // may not exist, decided by where the process died.
    database.exec('BEGIN IMMEDIATE');
    try {
      for (let from = version; from < SCHEMA_VERSION; from += 1) {
        for (const statement of MIGRATIONS[from - 1] ?? []) database.exec(statement);
      }
      database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
      database.exec('COMMIT');
    } catch (error) {
      database.exec('ROLLBACK');
      throw error;
    }
    return;
  }

  const populated = database.prepare('SELECT COUNT(*) AS tables FROM sqlite_master').get() ?? {};
  if (number(populated, 'tables', 'the table count') > 0) {
    throw new Error(
      `the file at ${path} is an SQLite database with no history schema version in it, so it was ` +
        'written by something else. Refusing to add tables to a database this service does not ' +
        'own; point it at a new path',
    );
  }

  database.exec(SCHEMA);
  // Not parameterizable — `PRAGMA` takes no bindings. The value is a module
  // constant, never anything that reached the process from outside.
  database.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
}
