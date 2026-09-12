-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 16.

ALTER TABLE build_subjects ADD COLUMN candidate_identity TEXT;
ALTER TABLE build_subjects ADD COLUMN candidate_components TEXT;
ALTER TABLE build_subjects ADD COLUMN candidate_finding_marks TEXT;
ALTER TABLE baselines ADD COLUMN components TEXT;
ALTER TABLE baselines ADD COLUMN finding_marks TEXT;
UPDATE schema_version SET version = 16;
