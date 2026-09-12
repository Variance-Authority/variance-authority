import type { Raster } from '@variance-authority/core/format';
import {
  RasterStoreError,
  identityFrom,
  sidecarFrom,
  type RasterStore,
} from '@variance-authority/raster';
import { base64Of, bytesOf, type D1Like, type R2Like } from './bindings.js';
import { guardStore } from './guard.js';
import { claimStatement, digestOf, heldKeys, isDigest, keyFor } from './objects.js';
import { ReviewError, number, optionalText, text, type Row } from './review-rows.js';
import type { CandidateImage, SubjectImages } from './review-ingest-types.js';

/**
 * The two writes that reach the bucket: keeping what a run uploaded, and
 * promoting one of those objects to a baseline.
 *
 * Apart from [`review.ts`](./review.ts) because these are the operations with a
 * consequence outside this package. `store` decides what a build keeps;
 * `promote` is what `variance accept` means when it is a click, and it is the
 * reason approving cannot be a flag on a row.
 *
 * The *ordering* around them is argued at the call sites rather than here —
 * objects before rows on the way in, promotion before the decision on the way out
 * — because it is the caller that can get it wrong.
 */

export interface StoredKeys {
  before?: string;
  after?: string;
  diff?: string;
}

/**
 * The three images a subject can carry, in the order a page shows them.
 *
 * `diff` is not sent by any current run — a mask is new bytes whenever anything
 * moved, so content addressing can do nothing for it, and the surface computes
 * one from the two captures when a reviewer asks. It stays here because builds
 * pushed by earlier versions of the CLI carry one and are still served it, and a
 * transport that stopped accepting the field would turn those pushes into
 * subjects with a column nobody filled.
 */
const KINDS = ['before', 'after', 'diff'] as const;

type Kind = (typeof KINDS)[number];

/** One image, resolved to its key, waiting to be told whether it is already here. */
interface Pending {
  readonly subject: string;
  readonly kind: Kind;
  readonly objectKey: string;
  /** Absent when the run sent a digest rather than bytes. */
  readonly bytes?: ArrayBuffer;
}

/**
 * What a build keeps, under keys that are the bytes.
 *
 * The old key carried the build id and the subject, so the same picture arrived
 * at a new key on every run: an unchanged suite of 300 subjects over 200 builds
 * stored 60,000 objects holding 300 images, and the `before` of each run was a
 * second copy of a baseline this deployment had handed the run itself over
 * `/baseline/find`. Addressed by content, the second and every later upload of
 * those bytes is a ledger touch and a row.
 *
 * **A build's images, not a subject's.** This used to run once per subject and
 * do two round trips per image inside that, which on a 300-subject run was some
 * two thousand of them — a quarter of what a paid Worker may spend on a request
 * and forty times what a free one may, to ingest one report. The work is the
 * same and it is asked in three questions instead: which of these keys is the
 * ledger already holding, `put` for the ones it is not, and one `batch` that
 * claims every key the build named. A green suite, where every image is a
 * baseline this deployment handed out, reaches the bucket zero times.
 *
 * The `build` argument survives because it is what this is *about*, and a
 * signature that stopped naming it would make the next reader think a build's
 * images are not a build's — they still are, in `build_subjects`, which is now
 * the only place the association lives.
 */
export async function store(
  db: D1Like,
  bucket: R2Like,
  project: string,
  build: string,
  images: Readonly<Record<string, SubjectImages | undefined>>,
  at: number,
): Promise<ReadonlyMap<string, StoredKeys>> {
  const pending: Pending[] = [];
  for (const [subject, subjectImages] of Object.entries(images)) {
    if (subjectImages === undefined) continue;
    for (const kind of KINDS) {
      const image = subjectImages[kind];
      if (image === undefined) continue;
      pending.push(await pendingOf(project, build, subject, kind, image));
    }
  }

  const held = await heldKeys(
    db,
    project,
    pending.map((each) => each.objectKey),
  );

  // Refused before anything is written, so a build naming one absent digest does
  // not leave the bucket holding the other 599 images of a build that was never
  // recorded. The whole phase is a claim about what this deployment can show.
  for (const each of pending) {
    if (each.bytes === undefined && !held.has(each.objectKey)) throw missing(each, build);
  }

  const put = new Set<string>();
  // Only the ones nothing here holds. A client sends bytes for the images
  // `/review/have` told it we lack, so this is normally the misses and exactly
  // the misses; a second copy of bytes already stored is the same object at the
  // same key, and writing it again buys nothing.
  // Keyed rather than listed, because one object is routinely three images: a
  // subject's `before` is last run's `after` is the baseline, which is the whole
  // point of addressing by content. Writing it once is the saving.
  const sizes = new Map<string, number>();
  for (const each of pending) {
    if (each.bytes !== undefined) sizes.set(each.objectKey, each.bytes.byteLength);
    else if (!sizes.has(each.objectKey)) sizes.set(each.objectKey, 0);
  }

  for (const each of pending) {
    const bytes = each.bytes;
    if (bytes === undefined || held.has(each.objectKey) || put.has(each.objectKey)) continue;
    put.add(each.objectKey);
    await guardStore(() => bucket.put(each.objectKey, bytes), `the stored object ${each.objectKey}`);
  }

  // One subrequest for every claim in the build. The touch matters as much as
  // the insert: `at_ms` is how long nothing has wanted these bytes, and a build
  // referring to an object it did not upload is exactly something wanting them.
  const claims = [...sizes].map(([objectKey, size]) =>
    claimStatement(db, project, objectKey, size, at),
  );
  if (claims.length > 0) {
    await guardStore(
      () => db.batch(claims),
      `${String(claims.length)} stored object(s) of project ${project}`,
    );
  }

  const keys = new Map<string, StoredKeys>();
  for (const each of pending) {
    const subject = keys.get(each.subject) ?? {};
    subject[each.kind] = each.objectKey;
    keys.set(each.subject, subject);
  }
  return keys;
}

