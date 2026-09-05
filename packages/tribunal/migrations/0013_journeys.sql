-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 15.

CREATE TABLE build_journeys (
       project        TEXT NOT NULL,
       build          TEXT NOT NULL,
       journal_commit TEXT,
       whole          TEXT NOT NULL,
       truncated      TEXT NOT NULL,
       unrecorded     TEXT NOT NULL,
       found          TEXT NOT NULL,
       PRIMARY KEY (project, build)
     ) STRICT;
UPDATE schema_version SET version = 15;
