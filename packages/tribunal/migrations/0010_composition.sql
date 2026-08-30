-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 12.

CREATE TABLE build_composition (
       project    TEXT NOT NULL,
       build      TEXT NOT NULL,
       component  TEXT NOT NULL,
       subjects   TEXT NOT NULL,
       within     TEXT NOT NULL,
       created_by TEXT NOT NULL,
       renders    TEXT NOT NULL,
       PRIMARY KEY (project, build, component)
     ) STRICT;
UPDATE schema_version SET version = 12;
