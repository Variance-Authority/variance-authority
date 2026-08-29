-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 8.

ALTER TABLE build_subjects ADD COLUMN baseline_width INTEGER;
ALTER TABLE build_subjects ADD COLUMN baseline_height INTEGER;
UPDATE schema_version SET version = 8;
