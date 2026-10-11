-- Generated from packages/tribunal/src/schema.ts by tools/tribunal-migrations.mjs.
-- Do not edit. `migrations.test.ts` fails when this file and the array disagree.
-- Schema version 19.

CREATE TABLE concerns (
       id         INTEGER PRIMARY KEY AUTOINCREMENT,
       project    TEXT NOT NULL,
       build      TEXT NOT NULL,
       subject    TEXT NOT NULL,
       title      TEXT NOT NULL,
       -- A rectangle on the build's after image, as JSON, or NULL for the whole
       -- render. NULL is not an empty rectangle.
       region     TEXT,
       evidence   TEXT NOT NULL,
       raised_by  TEXT NOT NULL,
       at         TEXT NOT NULL,
       at_ms      INTEGER NOT NULL
     ) STRICT;
CREATE INDEX concerns_by_subject ON concerns (project, subject, id);
CREATE TABLE concern_events (
       seq        INTEGER PRIMARY KEY AUTOINCREMENT,
       project    TEXT NOT NULL,
       concern    INTEGER NOT NULL REFERENCES concerns (id),
       state      TEXT NOT NULL CHECK (state IN ('open', 'investigating', 'resolved')),
       note       TEXT,
       hypothesis TEXT,
       moved_by   TEXT NOT NULL,
       at         TEXT NOT NULL,
       at_ms      INTEGER NOT NULL
     ) STRICT;
CREATE INDEX concern_events_by_concern ON concern_events (project, concern, seq);
CREATE TRIGGER concerns_are_append_only BEFORE UPDATE ON concerns BEGIN
       SELECT RAISE(ABORT, 'concerns are append-only: a rewritten concern changes what a reviewer suspected after they said it, and a state change is a concern_events row');
     END;
CREATE TRIGGER concerns_are_permanent BEFORE DELETE ON concerns BEGIN
       SELECT RAISE(ABORT, 'concerns are append-only: a deleted concern is a suspicion nobody can ever be told was resolved');
     END;
CREATE TRIGGER concern_events_are_append_only BEFORE UPDATE ON concern_events BEGIN
       SELECT RAISE(ABORT, 'concern events are append-only: a rewritten step changes who resolved a concern after they resolved it');
     END;
CREATE TRIGGER concern_events_are_permanent BEFORE DELETE ON concern_events BEGIN
       SELECT RAISE(ABORT, 'concern events are append-only: a deleted step reopens a resolved concern with nothing saying who did');
     END;
UPDATE schema_version SET version = 19;
