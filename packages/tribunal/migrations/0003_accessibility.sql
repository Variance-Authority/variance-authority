-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 5.

ALTER TABLE baselines ADD COLUMN accessibility TEXT;
ALTER TABLE build_subjects ADD COLUMN signals TEXT;
ALTER TABLE build_subjects ADD COLUMN candidate_accessibility TEXT;
UPDATE schema_version SET version = 5;
