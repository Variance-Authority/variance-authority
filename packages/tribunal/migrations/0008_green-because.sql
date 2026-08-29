-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 10.

ALTER TABLE build_subjects ADD COLUMN ignored TEXT;
ALTER TABLE build_subjects ADD COLUMN relaxed TEXT;
UPDATE schema_version SET version = 10;
