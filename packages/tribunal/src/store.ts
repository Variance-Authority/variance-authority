import { identityDigest, type Digest, type Raster } from '@variance-authority/core/format';
import {
  REFUSAL,
  RasterStoreError,
  messageOf,
  neverFails,
  sidecarFrom,
  type BaselineKey,
  type Described,
  type Found,
  type RasterStore,
} from '@variance-authority/raster';
import {
  base64Of,
  bytesOf,
  requireD1,
  requireR2,
  type D1Like,
  type R2Like,
  type TribunalBindings,
} from './bindings.js';
import { guardStore } from './guard.js';
import { keep } from './objects.js';

/**
 * Baselines in R2, attributed in D1.
 *
 * The third durable backend, after the directory and git-LFS, and it answers to
 * the same contract for the same reason the other two do: what a baseline
 * *means* lives in [`@variance-authority/raster`](../../raster), so a verdict
 * cannot depend on where the bytes were kept. That claim is tested rather than
 * asserted — this store is one of the implementations in
 * [`observe/parity.test.ts`](../../observe/src/parity.test.ts), which pins each
 * expected verdict as well as comparing the backends, because three stores
 * agreeing on a wrong answer is not a pass.
 *
 * ## The split, and why it is not one store
 *
 * D1 holds the sidecar; R2 holds the image. That is not two stores pretending to
 * be one — it is the directory store's `.json`/`.png` pair with the halves in the
 * services that suit them. Text that gets queried across identities goes where
 * queries are cheap; bytes that only ever get fetched whole go where bytes are
 * cheap.
 *
 * It inherits the pair's failure mode exactly, and treats it the same way: a row
 * whose object is gone, or an object whose row is gone, is **damage**, and damage
 * is never reported as absence. `null` is earned by one outcome only — no row —
 * because `null` becomes `new`, `new` records whatever this build painted, and
 * the image it overwrites was the only evidence of what the subject looked like
 * before.
 *
 * ## Write order is the safety property
 *
 * The object goes in before the row that points at it. The two orders fail
 * differently and only one of them fails safely:
 *
 * - **object first** — a crash between them leaves an object nothing points at.
 *   Invisible to every read, collected by the sweep once it has been idle for the
 *   retention window, costs storage in the meantime.
 * - **row first** — a crash between them leaves a row pointing at nothing, which
 *   is a baseline that throws on every subsequent run until a person deletes it.
 *
 * D1 and R2 are separate services with no transaction between them, so one of
 * these happens; this file chooses the one that costs bytes over the one that
 * stops the suite.
 *
 * ## The keys are the bytes
 *
 * Both halves store through [`objects.ts`](./objects.ts), which addresses an
 * image by its own SHA-256 and keeps a ledger row per key. A baseline, the
 * candidate it was promoted from, and the `before` of every run since are one
 * object; the identity partition that ADR-0011 makes structural lives in the
 * rows, where the lookup is, and never in the bucket. That is also what makes
 * `put` cheap on the path that runs most: promoting bytes the bucket already
 * holds writes a row and no object.
 */

export interface BucketStoreOptions extends TribunalBindings {
  /**
   * The project these baselines belong to.
   *
   * Every row and every object key is scoped by it, so one deployment serves
   * several repositories without their `story:card` colliding. There is no
   * default: a store that invented one would put two projects' baselines in one
   * namespace and the first symptom would be a mass `changed`.
   */
  readonly project: string;

  /** Injected so tests can pin `at`. Defaults to the wall clock. */
  readonly now?: () => Date;
}

/**
 * Refuse a deployment that never said which project it is.
 *
 * Checked here rather than left to the type, because the operator who gets this
 * wrong reads the value out of an environment or a config file, where the
 * compiler is not standing. Two of `createTribunal`'s five required options
 * already answer with a sentence; this one answered `could not reach its
 * database or its bucket` from the first request that touched a baseline, which
 * blames the platform for a line in a wrangler file.
 *
 * Blank is refused with absent. A project is the namespace every row and object
 * key is scoped by, and one nobody named is the invented default this option
 * exists to make impossible.
 */
function requireProject(project: string): void {
  if (typeof project !== 'string' || project.trim() === '') {
    throw new Error(
      '`project` is required and must not be blank. It scopes every row and every object key, ' +
        'so one deployment can serve several repositories without their `story:card` colliding; ' +
        'a deployment that never named itself puts them in one namespace, and the first symptom ' +
        'is a mass `changed`',
    );
  }
}

