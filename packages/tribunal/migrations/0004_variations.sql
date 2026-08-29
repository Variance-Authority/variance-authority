-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 6.

CREATE TABLE build_variations (
       project    TEXT NOT NULL,
       build      TEXT NOT NULL,
       subject    TEXT NOT NULL,
       parent     TEXT,
       identical  INTEGER,
       bands      TEXT,
       unobserved TEXT,
       components TEXT,
       digest     TEXT,
       how        TEXT,
       because    TEXT NOT NULL,
       PRIMARY KEY (project, build, subject)
     ) STRICT;
UPDATE schema_version SET version = 6;
