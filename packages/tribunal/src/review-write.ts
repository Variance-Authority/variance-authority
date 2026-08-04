import type { Raster } from '@variance-authority/core';
import { RasterStoreError, identityFrom, type RasterStore } from '@variance-authority/raster';
import { base64Of, bytesOf, type D1Like, type R2Like } from './bindings.js';
import { ReviewError, number, optionalText, text, type Row } from './review-rows.js';
import type { SubjectImages } from './review-types.js';

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

export async function store(
  bucket: R2Like,
  project: string,
  build: string,
  subject: string,
  images: SubjectImages | undefined,
): Promise<StoredKeys> {
  if (images === undefined) return {};

  const keys: StoredKeys = {};
  const prefix = `${project}/builds/${encodeURIComponent(build)}/${encodeURIComponent(subject)}`;

  for (const kind of ['before', 'after', 'diff'] as const) {
    const image = images[kind];
    if (image === undefined) continue;
    const key = `${prefix}.${kind}.png`;
    await bucket.put(key, bytesOf(image.bytes));
    keys[kind] = key;
  }
  return keys;
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

  const raster: Raster = {
    documentDigest: digest as Raster['documentDigest'],
    identity,
    width: number(row, 'candidate_width', 'a build subject'),
    height: number(row, 'candidate_height', 'a build subject'),
    bytes: base64Of(await object.arrayBuffer()),
    missingFonts: strings(optionalText(row, 'candidate_missing_fonts', 'a build subject')),
  };

  await baselines.put({ subject }, raster);
}

function strings(json: string | undefined): readonly string[] {
  if (json === undefined) return [];
  const parsed: unknown = JSON.parse(json);
  return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
}
