/**
 * Every shape this database has taken since it shipped, one entry per version.
 *
 * Apart from [`migrations.ts`](./migrations.js), which holds the frozen initial
 * set, because the two are edited under opposite rules: that file must never
 * change again, and this one only ever grows. Keeping them in one module meant
 * every new table was appended a screen below a block carrying a comment saying
 * it was frozen.
 *
 * The reading of both — which version they land on, and the batch that applies
 * them — is in [`schema.ts`](./schema.js).
 */


/**
 * One entry per version after `INITIAL_VERSION`, in order.
 *
 * A database that is already deployed cannot be given a new table by editing the
 * statements that created it — `wrangler d1 migrations apply` tracks which files
 * it has run, and a rewritten `0001` is a file it will never run again. So the
 * initial set is frozen at the version it shipped at and every later shape is a
 * step, generated into its own `.sql` beside it.
 *
 * Each step ends by writing its own version, so a database is never at a version
 * whose shape it does not have — and a fresh database applying the initial set
 * and every step in order arrives at exactly the same place as one that was
 * deployed three versions ago.
 *
 * Additive only. A step that dropped or rewrote a column would be asking an
 * append-only store to forget something, which is the one thing every trigger in
 * this file exists to refuse.
 */
export const MIGRATIONS: readonly (readonly string[])[] = [
  // 3 → 4: why a baseline in this database is what it is.
  [
    // Why a baseline in this database is what it is. One row per **approval**, and
    // the columns are copies rather than a join on purpose: `builds` and
    // `build_subjects` expire under `sweep`, and the explanation of a baseline has
    // to last exactly as long as the baseline, which is forever. A view over those
    // tables would answer correctly right up until the retention window passed and
    // then answer "nothing was ever explained" — the one failure this whole
    // subsystem exists to refuse. It is the same trade the git-LFS half makes by
    // writing the explanation into the commit message instead of a sidecar.
    `CREATE TABLE changelog (
       seq            INTEGER PRIMARY KEY AUTOINCREMENT,
       project        TEXT NOT NULL,
       build          TEXT NOT NULL,
       subject        TEXT NOT NULL,
       "commit"       TEXT NOT NULL,
       intent         TEXT,
       decided_by     TEXT NOT NULL,
       note           TEXT,
       -- The region list the build reported, frozen. Shapes are grouped when
       -- somebody reads: approval here is per subject, so there is no batch at
       -- write time to cluster, and a shape approved across three sessions should
       -- still read as one change.
       regions        TEXT NOT NULL,
       at             TEXT NOT NULL,
       at_ms          INTEGER NOT NULL
     ) STRICT`,
    `CREATE INDEX changelog_recent ON changelog (project, at_ms DESC)`,
    `CREATE INDEX changelog_subject ON changelog (project, subject, at_ms DESC)`,

    `CREATE TRIGGER changelog_is_append_only BEFORE UPDATE ON changelog BEGIN
       SELECT RAISE(ABORT, 'the changelog is append-only: an edited explanation is an explanation of a baseline that was promoted for a different reason');
     END`,
    `CREATE TRIGGER changelog_is_permanent BEFORE DELETE ON changelog BEGIN
       SELECT RAISE(ABORT, 'the changelog is append-only: a deleted entry leaves a baseline nobody can account for, which is the state this table exists to end');
     END`,
    `UPDATE schema_version SET version = 4`,
  ],
  // 4 → 5: browser accessibility evidence is verdict-bearing baseline state.
  [
    `ALTER TABLE baselines ADD COLUMN accessibility TEXT`,
    `ALTER TABLE build_subjects ADD COLUMN signals TEXT`,
    `ALTER TABLE build_subjects ADD COLUMN candidate_accessibility TEXT`,
    `UPDATE schema_version SET version = 5`,
  ],
  // 5 → 6: what a run read about its own subjects, with no baseline in it.
  [
    // A table rather than columns on `build_subjects`, because a variation is
    // about a *pair*: the row belongs to the subject, but what it says is how
    // that subject stands against another subject in the same run. A subject can
    // also be a variation while having no observation at all — a story added
    // behind a flag is `new`, and the flag's effect is exactly what this row
    // carries — so the two are not the same set.
    //
    // Every optional field is nullable and none of them is defaulted. `identical`
    // has three states and they are three different claims: `1` the pair renders
    // to one hash, `0` it does not, `NULL` nothing compared them, because the
    // parent the declaration named is not in this run. Writing `0` for the third
    // would report a broken link as a measured difference.
    `CREATE TABLE build_variations (
       project    TEXT NOT NULL,
       build      TEXT NOT NULL,
       subject    TEXT NOT NULL,
       parent     TEXT,
       identical  INTEGER,
       bands      TEXT,
       unobserved TEXT,
       components TEXT,
       digest     TEXT,
       how        TEXT,
       because    TEXT NOT NULL,
       PRIMARY KEY (project, build, subject)
     ) STRICT`,
    `UPDATE schema_version SET version = 6`,
  ],
  // 6 → 7: what the commit reaches, which is the only thing here that names a
  // file somebody edited.
  [
    // Two tables rather than one, and the split is the whole point of the shape.
    //
    // The build row exists whenever a run had a diff to read, *including* when
    // the walk refused to attribute it — a changed file the graph does not hold,
    // a diff entirely outside the graph, a diff reaching no component. In that
    // case `whole` carries the reason and there are no subject rows.
    //
    // So zero subject rows has two meanings and `whole` is what separates them:
    // with a reason, nothing could be attributed and every subject must be read
    // as possibly reached; without one, the commit was understood and simply
    // reached none of the subjects whose baselines said what they were made of.
    // Those support opposite decisions, and one table could not hold both.
    `CREATE TABLE build_reach (
       project     TEXT NOT NULL,
       build       TEXT NOT NULL,
       against_ref TEXT NOT NULL,
       changed     TEXT NOT NULL,
       components  TEXT NOT NULL,
       whole       TEXT,
       unscanned   TEXT,
       opaque      TEXT,
       PRIMARY KEY (project, build)
     ) STRICT`,
    // `through` and `trail` are nullable together with `reached = 0`: a subject
    // this diff does not reach has no chain to print, and an empty array stored
    // where a chain belongs would render as a trail of no hops rather than as no
    // trail. A subject whose baseline recorded no component list is not a row at
    // all — the run cannot say what it is made of, and `reached = 0` would be an
    // assertion nobody made.
    `CREATE TABLE build_reach_subjects (
       project TEXT NOT NULL,
       build   TEXT NOT NULL,
       subject TEXT NOT NULL,
       reached INTEGER NOT NULL,
       through TEXT,
       trail   TEXT,
       because TEXT NOT NULL,
       PRIMARY KEY (project, build, subject)
     ) STRICT`,
    `UPDATE schema_version SET version = 7`,
  ],
  // 7 → 8: how large the baseline was, which is sometimes the change itself.
  [
    // Nullable, and left null on every row written before this step. A number
    // backfilled from `candidate_width` would be an invention that reads exactly
    // like a measurement, and the whole point of the column is to be able to say
    // the two differ.
    `ALTER TABLE build_subjects ADD COLUMN baseline_width INTEGER`,
    `ALTER TABLE build_subjects ADD COLUMN baseline_height INTEGER`,
    `UPDATE schema_version SET version = 8`,
  ],
  // 8 → 9: what the config declared, and what each declaration did.
  [
    // The audit that makes an ignore safe to have, kept where it outlives the run.
    // A mask grows over a real regression silently, and the only thing that catches
    // it is a rule absorbing nothing *again* — a comparison a CI log cannot answer.
    //
    // Two columns rather than a row per rule: the ledger is small, is always read
    // with its build, and a table here would be a second vocabulary for one fact.
    //
    // Null is *the writer said nothing*, which on this format is also what a
    // config with no rules produces — one absence, and the store invents no
    // second. What it must not become is a ledger of zero rules: an unaudited
    // build, reported as an audited one that found nothing.
    `ALTER TABLE builds ADD COLUMN ignores TEXT`,
    `ALTER TABLE builds ADD COLUMN sensitivities TEXT`,
    `UPDATE schema_version SET version = 9`,
  ],
  // 9 → 10: which declaration decided each green subject.
  [
    // The ledger added at step 9 says what each rule absorbed *across the run*.
    // It cannot say which rule absorbed *this subject*, and that is the sentence
    // the report prints beside every green-by-declaration name. Without these
    // two columns a service reading its own store had to answer `the run did not
    // record which rule absorbed it` about a run that recorded it — the store's
    // own omission, rendered as the observer's.
    //
    // Null keeps meaning the writer said nothing: `ignored: {pixels: 0, boxes: 2}`
    // is a rule that caught nothing here, which is not the same fact and is the
    // one that turns a mask into a blind spot.
    `ALTER TABLE build_subjects ADD COLUMN ignored TEXT`,
    `ALTER TABLE build_subjects ADD COLUMN relaxed TEXT`,
    `UPDATE schema_version SET version = 10`,
  ],
  // 10 → 11: which component moved, and in which band.
  [
    // `regions` is the raster tier's answer, and it loses the name exactly where
    // a reviewer needs it: a difference that reflows its neighbours merges into
    // one blob, the blob fits no component, and the region resolves to the
    // document root. The semantic tier never lost it — it compares digests, not
    // pixels — but the store had no column for it, so the service could report
    // only what the picture happened to be able to say.
    //
    // Null keeps meaning the run wrote nothing — here, a baseline with no
    // component hashes. `'[]'` is both sides read and every digest matched.
    `ALTER TABLE build_subjects ADD COLUMN moved TEXT`,
    `UPDATE schema_version SET version = 11`,
  ],
  // 11 → 12: what draws what, which is the only record that can answer *why did
  // this move* for a component no file in the diff declares.
  [
    // The import graph climbs. `build_reach` walks from a changed file through
    // its importers, so it names what an edit *could* have reached and can never
    // name anything a changed file draws: `ProductCard` renders `Card`, `Card`
    // renders `CardFooter`, and a walk that only goes upward arrives at none of
    // them. The page was left saying "no rung above holds them" — true, and not
    // a reason.
    //
    // The run already wrote the other direction. `composition.components`
    // carries `within` and `renders` per component, folded over every subject,
    // and the store dropped it at the door.
    //
    // One row per component, not a JSON blob on `builds`: the page asks *who
    // draws this one*, and a census of four hundred components read whole to
    // answer it is the shape that makes a reviewer wait.
    //
    // Every column NOT NULL, including the empty lists. A census that named a
    // component knows all three, and the one ambiguity in them — an empty
    // `created_by` is *this was a production build*, not *nothing mounted it* —
    // belongs to the report that wrote it. A store that answered it with NULL
    // would be inventing a distinction upstream declined to make.
    `CREATE TABLE build_composition (
       project    TEXT NOT NULL,
       build      TEXT NOT NULL,
       component  TEXT NOT NULL,
       subjects   TEXT NOT NULL,
       within     TEXT NOT NULL,
       created_by TEXT NOT NULL,
       renders    TEXT NOT NULL,
       PRIMARY KEY (project, build, component)
     ) STRICT`,
    `UPDATE schema_version SET version = 12`,
  ],
  // 12 → 13: the attribution itself. The census above says who draws what; this
  // says what the run concluded from it about each thing that moved.
  [
    // The store kept the graph and dropped the answer. A run walks the diff,
    // finds the file that declares each moved component, climbs to an edited
    // ancestor when nothing declares it, and writes one sentence per movement
    // into `composition.movements` — and every one of them stopped at the ingest
    // door. The review page then rebuilt a worse version of the same walk out of
    // the census, with no access to the props digests or the control group the
    // run had used, and printed *no rung above holds them* about components the
    // run had already attributed to an edited parent.
    //
    // One row per movement, keyed by the pair it is about. A component moves for
    // its own reason in each subject it moved in — the same `Button` can be
    // `edited` on one page and `upstream` on another — so a table keyed by
    // component alone would keep whichever row was written last and call it the
    // cause everywhere.
    //
    // `also_in` is not a column. It is the subjects of the sibling rows for the
    // same component, and a stored copy is a second answer that can disagree
    // with the first.
    //
    // Nullable is *the rung does not apply*: `file` on anything but `edited`,
    // `upstream` and `through` on anything but `upstream`, `standing` on
    // anything explained. `bands` and `held` are NOT NULL and can be `'[]'`,
    // which in both cases means what the report means by it — for `bands`, that
    // the comparison was name-only and no band is known; for `held`, that the
    // suite offered no control.
    `CREATE TABLE build_movements (
       project   TEXT NOT NULL,
       build     TEXT NOT NULL,
       subject   TEXT NOT NULL,
       component TEXT NOT NULL,
       cause     TEXT NOT NULL,
       because   TEXT NOT NULL,
       bands     TEXT NOT NULL,
       held      TEXT NOT NULL,
       file      TEXT,
       tokens    TEXT,
       upstream  TEXT,
       through   TEXT,
       standing  TEXT,
       PRIMARY KEY (project, build, subject, component)
     ) STRICT`,
    `UPDATE schema_version SET version = 13`,
  ],
];
