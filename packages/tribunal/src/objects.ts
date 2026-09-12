import { guardStore } from './guard.js';
import type { D1Like, D1PreparedLike, R2Like } from './bindings.js';

/**
 * One object per picture, addressed by what is in it.
 *
 * Three writers put bytes in the bucket — a promoted baseline, a render cache
 * entry, and the images a build uploads — and until this file existed each of
 * them derived its key from *where the bytes came from*: the identity that
 * painted them, the document digest, the build id. None of those is a fact about
 * the picture, so two byte-identical PNGs always landed at two keys. An
 * unchanged suite of S subjects over B builds stored S x (B + 1) objects holding
 * S distinct images, and approving one of them copied an image the bucket
 * already had, through this process, twice.
 *
 * Keyed by content, all of that collapses into a pointer. The candidate a run
 * uploaded, the `before` the next run uploads, and the baseline they are both
 * copies of are one object with three rows naming it, and a promotion writes a
 * row and no bytes.
 *
 * ## What the dedupe costs, and what pays for it
 *
 * Separate keys made deletion trivial: a build's `before` could not possibly be
 * the baseline, because the baseline was somewhere else. Sharing one object
 * means an object may only be removed when nothing refers to it any more — and
 * `R2Like` has no `list`, deliberately, so "nothing refers to it" cannot be
 * answered by scanning the bucket. `objects` is the ledger that makes it a
 * query: every key this package writes gets a row, and the sweep deletes the
 * ones no referencing table names.
 *
 * That ledger also closes a hole that predates content keys. `store.ts` said an
 * object written before its row "is removed by the next sweep"; it never was,
 * because every key the sweep knew about came from a row, and an object whose
 * row was never written has none. Those were unreachable forever. Now they are
 * ordinary unreferenced rows.
 *
 * ## Write order, again
 *
 * The ledger row goes in **before** the object, which is the opposite of the
 * order `store.ts` argues for its baselines — and for the same reason. There, a
 * row without an object is a baseline that throws on every run, so the object
 * goes first and a crash costs bytes. Here the row claims nothing except that a
 * key may exist: a ledger row whose object is missing makes the next write of
 * those bytes notice the gap and fill it, and makes the sweep issue a delete for
 * an object that is already gone. Both are harmless. The other order would
 * leave an object with no ledger row, which is precisely the unreachable orphan
 * this table exists to abolish.
 *
 * ## The ledger is the answer, and the `head` is gone
 *
 * Existence used to be a ledger read **and** a `head` per key, on the argument
 * that a row says a key was claimed rather than that the bytes survived. The
 * argument was right and the price was not payable. A Worker spends a
 * subrequest on every binding call, D1 and R2 alike, and the budget is 50 on
 * the free plan and 10,000 on a paid one: a `/review/have` naming a suite's
 * 600 images cost 1,200 of them, and ingesting a 300-subject build cost about
 * 2,100 — a two-order-of-magnitude breach of one ceiling and a fifth of the
 * other, for a check on a window that opens only when a process dies between
 * two adjacent writes.
 *
 * So the row is the answer, and the two places where missing bytes actually
 * matter check the bytes themselves, because they are about to read them:
 * `review.image` refuses to call a missing object "the run kept none", and
 * `promote` refuses to file a baseline it cannot produce. What a stale row now
 * costs is a broken image on a review page instead of a refused ingest — and
 * the remedy for both was always the same, which is to push the run again.
 *
 * ## Everything here is shaped by two numbers
 *
 * D1 binds at most **100 parameters per query**, so a set of keys is asked
 * about {@link CHUNK} at a time. And a `batch` is one subrequest however many
 * statements it carries, so every write below that happens per key happens in
 * one.
 */

