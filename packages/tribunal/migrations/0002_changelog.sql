-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 4.

CREATE TABLE changelog (
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
     ) STRICT;
CREATE INDEX changelog_recent ON changelog (project, at_ms DESC);
CREATE INDEX changelog_subject ON changelog (project, subject, at_ms DESC);
CREATE TRIGGER changelog_is_append_only BEFORE UPDATE ON changelog BEGIN
       SELECT RAISE(ABORT, 'the changelog is append-only: an edited explanation is an explanation of a baseline that was promoted for a different reason');
     END;
CREATE TRIGGER changelog_is_permanent BEFORE DELETE ON changelog BEGIN
       SELECT RAISE(ABORT, 'the changelog is append-only: a deleted entry leaves a baseline nobody can account for, which is the state this table exists to end');
     END;
UPDATE schema_version SET version = 4;
