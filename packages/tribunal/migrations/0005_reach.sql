-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 7.

CREATE TABLE build_reach (
       project     TEXT NOT NULL,
       build       TEXT NOT NULL,
       against_ref TEXT NOT NULL,
       changed     TEXT NOT NULL,
       components  TEXT NOT NULL,
       whole       TEXT,
       unscanned   TEXT,
       opaque      TEXT,
       PRIMARY KEY (project, build)
     ) STRICT;
CREATE TABLE build_reach_subjects (
       project TEXT NOT NULL,
       build   TEXT NOT NULL,
       subject TEXT NOT NULL,
       reached INTEGER NOT NULL,
       through TEXT,
       trail   TEXT,
       because TEXT NOT NULL,
       PRIMARY KEY (project, build, subject)
     ) STRICT;
UPDATE schema_version SET version = 7;
