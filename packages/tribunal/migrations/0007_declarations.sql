-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 9.

ALTER TABLE builds ADD COLUMN ignores TEXT;
ALTER TABLE builds ADD COLUMN sensitivities TEXT;
UPDATE schema_version SET version = 9;