/** Hex SHA-256 of the bytes. `crypto.subtle` is in Workers and in Node. */
export async function digestOf(bytes: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** A digest is hex SHA-256 and nothing else; anything else is not a key of ours. */
export function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

/**
 * Where bytes with this digest live, composed rather than looked up.
 *
 * The whole saving of content addressing is that a client holding the bytes
 * knows the key without asking, so this is the one derivation both ends make.
 */
export function keyFor(project: string, digest: string): string {
  return `${project}/objects/${digest}.png`;
}

/**
 * How many keys one query may name.
 *
 * D1 binds at most 100 values per statement and `project` is one of them, so 99
 * is the ceiling rather than a tuning knob. Named because two callers chunk on
 * it and a number that drifted apart in one of them would produce a platform
 * error in whichever query happened to be given a hundredth key.
 */
export const CHUNK = 99;

/** `list`, in groups of at most {@link CHUNK}. */
function chunked<T>(values: readonly T[]): readonly (readonly T[])[] {
  const groups: T[][] = [];
  for (let at = 0; at < values.length; at += CHUNK) groups.push(values.slice(at, at + CHUNK));
  return groups;
}

/**
 * Which of these digests this deployment can already produce the bytes for.
 *
 * The question a run asks before it uploads anything: on an unchanged suite
 * every `before` is a baseline this service handed the run itself, and every
 * `after` is the object that baseline already is — so the honest answer to
 * "what should I send" is usually *nothing*.
 *
 * Answered from the ledger, one query per {@link CHUNK} digests. It used to be
 * a query **and** a `head` per digest, serially: a suite asking about 600
 * images spent 1,200 subrequests and about eighteen seconds of round trips to
 * answer a question whose whole purpose was to save work. Why the `head` went
 * rather than moving is argued at the top of this file.
 *
 * A digest is not touched here. Answering a question is not a reference, and an
 * object kept alive by being asked about would never age out of a project whose
 * CI polls it every run; the reference is the row the ingest writes, and
 * `keep`'s touch is what refreshes idleness on the way in.
 */
export async function have(
  db: D1Like,
  project: string,
  digests: readonly string[],
): Promise<readonly string[]> {
  const asked = [...new Set(digests)].filter((digest) => isDigest(digest));
  const held = await heldKeys(db, project, asked.map((digest) => keyFor(project, digest)));
  return asked.filter((digest) => held.has(keyFor(project, digest)));
}

/**
 * Which of these object keys the ledger holds, in groups of {@link CHUNK}.
 *
 * The shared half of `have` and of the ingest's claim phase, which asks the
 * same question about the keys a whole build named at once rather than one
 * image at a time.
 */
export async function heldKeys(
  db: D1Like,
  project: string,
  keys: readonly string[],
): Promise<ReadonlySet<string>> {
  const held = new Set<string>();
  for (const group of chunked([...new Set(keys)])) {
    const rows = await guardStore(
      () =>
        db
          .prepare(
            `SELECT object_key FROM objects
              WHERE project = ? AND object_key IN (${group.map(() => '?').join(', ')})`,
          )
          .bind(project, ...group)
          .all<{ readonly object_key: string }>(),
      `${String(group.length)} stored object(s) of project ${project}`,
    );
    for (const row of rows.results) held.add(row.object_key);
  }
  return held;
}

/**
 * The statement that claims a key, whether or not the ledger already has it.
 *
 * One shape for both cases, so a caller writing a hundred of them writes one
 * batch rather than branching per key. `size` is only set on insert: a row that
 * already exists was written with the byte length of the same content, and the
 * key is the content.
 */
export function claimStatement(
  db: D1Like,
  project: string,
  objectKey: string,
  size: number,
  now: number,
): D1PreparedLike {
  return db
    .prepare(
      `INSERT INTO objects (project, object_key, size, at_ms) VALUES (?, ?, ?, ?)
         ON CONFLICT (project, object_key) DO UPDATE SET at_ms = excluded.at_ms`,
    )
    .bind(project, objectKey, size, now);
}

/**
 * Store these bytes and answer with the key they are under.
 *
 * Two writes and no reads. It used to open with a ledger read and a `head` to
 * decide whether the `put` could be skipped, which is three round trips to
 * avoid one — and the decision was nearly always "write it", because a client
 * only sends bytes for images `have` has just told it this deployment does not
 * hold. Writing them unconditionally is cheaper in the common case and is the
 * only branch that is correct in the rare one, where the ledger has the row and
 * the bucket lost the object: the caller is holding the bytes that fill the gap.
 *
 * The row goes first, and `put` is what makes the claim true. See the note on
 * write order above.
 *
 * The insert refreshes `at_ms` on conflict. The column is not the object's age,
 * it is how long nothing has wanted it: an object rewritten by every run of a
 * green suite is never idle, and the sweep's window is over idleness rather
 * than over birth.
 */
export async function keep(
  db: D1Like,
  bucket: R2Like,
  project: string,
  bytes: ArrayBuffer,
  now: number = Date.now(),
): Promise<string> {
  const objectKey = keyFor(project, await digestOf(bytes));
  const where = `the stored object ${objectKey}`;

  await guardStore(
    () => claimStatement(db, project, objectKey, bytes.byteLength, now).run(),
    where,
  );
  await guardStore(() => bucket.put(objectKey, bytes), where);
  return objectKey;
}

/**
 * Take a reference to bytes a client says are already here, or answer `null`.
 *
 * The ingest half of {@link have}, and separate from it because the two do
 * different things to the ledger. `have` answers a question and changes nothing;
 * this one is about to write a row that points at the object, so it refreshes
 * idleness first — closing the window in which a sweep running between the
 * client's question and the client's build could collect an object the build is
 * on its way to referring to.
 *
 * `null` means the gap was real: the object was not here when the build named
 * it. The caller refuses the ingest rather than recording a subject whose image
 * cannot be produced.
 *
 * One digest at a time, which a whole build's worth of images is not: an ingest
 * asks `heldKeys` once for all of them and batches the touches. This stays for
 * the caller holding one.
 */
export async function claim(
  db: D1Like,
  project: string,
  digest: string,
  now: number = Date.now(),
): Promise<string | null> {
  if (!isDigest(digest)) return null;
  const objectKey = keyFor(project, digest);
  if (!(await heldKeys(db, project, [objectKey])).has(objectKey)) return null;

  await guardStore(
    () =>
      db
        .prepare('UPDATE objects SET at_ms = ? WHERE project = ? AND object_key = ?')
        .bind(now, project, objectKey)
        .run(),
    `the stored object ${objectKey}`,
  );
  return objectKey;
}

/**
 * The keys in the ledger that nothing refers to any more, oldest claim first.
 *
 * One query rather than a list the caller assembles, because the caller cannot
 * know what else points at the object it just unlinked. A build's `after` is
 * also, routinely, the baseline it was promoted to and the `before` of every
 * later build — the whole point of content keys — so "this build is gone,
 * therefore its images are" stopped being true the moment two rows could name
 * one object.
 *
 * `idleSince` is what keeps this from racing its own writers. A key is only a
 * candidate once nothing has stored, re-stored or matched those bytes for the
 * whole retention window, so an object written seconds ago whose referencing row
 * is still being inserted is nowhere near the result.
 */
export async function unreferenced(
  db: D1Like,
  project: string,
  idleSince: number,
  limit = 1000,
): Promise<readonly string[]> {
  const rows = await guardStore(
    () =>
      db
        .prepare(
          `SELECT o.object_key AS object_key
             FROM objects o
            WHERE o.project = ? AND o.at_ms < ?
              AND NOT EXISTS (SELECT 1 FROM baselines b WHERE b.object_key = o.object_key)
              AND NOT EXISTS (SELECT 1 FROM render_cache c WHERE c.object_key = o.object_key)
              AND NOT EXISTS (
                    SELECT 1 FROM build_subjects s
                     WHERE s.after_key = o.object_key
                        OR s.before_key = o.object_key
                        OR s.diff_key = o.object_key)
            ORDER BY o.at_ms
            LIMIT ?`,
        )
        .bind(project, idleSince, limit)
        .all<{ readonly object_key: string }>(),
    'the unreferenced objects of this project',
  );

  return rows.results.map((row) => row.object_key);
}

/**
 * Remove those objects and stop claiming them. Bytes first: see the note above.
 *
 * Chunked at {@link R2_DELETE}, because R2 takes at most a thousand keys in one
 * delete and `unreferenced` defaults to exactly a thousand. Sitting on a
 * platform ceiling is not the same as being under it: the first person to raise
 * that default, for any reason, would have found out from R2.
 */
export async function discard(
  db: D1Like,
  bucket: R2Like,
  project: string,
  keys: readonly string[],
): Promise<void> {
  if (keys.length === 0) return;
  const where = `${String(keys.length)} unreferenced object(s) of project ${project}`;

  for (let at = 0; at < keys.length; at += R2_DELETE) {
    const group = keys.slice(at, at + R2_DELETE);
    await guardStore(() => bucket.delete(group), where);
    await guardStore(
      () =>
        db.batch(
          group.map((key) =>
            db
              .prepare('DELETE FROM objects WHERE project = ? AND object_key = ?')
              .bind(project, key),
          ),
        ),
      where,
    );
  }
}

/** How many keys R2 removes in one call. */
const R2_DELETE = 1000;
