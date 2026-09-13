-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 18.

CREATE TABLE baselines_new (
       project         TEXT NOT NULL,
       identity_digest TEXT NOT NULL,
       subject         TEXT NOT NULL,
       label           TEXT NOT NULL,
       identity        TEXT NOT NULL,
       document_digest TEXT NOT NULL,
       width           INTEGER,
       height          INTEGER,
       missing_fonts   TEXT NOT NULL,
       accessibility   TEXT,
       components      TEXT,
       finding_marks   TEXT,
       object_key      TEXT,
       at              TEXT NOT NULL,
       at_ms           INTEGER NOT NULL,
       PRIMARY KEY (project, identity_digest, subject, label)
     ) STRICT;
INSERT INTO baselines_new
       SELECT project, identity_digest, subject, label, identity, document_digest,
              width, height, missing_fonts, accessibility, components, finding_marks,
              object_key, at, at_ms
         FROM baselines;
DROP TABLE baselines;
ALTER TABLE baselines_new RENAME TO baselines;
CREATE INDEX baselines_across_identities ON baselines (project, subject, label, at_ms DESC);
CREATE INDEX baselines_object ON baselines (object_key);
CREATE TABLE render_cache_new (
       project         TEXT NOT NULL,
       identity_digest TEXT NOT NULL,
       document_digest TEXT NOT NULL,
       identity        TEXT NOT NULL,
       width           INTEGER,
       height          INTEGER,
       missing_fonts   TEXT NOT NULL,
       object_key      TEXT,
       at_ms           INTEGER NOT NULL,
       PRIMARY KEY (project, identity_digest, document_digest)
     ) STRICT;
INSERT INTO render_cache_new
       SELECT project, identity_digest, document_digest, identity, width, height,
              missing_fonts, object_key, at_ms
         FROM render_cache;
DROP TABLE render_cache;
ALTER TABLE render_cache_new RENAME TO render_cache;
CREATE INDEX render_cache_object ON render_cache (object_key);
UPDATE schema_version SET version = 18;
