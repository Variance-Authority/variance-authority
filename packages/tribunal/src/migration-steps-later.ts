/**
 * The steps from 16 -> 17 onwards, under the rules of
 * [`migration-steps.ts`](./migration-steps.js): additive, in order, each ending
 * with its own version. A file of its own only because one file holds 500 lines;
 * `MIGRATIONS` spreads this list onto the end of its own, so nothing reads it
 * apart from that.
 */
export const LATER_MIGRATIONS: readonly (readonly string[])[] = [
  // 16 -> 17: one object per picture, and a ledger that can find the ones
  // nothing points at.
  //
  // Every key this package wrote used to be derived from where the bytes came
  // from rather than from what they are: a baseline under its identity digest, a
  // cache entry under its document digest, a build image under the build id. Two
  // byte-identical PNGs therefore always landed at two keys, by construction —
  // S subjects over B builds of an unchanged suite is S x (B + 1) objects
  // holding S distinct pictures, and approving copied an image the bucket
  // already had.
  //
  // Content keys collapse that, and take away the safety that made the old
  // sweep simple: when a build's `before` had its own key, deleting it could not
  // possibly touch the baseline it was a copy of. Now it is the same object, so
  // an object may only be deleted once nothing refers to it. This table is what
  // makes that question answerable — R2 has no listing here, deliberately, so an
  // object no row names is otherwise unreachable forever, which is exactly what
  // `store.ts` promised the sweep would collect and the sweep could not.
  //
  // `at_ms` is a grace window rather than an age: it is refreshed every time a
  // write finds the bytes already stored, so what falls out of the window is an
  // object nothing has referred to for the whole retention period.
  [
    `CREATE TABLE objects (
       project    TEXT NOT NULL,
       object_key TEXT NOT NULL,
       size       INTEGER NOT NULL,
       at_ms      INTEGER NOT NULL,
       PRIMARY KEY (project, object_key)
     ) STRICT`,
    `CREATE INDEX objects_idle ON objects (project, at_ms)`,
    // The sweep asks the referencing tables whether a key is still spoken for,
    // once per candidate object. Without these that is three table scans per
    // object over the whole history of the project.
    `CREATE INDEX baselines_object ON baselines (object_key)`,
    `CREATE INDEX render_cache_object ON render_cache (object_key)`,
    `CREATE INDEX build_subjects_after ON build_subjects (after_key)`,
    `CREATE INDEX build_subjects_before ON build_subjects (before_key)`,
    `CREATE INDEX build_subjects_diff ON build_subjects (diff_key)`,
    `UPDATE schema_version SET version = 17`,
  ],

  // 17 -> 18: a baseline for a subject that occupies no pixels.
  //
  // `width`, `height` and `object_key` were `NOT NULL` because every subject was
  // assumed to have been photographed, and a subject that could not be
  // photographed was refused at the renderer. Material UI's unit tier is 1109
  // subjects out of 4371 that occupy nothing -- `describeConformance` mounts each
  // component with no children, so `<AlertTitle />` is an empty div with margins.
  // Each of those still has a document, rules, component hashes and an
  // accessibility tree, all of which compare; refusing them reported a quarter of
  // the tier as unobserved over the one axis nobody was asking about.
  //
  // The three move together, and `store.ts` reads the dimensions to decide
  // whether to fetch an object: a row with dimensions and no key, or a key and no
  // dimensions, is damage and is refused rather than half-believed.
  //
  // SQLite cannot relax `NOT NULL` in place, so this is the twelve-step table
  // rebuild. `STRICT` and the primary keys are copied verbatim from `INITIAL` --
  // the only difference is the three columns -- and the indexes are recreated
  // because dropping a table drops its indexes with it.
  [
    `CREATE TABLE baselines_new (
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
     ) STRICT`,
    `INSERT INTO baselines_new
       SELECT project, identity_digest, subject, label, identity, document_digest,
              width, height, missing_fonts, accessibility, components, finding_marks,
              object_key, at, at_ms
         FROM baselines`,
    `DROP TABLE baselines`,
    `ALTER TABLE baselines_new RENAME TO baselines`,
    `CREATE INDEX baselines_across_identities ON baselines (project, subject, label, at_ms DESC)`,
    `CREATE INDEX baselines_object ON baselines (object_key)`,

    `CREATE TABLE render_cache_new (
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
     ) STRICT`,
    `INSERT INTO render_cache_new
       SELECT project, identity_digest, document_digest, identity, width, height,
              missing_fonts, object_key, at_ms
         FROM render_cache`,
    `DROP TABLE render_cache`,
    `ALTER TABLE render_cache_new RENAME TO render_cache`,
    `CREATE INDEX render_cache_object ON render_cache (object_key)`,
    `UPDATE schema_version SET version = 18`,
  ],

  // 18 -> 19: what a reviewer suspects, apart from whether the baseline moves.
  //
  // A decision answers one question -- do these pixels become the baseline -- and
  // a reviewer often has a second one the decision cannot hold: "this looks
  // wrong, and I do not know why yet". Written as a rejection it blocks a change
  // that may be fine; written as a note on an approval it disappears the moment
  // the baseline moves. So a concern is its own record, anchored to the subject
  // rather than to the build it was raised in, because the next build of that
  // subject is where somebody checks whether it still holds.
  //
  // Two tables for the reason `decisions` is append-only: the concern is what was
  // suspected and where, and never changes; its state is the trail of who moved
  // it, and the latest row is the answer. Neither is swept -- a concern outlives
  // the build that raised it exactly as a changelog entry does.
  [
    `CREATE TABLE concerns (
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
     ) STRICT`,
    `CREATE INDEX concerns_by_subject ON concerns (project, subject, id)`,
    `CREATE TABLE concern_events (
       seq        INTEGER PRIMARY KEY AUTOINCREMENT,
       project    TEXT NOT NULL,
       concern    INTEGER NOT NULL REFERENCES concerns (id),
       state      TEXT NOT NULL CHECK (state IN ('open', 'investigating', 'resolved')),
       note       TEXT,
       hypothesis TEXT,
       moved_by   TEXT NOT NULL,
       at         TEXT NOT NULL,
       at_ms      INTEGER NOT NULL
     ) STRICT`,
    `CREATE INDEX concern_events_by_concern ON concern_events (project, concern, seq)`,
    `CREATE TRIGGER concerns_are_append_only BEFORE UPDATE ON concerns BEGIN
       SELECT RAISE(ABORT, 'concerns are append-only: a rewritten concern changes what a reviewer suspected after they said it, and a state change is a concern_events row');
     END`,
    `CREATE TRIGGER concerns_are_permanent BEFORE DELETE ON concerns BEGIN
       SELECT RAISE(ABORT, 'concerns are append-only: a deleted concern is a suspicion nobody can ever be told was resolved');
     END`,
    `CREATE TRIGGER concern_events_are_append_only BEFORE UPDATE ON concern_events BEGIN
       SELECT RAISE(ABORT, 'concern events are append-only: a rewritten step changes who resolved a concern after they resolved it');
     END`,
    `CREATE TRIGGER concern_events_are_permanent BEFORE DELETE ON concern_events BEGIN
       SELECT RAISE(ABORT, 'concern events are append-only: a deleted step reopens a resolved concern with nothing saying who did');
     END`,
    `UPDATE schema_version SET version = 19`,
  ],
];
