-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 3.

CREATE TABLE schema_version (
     version INTEGER NOT NULL
   ) STRICT;
INSERT INTO schema_version (version) VALUES (3);
CREATE TABLE baselines (
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
   ) STRICT;
CREATE INDEX baselines_across_identities ON baselines (project, subject, label, at_ms DESC);
CREATE TABLE render_cache (
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
   ) STRICT;
CREATE TABLE builds (
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
   ) STRICT;
CREATE INDEX builds_recent ON builds (project, at_ms DESC);
CREATE TABLE build_subjects (
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
   ) STRICT;
CREATE TABLE build_not_observed (
     project TEXT NOT NULL,
     build   TEXT NOT NULL,
     subject TEXT NOT NULL,
     kind    TEXT NOT NULL,
     because TEXT NOT NULL,
     PRIMARY KEY (project, build, subject)
   ) STRICT;
CREATE TABLE decisions (
     seq       INTEGER PRIMARY KEY AUTOINCREMENT,
     project   TEXT NOT NULL,
     build     TEXT NOT NULL,
     subject   TEXT NOT NULL,
     decision  TEXT NOT NULL,
     decided_by TEXT NOT NULL,
     note      TEXT,
     at        TEXT NOT NULL,
     at_ms     INTEGER NOT NULL
   ) STRICT;
CREATE INDEX decisions_latest ON decisions (project, build, subject, seq DESC);
CREATE TRIGGER decisions_are_append_only BEFORE UPDATE ON decisions BEGIN
     SELECT RAISE(ABORT, 'decisions are append-only: a rewritten decision erases the review it replaced, and the earlier one is what makes the later one reviewable');
   END;
CREATE TRIGGER decisions_are_permanent BEFORE DELETE ON decisions BEGIN
     SELECT RAISE(ABORT, 'decisions are append-only: a deleted approval leaves a promoted baseline nobody can attribute to anyone');
   END;
CREATE TABLE runs (
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
   ) STRICT;
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
CREATE TABLE instabilities (
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
   ) STRICT;
CREATE INDEX instabilities_subject ON instabilities (project, subject, at_ms);
CREATE TABLE approvals (
     project  TEXT NOT NULL,
     subject  TEXT NOT NULL,
     run      TEXT NOT NULL,
     at       TEXT NOT NULL,
     at_ms    INTEGER NOT NULL,
     approver TEXT
   ) STRICT;
CREATE UNIQUE INDEX approvals_identity ON approvals (project, subject, run);
CREATE INDEX approvals_window ON approvals (project, at_ms);
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
CREATE TRIGGER approvals_are_append_only BEFORE UPDATE ON approvals BEGIN
     SELECT RAISE(ABORT, 'approvals are append-only: a rewritten acceptance changes what a reviewer agreed to after they agreed to it');
   END;
CREATE TRIGGER approvals_are_permanent BEFORE DELETE ON approvals BEGIN
     SELECT RAISE(ABORT, 'approvals are append-only: a deleted acceptance turns a reviewed change back into an unreviewed one, and every drift total over it drops');
   END;
