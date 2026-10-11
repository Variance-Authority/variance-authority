-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 20.

ALTER TABLE build_variations ADD COLUMN step TEXT;
UPDATE schema_version SET version = 20;