/**
 * The key for one image, whether the run sent it or only named it.
 *
 * `digest` is the upload this run did not have to make: it asked
 * `POST /review/have` which of its images this deployment could already produce,
 * and named the ones it could. The claim is re-checked by the caller rather than
 * trusted, for two reasons that are not the same. A client can say anything, and
 * a build recorded against a key with no object is a subject whose picture 404s
 * on the review page. And even an honest client raced the sweep: it asked, the
 * window passed, the object aged out, and the answer it is acting on is no
 * longer true.
 *
 * What this settles is only the shape — bytes get digested, a digest gets
 * checked for being one. Anything that is neither is refused here, because no
 * number of round trips would make it into an image.
 */
async function pendingOf(
  project: string,
  build: string,
  subject: string,
  kind: Kind,
  image: CandidateImage,
): Promise<Pending> {
  if (image.bytes !== undefined) {
    const bytes = bytesOf(image.bytes);
    return { subject, kind, objectKey: keyFor(project, await digestOf(bytes)), bytes };
  }

  if (image.digest === undefined) {
    throw new ReviewError(
      `the \`${kind}\` image of subject "${subject}" in build "${build}" carries neither ` +
        '`bytes` nor `digest`. An image is the bytes, or the digest of bytes this deployment ' +
        'already holds; an entry that is neither describes nothing to look at',
    );
  }
  if (!isDigest(image.digest)) {
    throw new ReviewError(
      `the \`${kind}\` image of subject "${subject}" in build "${build}" names ` +
        `\`${image.digest}\`, which is not a hex SHA-256 of a PNG and therefore not a key ` +
        'this deployment could have answered with',
    );
  }

  return { subject, kind, objectKey: keyFor(project, image.digest) };
}

/**
 * The refusal for a digest this deployment does not hold.
 *
 * Both come out as a refusal naming the subject and the remedy, because the
 * remedy is real — the run still has the bytes on disk, and re-pushing sends
 * them. Recording the subject without its image would be the same failure
 * arriving as a broken page days later.
 */
function missing(pending: Pending, build: string): RasterStoreError {
  return new RasterStoreError(
    `the \`${pending.kind}\` image of subject "${pending.subject}" in build "${build}" was ` +
      'sent as a digest and this deployment does not hold those bytes. Either they were ' +
      'never here or retention collected them between this run asking `/review/have` and ' +
      'posting its build. The run still has the image: push it again and it will be sent in ' +
      'full',
  );
}

/**
 * Approving, as the promotion of an image that already exists.
 *
 * Every field of the baseline comes from what the run uploaded: the bytes from
 * the bucket, the digest and dimensions from the build row, the identity from the
 * build. Nothing is rendered, nothing is measured, and nothing is defaulted — a
 * missing candidate is refused, because the only way to fill the gap would be to
 * paint one, and an approval whose image nobody reviewed is worse than no
 * approval at all.
 */
