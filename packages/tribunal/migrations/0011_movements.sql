-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 13.

CREATE TABLE build_movements (
       project   TEXT NOT NULL,
       build     TEXT NOT NULL,
       subject   TEXT NOT NULL,
       component TEXT NOT NULL,
       cause     TEXT NOT NULL,
       because   TEXT NOT NULL,
       bands     TEXT NOT NULL,
       held      TEXT NOT NULL,
       file      TEXT,
       tokens    TEXT,
       upstream  TEXT,
       through   TEXT,
       standing  TEXT,
       PRIMARY KEY (project, build, subject, component)
     ) STRICT;
UPDATE schema_version SET version = 13;
