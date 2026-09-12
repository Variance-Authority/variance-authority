-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 17.

CREATE TABLE objects (
       project    TEXT NOT NULL,
       object_key TEXT NOT NULL,
       size       INTEGER NOT NULL,
       at_ms      INTEGER NOT NULL,
       PRIMARY KEY (project, object_key)
     ) STRICT;
CREATE INDEX objects_idle ON objects (project, at_ms);
CREATE INDEX baselines_object ON baselines (object_key);
CREATE INDEX render_cache_object ON render_cache (object_key);
CREATE INDEX build_subjects_after ON build_subjects (after_key);
CREATE INDEX build_subjects_before ON build_subjects (before_key);
CREATE INDEX build_subjects_diff ON build_subjects (diff_key);
UPDATE schema_version SET version = 17;