/** Shape of every baseline and cache row as it comes back out of D1. */
interface SidecarRow {
  readonly identity: string;
  readonly document_digest: string;
  /**
   * Null exactly when {@link SidecarRow.object_key} is: the subject occupies no
   * pixels, so nothing was photographed and there is no object to point at. The
   * three are written together, and {@link parse} refuses a row carrying some.
   */
  readonly width: number | null;
  readonly height: number | null;
  readonly missing_fonts: string;
  readonly object_key: string | null;
  readonly accessibility?: string | null;
  /**
   * Baselines only; the render cache stores pixels and stripped these before
   * they ever reached a row. Null is *not recorded*, which is what every
   * baseline written before these columns existed says, and is not `[]`.
   */
  readonly components?: string | null;
  readonly finding_marks?: string | null;
}

export function createBucketStore(options: BucketStoreOptions): RasterStore {
  const { db, bucket, project } = options;
  requireD1(db);
  requireR2(bucket);
  requireProject(project);
  const now = options.now ?? ((): Date => new Date());

  return {
    retention: 'durable',

    async find(key, identity): Promise<Found | null> {
      const mine = identityDigest(identity);
      const row = await locate(db, project, key, mine);
      if (row === null) return null;

      const sidecar = parse(row.sidecar, describeRow(project, key, row.identityDigest));
      const object = row.sidecar.object_key;
      return {
        raster: object === null ? sidecar : { ...sidecar, bytes: await fetchBytes(bucket, object) },
        comparable: row.identityDigest === mine,
        storedUnder: sidecar.identity,
      };
    },

    async describe(key, identity): Promise<Described | null> {
      const mine = identityDigest(identity);
      const row = await locate(db, project, key, mine);
      if (row === null) return null;

      const where = describeRow(project, key, row.identityDigest);
      const sidecar = parse(row.sidecar, where);

      // The object is still checked for existence, and this is the entire reason
      // `R2Like` has a `head`. Answering from the row alone would let `describe`
      // and `find` disagree about whether a baseline exists, and a verdict that
      // depends on which of the two a caller asked is not a verdict. A row that
      // records no image has no object to check: the sidecar alone is the whole
      // baseline there, and it says so by carrying no dimensions.
      const object = row.sidecar.object_key;
      if (object !== null && (await guardStore(() => bucket.head(object), where)) === null) {
        throw halfAPair(where, object, 'row');
      }

      return {
        documentDigest: sidecar.documentDigest,
        comparable: row.identityDigest === mine,
        storedUnder: sidecar.identity,
        pictured: object !== null,
        missingFonts: sidecar.missingFonts,
        ...(sidecar.components === undefined
          ? {}
          : { components: sidecar.components.map((hash) => hash.component) }),
        ...(sidecar.accessibility === undefined
          ? {}
          : { accessibility: sidecar.accessibility }),
      };
    },

    async put(key, raster): Promise<void> {
      const label = labelOf(key);
      const digest = identityDigest(raster.identity);
      const where = describeRow(project, key, digest);
      const at = now().toISOString();

      // Keyed by the bytes, so promoting an image the bucket already holds — the
      // usual case, since the candidate was uploaded by the run that painted it —
      // writes a row and no object at all.
      // No object for a subject with no pixels. `keep` addresses bytes by their
      // own digest, and the digest of nothing is one key every empty subject would
      // share — an object a thousand rows point at and no read ever fetches.
      const objectKey =
        raster.bytes === undefined
          ? null
          : await keep(db, bucket, project, bytesOf(raster.bytes), Date.parse(at));
      await guardStore(
        () =>
          db
            .prepare(
              `INSERT INTO baselines
                 (project, identity_digest, subject, label, identity, document_digest,
                  width, height, missing_fonts, accessibility, components, finding_marks,
                  object_key, at, at_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (project, identity_digest, subject, label) DO UPDATE SET
                 identity = excluded.identity,
                 document_digest = excluded.document_digest,
                 width = excluded.width,
                 height = excluded.height,
                 missing_fonts = excluded.missing_fonts,
                 accessibility = excluded.accessibility,
                 components = excluded.components,
                 finding_marks = excluded.finding_marks,
                 object_key = excluded.object_key,
                 at = excluded.at,
                 at_ms = excluded.at_ms`,
            )
            .bind(
              project,
              digest,
              key.subject,
              label,
              JSON.stringify(raster.identity),
              raster.documentDigest,
              raster.width ?? null,
              raster.height ?? null,
              JSON.stringify(raster.missingFonts),
              raster.accessibility === undefined ? null : JSON.stringify(raster.accessibility),
              // What the document said about itself, stored beside the image it
              // describes. A run reading this baseline back separates the
              // component that caused a change from the ones it moved using
              // exactly these, and a store that dropped them handed the run one
              // document and left it ranking by area.
              raster.components === undefined ? null : JSON.stringify(raster.components),
              raster.findingMarks === undefined ? null : JSON.stringify(raster.findingMarks),
              objectKey,
              at,
              Date.parse(at),
            )
            .run(),
        where,
      );
    },

    // Wrapped, so a bucket outage costs this run its renders and not its exit
    // code. The comment that stood here argued the other way — that answering
    // "miss" to an outage turns a broken bucket into a run that is merely slow —
    // and a run that is merely slow is the correct outcome: nothing about the
    // bucket being unreachable changes what any verdict should be. The baseline
    // half above still refuses out loud, where an outage genuinely would.
    renderCache: neverFails({
      async get(digest, identity): Promise<Raster | null> {
        const where = `the render cache for document ${digest}`;
        const row = await guardStore(
          () =>
            db
              .prepare(
                `SELECT identity, document_digest, width, height, missing_fonts, object_key
                   FROM render_cache
                  WHERE project = ? AND identity_digest = ? AND document_digest = ?`,
              )
              .bind(project, identityDigest(identity), digest)
              .first<SidecarRow>(),
          where,
        );
        if (row === null) return null;

        const sidecar = parse(row, where);
        return row.object_key === null
          ? sidecar
          : { ...sidecar, bytes: await fetchBytes(bucket, row.object_key) };
      },

      async put(raster): Promise<void> {
        const digest = identityDigest(raster.identity);
        const where = `the render cache for document ${raster.documentDigest}`;
        const at = now().getTime();
        const objectKey =
          raster.bytes === undefined
            ? null
            : await keep(db, bucket, project, bytesOf(raster.bytes), at);

        await guardStore(
          () =>
            db
              .prepare(
                `INSERT OR REPLACE INTO render_cache
                   (project, identity_digest, document_digest, identity, width, height,
                    missing_fonts, object_key, at_ms)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              )
              .bind(
                project,
                digest,
                raster.documentDigest,
                JSON.stringify(raster.identity),
                raster.width ?? null,
                raster.height ?? null,
                JSON.stringify(raster.missingFonts),
                objectKey,
                at,
              )
              .run(),
          where,
        );
      },
    }),
  };
}

/**
 * The row for this key under this identity, or the most recent one under any
 * other, or nothing.
 *
 * The lookup is deliberately *not* scoped to the caller's identity, which is the
 * `RasterStore` contract's own instruction: returning nothing for a baseline that
 * exists but was written elsewhere reports "we have never seen this", and "we have
 * seen this, on a machine you are not" is a different and much more useful
 * sentence — it is the one that produces `incomparable` instead of a silent
 * re-record.
 *
 * Where the directory store scans siblings in whatever order `readdir` returns,
 * this takes the most recently written. Both satisfy the contract; only one of
 * them gives the same answer twice when three machines have written the subject,
 * and an `incomparable` message that names a different machine on each run is a
 * message nobody can act on.
 */
async function locate(
  db: D1Like,
  project: string,
  key: BaselineKey,
  mine: Digest,
): Promise<{ readonly sidecar: SidecarRow; readonly identityDigest: string } | null> {
  const label = labelOf(key);
  const where = describeRow(project, key, mine);

  const row = await guardStore(
    () =>
      db
        .prepare(
          `SELECT identity, document_digest, width, height, missing_fonts, accessibility,
                  components, finding_marks, object_key, identity_digest
             FROM baselines
            WHERE project = ? AND subject = ? AND label = ?
            ORDER BY (identity_digest = ?) DESC, at_ms DESC
            LIMIT 1`,
        )
        .bind(project, key.subject, label, mine)
        .first<SidecarRow & { readonly identity_digest: string }>(),
    where,
  );

  return row === null ? null : { sidecar: row, identityDigest: row.identity_digest };
}

/**
 * The bytes a row says are there.
 *
 * An absent object is never a miss. The row is the store positively saying a
 * baseline exists; if the bytes are gone, what happened is that half a baseline
 * was destroyed, and reporting that as `new` would destroy the other half while
 * printing success.
 */
async function fetchBytes(bucket: R2Like, objectKey: string): Promise<string> {
  const object = await guardStore(() => bucket.get(objectKey), `the baseline object ${objectKey}`);
  if (object === null) throw halfAPair(`the baseline object ${objectKey}`, objectKey, 'row');
  return base64Of(await guardStore(() => object.arrayBuffer(), `the baseline object ${objectKey}`));
}

/**
 * A sidecar row, checked rather than cast.
 *
 * The columns came out of a database this process did not write in this run —
 * one that may have been written by an older version of this package, or by a
 * `put` that raced a schema change. Believed unchecked, a malformed `identity`
 * becomes a digest taken over nothing and a missing `documentDigest` becomes
 * `undefined` compared against a real one: two invented answers where the honest
 * one is that the record cannot be read.
 */
function parse(row: SidecarRow, where: string): Omit<Raster, 'bytes'> {
  let identity: unknown;
  let missingFonts: unknown;
  let accessibility: unknown;
  let components: unknown;
  let findingMarks: unknown;
  try {
    identity = JSON.parse(row.identity) as unknown;
    missingFonts = JSON.parse(row.missing_fonts) as unknown;
    accessibility = row.accessibility == null ? undefined : (JSON.parse(row.accessibility) as unknown);
    // Absent columns and null columns are the same answer here — a baseline
    // that never recorded this — and both leave the field off the sidecar,
    // where `sidecarFrom` reads absence as *unknown* rather than as *none*.
    components = row.components == null ? undefined : (JSON.parse(row.components) as unknown);
    findingMarks = row.finding_marks == null ? undefined : (JSON.parse(row.finding_marks) as unknown);
  } catch (error) {
    throw new RasterStoreError(
      `${where} holds JSON columns that will not parse: ${messageOf(error)}. ${REFUSAL}.`,
      { cause: error },
    );
  }

  // The dimensions and the object key are one fact recorded twice, and a row
  // where they disagree is refused. Dimensions with no object is half a baseline
  // — the case `halfAPair` exists for — and an object with no dimensions is a
  // picture nothing can be scaled against.
  const sized = row.width != null && row.height != null;
  if (sized !== (row.object_key != null)) {
    throw new RasterStoreError(
      `${where} records ${sized ? 'an image with no object behind it' : 'an object it never took'}: ` +
        'the dimensions and the object key are written together, and one without the other is ' +
        `damage rather than a subject with no pixels. ${REFUSAL}.`,
    );
  }

  const sidecar = sidecarFrom({
    identity,
    missingFonts,
    documentDigest: row.document_digest,
    ...(sized ? { width: row.width, height: row.height } : {}),
    ...(accessibility === undefined ? {} : { accessibility }),
    ...(components === undefined ? {} : { components }),
    ...(findingMarks === undefined ? {} : { findingMarks }),
  });

  if (sidecar === null) {
    throw new RasterStoreError(
      `${where} is not a raster record: it parsed, but does not carry a document digest and ` +
        `the identity that painted it. ${REFUSAL}.`,
    );
  }
  return sidecar;
}

/**
 * One half of the pair without the other.
 *
 * The directory store's `halfAPair`, in the vocabulary of two services rather
 * than two files, and it exists for the same reason: a row with no object and an
 * object with no row both look exactly like a subject nobody has rendered, if the
 * lookup is willing to shrug.
 */
function halfAPair(where: string, objectKey: string, survivor: 'row' | 'object'): RasterStoreError {
  return new RasterStoreError(
    `${where} is half there: the ${survivor} exists and the ` +
      `${survivor === 'row' ? 'object' : 'row'} does not. A baseline is the pair, so one without ` +
      `the other is a corrupted baseline rather than a missing one. ${REFUSAL}. Restore ` +
      `\`${objectKey}\` in the bucket, or delete the row to record the subject afresh.`,
  );
}

function describeRow(project: string, key: BaselineKey, identity: string): string {
  const name = key.label === undefined ? key.subject : `${key.subject} (${key.label})`;
  return `the baseline for ${name} of project ${project} under identity ${identity}`;
}

/**
 * The label as the database stores it, with absence as the empty string — and an
 * empty *supplied* label refused rather than folded into it.
 *
 * SQLite permits NULL in the columns of an ordinary PRIMARY KEY, so a nullable
 * `label` would make two unlabelled baselines for one subject two rows that never
 * collide: the uniqueness that stops a second `put` from replacing the first would
 * silently not exist, and the store would grow a new baseline per run while
 * reporting `unchanged` against whichever one it happened to read.
 *
 * That forces one encoding to mean two things, so the second one is refused at
 * the door. `{ subject: 's', label: '' }` is a caller bug either way; the choice
 * is between diagnosing it and quietly serving it another subject's image.
 */
function labelOf(key: BaselineKey): string {
  if (key.label === '') {
    throw new RasterStoreError(
      'a baseline was addressed with an empty label. This store encodes "no label" as the ' +
        'empty string, so an empty label and no label would be the same baseline — and two ' +
        'subjects sharing one row is a comparison against the wrong image. Pass no `label` ' +
        `at all, or a label with something in it. ${REFUSAL}.`,
    );
  }
  return key.label ?? '';
}
