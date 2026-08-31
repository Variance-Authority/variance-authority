-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 14.

ALTER TABLE build_movements ADD COLUMN compared INTEGER;
UPDATE schema_version SET version = 14;
