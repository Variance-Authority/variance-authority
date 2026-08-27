import { identityDigest, type Digest, type Raster } from '@variance-authority/core';
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
import { base64Of, bytesOf, type D1Like, type R2Like, type TribunalBindings } from './bindings.js';

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
 * `put` writes the object, then the row. The two orders fail differently and only
 * one of them fails safely:
 *
 * - **object first** — a crash between them leaves an object nothing points at.
 *   Invisible to every read, removed by the next sweep, costs storage.
 * - **row first** — a crash between them leaves a row pointing at nothing, which
 *   is a baseline that throws on every subsequent run until a person deletes it.
 *
 * D1 and R2 are separate services with no transaction between them, so one of
 * these happens; this file chooses the one that costs bytes over the one that
 * stops the suite.
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
  readonly width: number;
  readonly height: number;
  readonly missing_fonts: string;
  readonly object_key: string;
  readonly accessibility?: string | null;
}

export function createBucketStore(options: BucketStoreOptions): RasterStore {
  const { db, bucket, project } = options;
  requireProject(project);
  const now = options.now ?? ((): Date => new Date());

  return {
    retention: 'durable',

    async find(key, identity): Promise<Found | null> {
      const mine = identityDigest(identity);
      const row = await locate(db, project, key, mine);
      if (row === null) return null;

      const sidecar = parse(row.sidecar, describeRow(project, key, row.identityDigest));
      return {
        raster: { ...sidecar, bytes: await fetchBytes(bucket, row.sidecar.object_key) },
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
      // depends on which of the two a caller asked is not a verdict.
      if ((await guard(() => bucket.head(row.sidecar.object_key), where)) === null) {
        throw halfAPair(where, row.sidecar.object_key, 'row');
      }

      return {
        documentDigest: sidecar.documentDigest,
        comparable: row.identityDigest === mine,
        storedUnder: sidecar.identity,
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
      const objectKey = baselineKey(project, digest, key);
      const where = describeRow(project, key, digest);
      const at = now().toISOString();

      await guard(() => bucket.put(objectKey, bytesOf(raster.bytes)), where);
      await guard(
        () =>
          db
            .prepare(
              `INSERT INTO baselines
                 (project, identity_digest, subject, label, identity, document_digest,
                  width, height, missing_fonts, accessibility, object_key, at, at_ms)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT (project, identity_digest, subject, label) DO UPDATE SET
                 identity = excluded.identity,
                 document_digest = excluded.document_digest,
                 width = excluded.width,
                 height = excluded.height,
                 missing_fonts = excluded.missing_fonts,
                 accessibility = excluded.accessibility,
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
              raster.width,
              raster.height,
              JSON.stringify(raster.missingFonts),
              raster.accessibility === undefined ? null : JSON.stringify(raster.accessibility),
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
        const row = await guard(
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

        return { ...parse(row, where), bytes: await fetchBytes(bucket, row.object_key) };
      },

      async put(raster): Promise<void> {
        const digest = identityDigest(raster.identity);
        const where = `the render cache for document ${raster.documentDigest}`;
        const objectKey = `${project}/cache/${digest}/${raster.documentDigest}.png`;

        await guard(() => bucket.put(objectKey, bytesOf(raster.bytes)), where);
        await guard(
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
                raster.width,
                raster.height,
                JSON.stringify(raster.missingFonts),
                objectKey,
                Date.now(),
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

  const row = await guard(
    () =>
      db
        .prepare(
          `SELECT identity, document_digest, width, height, missing_fonts, accessibility, object_key,
                  identity_digest
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
  const object = await guard(() => bucket.get(objectKey), `the baseline object ${objectKey}`);
  if (object === null) throw halfAPair(`the baseline object ${objectKey}`, objectKey, 'row');
  return base64Of(await guard(() => object.arrayBuffer(), `the baseline object ${objectKey}`));
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
  try {
    identity = JSON.parse(row.identity) as unknown;
    missingFonts = JSON.parse(row.missing_fonts) as unknown;
    accessibility = row.accessibility == null ? undefined : (JSON.parse(row.accessibility) as unknown);
  } catch (error) {
    throw new RasterStoreError(
      `${where} holds JSON columns that will not parse: ${messageOf(error)}. ${REFUSAL}.`,
      { cause: error },
    );
  }

  const sidecar = sidecarFrom({
    identity,
    missingFonts,
    documentDigest: row.document_digest,
    width: row.width,
    height: row.height,
    ...(accessibility === undefined ? {} : { accessibility }),
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
 * Every call into D1 and R2 goes through here, and every failure of one becomes
 * an operator error.
 *
 * Not a convenience. A `TypeError` from a binding that was never wired, a 500
 * from a bucket, a D1 statement refused because the schema is a version behind —
 * each of them would otherwise propagate as some other kind of exception, and the
 * one thing that must never happen is that any of them is caught somewhere above
 * and read as "no baseline".
 */
async function guard<T>(call: () => Promise<T>, where: string): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new RasterStoreError(
      `the baseline store could not reach its database or its bucket for ${where}: ` +
        `${messageOf(error)}. ${REFUSAL}.`,
      { cause: error },
    );
  }
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

function baselineKey(project: string, identity: Digest, key: BaselineKey): string {
  const name = key.label === undefined ? key.subject : `${key.subject}__${key.label}`;
  return `${project}/baselines/${identity}/${encodeURIComponent(name)}.png`;
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