export async function promote(
  bucket: R2Like,
  baselines: RasterStore,
  db: D1Like,
  project: string,
  build: string,
  subject: string,
  row: Row,
): Promise<void> {
  const key = optionalText(row, 'after_key', 'a build subject');
  const digest = optionalText(row, 'candidate_document_digest', 'a build subject');

  if (key === undefined || digest === undefined) {
    throw new ReviewError(
      `subject "${subject}" of build "${build}" cannot be approved: the run did not upload a ` +
        'candidate for it, and a baseline is an image plus the document it was painted from. ' +
        'Approving would mean rendering one now, which is recording rather than promoting',
    );
  }

  const buildRow = await db
    .prepare('SELECT identity FROM builds WHERE project = ? AND build = ?')
    .bind(project, build)
    .first<Row>();
  const identity = identityFrom(JSON.parse(text(buildRow ?? {}, 'identity', 'a build')) as unknown);

  if (identity === null) {
    throw new ReviewError(
      `build "${build}" does not carry a renderer identity that can be read back, so there is no ` +
        'machine to file the promoted baseline under. A baseline with no identity is one every ' +
        'other machine would compare against and none of them should',
    );
  }

  const object = await bucket.get(key);
  if (object === null) {
    throw new RasterStoreError(
      `the candidate image for ${subject} of build "${build}" is recorded at \`${key}\` and the ` +
        'bucket has no such object. The approval is refused rather than promoting a baseline ' +
        'this deployment cannot produce the bytes for',
    );
  }

  // The document's identity when the push carried it, the build's otherwise.
  //
  // They differ by exactly the scale, and only the first is what a later run
  // looks a baseline up under: `identityFor` folds the document's
  // `deviceScaleFactor` in, while a renderer serving 1x and 2x viewports in one
  // run reports one machine identity with the scale left at 1. Filing under the
  // build's is therefore correct only at 1x, and silently wrong above it — the
  // approval is recorded, the page says so, and no run ever finds the baseline.
  //
  // The fallback is for rows written before the column existed. It reproduces
  // what this service did for all of them, which is right for every 1x suite and
  // is the most that can be said about a row whose real identity was never sent.
  const painted = identityFrom(
    JSON.parse(optionalText(row, 'candidate_identity', 'a build subject') ?? 'null') as unknown,
  );

  const raster: Raster = {
    documentDigest: digest as Raster['documentDigest'],
    identity: painted ?? identity,
    width: number(row, 'candidate_width', 'a build subject'),
    height: number(row, 'candidate_height', 'a build subject'),
    bytes: base64Of(await object.arrayBuffer()),
    missingFonts: strings(optionalText(row, 'candidate_missing_fonts', 'a build subject')),
    ...accessibilityField(
      optionalText(row, 'candidate_accessibility', 'a build subject'),
      painted ?? identity,
    ),
    // Carried through rather than re-derived, because nothing here can derive
    // them: they describe the document that painted this image, and this service
    // has the image. A baseline promoted without the hashes makes a later run
    // rank causes by area, and one promoted without the marks makes it report
    // every standing defect as arriving with the change under review.
    ...listField(row, 'candidate_components', 'components'),
    ...listField(row, 'candidate_finding_marks', 'findingMarks'),
  };

  await baselines.put({ subject }, raster);
}

/**
 * A stored JSON list, put back on the raster under its own name, or absent.
 *
 * Absent and empty stay apart all the way through: a null column is a run that
 * never recorded this, and `[]` is a run that looked and found nothing. Parsed
 * through `sidecarFrom` rather than cast, for the reason every other read here
 * is — the column was written by some other version of this package, and an
 * unreadable list must not become a confident empty one.
 */
function listField(
  row: Row,
  column: string,
  field: 'components' | 'findingMarks',
): Partial<Pick<Raster, 'components' | 'findingMarks'>> {
  const json = optionalText(row, column, 'a build subject');
  if (json === undefined) return {};

  const parsed = sidecarFrom({
    documentDigest: 'candidate',
    identity: PLACEHOLDER_IDENTITY,
    width: 0,
    height: 0,
    missingFonts: [],
    [field]: JSON.parse(json) as unknown,
  });

  // Written out rather than indexed, so the two fields keep their own types and
  // nothing here needs a cast to claim a key it computed.
  if (field === 'components') {
    return parsed?.components === undefined ? {} : { components: parsed.components };
  }
  return parsed?.findingMarks === undefined ? {} : { findingMarks: parsed.findingMarks };
}

/** Stands in for the one field `sidecarFrom` requires and `listField` is not reading. */
const PLACEHOLDER_IDENTITY = {
  renderer: 'candidate',
  engine: 'candidate',
  platform: 'candidate',
  deviceScaleFactor: 1,
  fonts: [],
} as const;

/**
 * The candidate's browser accessibility snapshot, when a client sent one.
 *
 * **No client sends one today, and that is a missing acquisition rather than a
 * dead column.** `variance push` forwards whatever the run wrote beside the
 * candidate, and the run writes a sidecar built from the render cache — which
 * holds the renderer's output and nothing observed about the page. The only
 * thing in the project that acquires a snapshot is the Playwright fixture, and
 * it writes baselines directly rather than through a review. The gap is argued
 * where it is created, in the CLI's `images.ts`.
 *
 * Kept rather than removed because the transport is correct and the column is
 * live in `baselines` — a Playwright run against a remote store puts snapshots
 * there now — so what is missing is one collector field, not this path. It is
 * parsed with the identity the *document* was painted under for the same reason
 * the raster is filed under it: `sidecarFrom` reads the identity it is given,
 * and a snapshot admitted under the machine identity would describe a baseline
 * stored under another.
 */
function accessibilityField(
  json: string | undefined,
  identity: Raster['identity'],
): Pick<Raster, 'accessibility'> {
  if (json === undefined) return {};
  const parsed = sidecarFrom({
    documentDigest: 'candidate',
    identity,
    width: 0,
    height: 0,
    missingFonts: [],
    accessibility: JSON.parse(json) as unknown,
  });
  if (parsed?.accessibility === undefined) {
    throw new ReviewError('the candidate browser accessibility snapshot is malformed');
  }
  return { accessibility: parsed.accessibility };
}

function strings(json: string | undefined): readonly string[] {
  if (json === undefined) return [];
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
}
