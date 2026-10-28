import {
  RasterStoreError,
  REFUSAL,
  identityFrom,
  rasterFrom,
  recordFrom,
  sidecarFrom,
  type Described,
  type Found,
  type Relocated,
} from '@variance-authority/raster';

/**
 * The remote store's routes, and how an answer that arrives on one is read.
 *
 * Kept apart from the client in `store.ts` so the rule the client is built on —
 * a store failure is never a verdict — has one place a body becomes a value.
 */

/** A baseline's image and where it was stored: `{ key, identity }` in, `{ found }` back. */
export const BASELINE_FIND_PATH = '/baseline/find';
/** Every baseline a run declared, described in one answer: `{ keys, identity }` in, `{ entries }` back. */
export const BASELINE_WORKING_SET_PATH = '/baseline/working-set';
/** A baseline without its image: `{ key, identity }` in, `{ described }` back. */
export const BASELINE_DESCRIBE_PATH = '/baseline/describe';
/** An accepted image written as a subject's baseline: `{ key, raster }` in, `{ ok: true }` back. */
export const BASELINE_PUT_PATH = '/baseline/put';
/** A rendered image by its document digest: `{ digest, identity }` in, `{ raster }` back. */
export const CACHE_FIND_PATH = '/cache/find';
/** A rendered image kept for the next run that renders the same document: `{ raster }` in. */
export const CACHE_PUT_PATH = '/cache/put';

/**
 * A miss is something the server *said*, never something that failed to arrive.
 *
 * So the field must be present and must be exactly `null`. An empty body, an
 * error page that happens to parse, a future version answering under a different
 * name — all of them are absences of an answer, and the only safe reading of an
 * absent answer is that the run cannot continue.
 */
export function readFound(payload: unknown, endpoint: string): Found | null {
  const body = recordFrom(payload);
  if (body === null || !('found' in body)) {
    throw malformed(endpoint, BASELINE_FIND_PATH, 'no `found` field');
  }
  if (body.found === null) return null;

  const found = recordFrom(body.found);
  const raster = found === null ? null : rasterFrom(found.raster);
  const storedUnder = found === null ? null : identityFrom(found.storedUnder);

  if (found === null || raster === null || storedUnder === null) {
    throw malformed(endpoint, BASELINE_FIND_PATH, 'a `found` that is not a baseline');
  }
  if (typeof found.comparable !== 'boolean') {
    // Never defaulted. Guessing `true` hides a moved machine; guessing `false`
    // blames the machine for every change. Both are causes invented by a parser.
    throw malformed(endpoint, BASELINE_FIND_PATH, '`comparable` missing or not a boolean');
  }

  const relocated = relocatedFrom(found.relocated, endpoint, BASELINE_FIND_PATH);
  return { raster, comparable: found.comparable, storedUnder, ...relocated };
}

/**
 * Where an identity directory kept the baseline, when the server said so.
 *
 * Absent is an answer — the baseline was where the template puts it, which is
 * all a server older than the field can say. A value that will not parse is
 * refused: read as absent, it would settle the subject and leave it at the old
 * path for good.
 */
function relocatedFrom(
  value: unknown,
  endpoint: string,
  path: string,
): { readonly relocated?: Relocated } {
  if (value === undefined) return {};
  const relocated = recordFrom(value);
  if (relocated === null || typeof relocated.from !== 'string' || typeof relocated.to !== 'string') {
    throw malformed(endpoint, path, 'a `relocated` that is not two paths');
  }
  return { relocated: { from: relocated.from, to: relocated.to } };
}

/**
 * The cheap answer, held to the same standard as the expensive one.
 *
 * A description decides whether a subject is compared at all, so a body this
 * client is willing to guess at is a body that can settle a run to `unchanged`
 * on nothing. `documentDigest` in particular: absent, it would compare
 * `undefined` against a real digest, which never matches — a lookup that
 * silently degrades into "always render" and hides a broken server behind a
 * bill for images.
 */
export function readDescribed(payload: unknown, endpoint: string): Described | null {
  const body = recordFrom(payload);
  if (body === null || !('described' in body)) {
    throw malformed(endpoint, BASELINE_DESCRIBE_PATH, 'no `described` field');
  }
  if (body.described === null) return null;

  const described = recordFrom(body.described);
  const storedUnder = described === null ? null : identityFrom(described.storedUnder);

  if (described === null || storedUnder === null) {
    throw malformed(endpoint, BASELINE_DESCRIBE_PATH, 'a `described` that is not a baseline');
  }
  if (typeof described.documentDigest !== 'string') {
    throw malformed(
      endpoint,
      BASELINE_DESCRIBE_PATH,
      '`documentDigest` missing or not a string',
    );
  }
  if (typeof described.comparable !== 'boolean') {
    throw malformed(endpoint, BASELINE_DESCRIBE_PATH, '`comparable` missing or not a boolean');
  }

  // Refused rather than defaulted, for the reason `missingFonts` is below it: a
  // default here is a claim. `true` would report every pixel-less baseline in the
  // suite as a photographed green, and `false` would tell a reader that a suite
  // of real images was never photographed. Neither is a guess a codec may make.
  if (typeof described.pictured !== 'boolean') {
    throw malformed(endpoint, BASELINE_DESCRIBE_PATH, '`pictured` missing or not a boolean');
  }

  // Refused for the same reason: `true` settles one that kept none for good.
  if (typeof described.keepsSnapshot !== 'boolean') {
    throw malformed(
      endpoint,
      BASELINE_DESCRIBE_PATH,
      '`keepsSnapshot` missing or not a boolean, which a server older than this client does not send ' +
        '(tribunal before API 6, or `serveRasterStore` from an earlier `@variance-authority/remote`): ' +
        'upgrade the server first',
    );
  }

  // Refused rather than defaulted to `[]`, and this is the one field here where
  // that distinction changes a verdict. A settled subject reports `unchanged`;
  // if the baseline was painted without a declared font, it must say so in the
  // same sentence. A wire that drops the field and a wire that says "no fonts
  // were missing" are indistinguishable after a default, and the second is the
  // one that gets believed — which is the `stabilization` failure, in the codec
  // that produced it the first time.
  const missingFonts = stringsFrom(described.missingFonts);
  if (missingFonts === null) {
    throw malformed(
      endpoint,
      BASELINE_DESCRIBE_PATH,
      '`missingFonts` missing or not an array of strings',
    );
  }

  // Dropped rather than refused when it will not parse, unlike every field
  // above. Those decide a verdict; this decides only whether a subject is worth
  // *collecting*, and the fallback of a missing list is to collect it — the safe
  // direction, and the one every run took before selection existed.
  const components = stringsFrom(described.components);

  // Dropped rather than refused, on the same reasoning as `components` and with
  // the opposite safe direction: the fallback of a missing list is *this run
  // cannot say when the defect arrived*, which is what a reader is told when no
  // baseline recorded one. Refusing here would fail a run over a sentence.
  const findingMarks = stringsFrom(described.findingMarks);
  const accessibilitySidecar =
    described.accessibility === undefined
      ? undefined
      : sidecarFrom({
          documentDigest: described.documentDigest,
          identity: storedUnder,
          width: 0,
          height: 0,
          missingFonts,
          accessibility: described.accessibility,
        });
  if (described.accessibility !== undefined && accessibilitySidecar === null) {
    throw malformed(endpoint, BASELINE_DESCRIBE_PATH, 'a malformed `accessibility` snapshot');
  }

  return {
    ...(components !== null ? { components } : {}),
    ...(findingMarks !== null ? { findingMarks } : {}),
    documentDigest: described.documentDigest,
    comparable: described.comparable,
    storedUnder,
    pictured: described.pictured,
    keepsSnapshot: described.keepsSnapshot,
    missingFonts,
    ...relocatedFrom(described.relocated, endpoint, BASELINE_DESCRIBE_PATH),
    ...(accessibilitySidecar?.accessibility === undefined
      ? {}
      : { accessibility: accessibilitySidecar.accessibility }),
  };
}

/** An array of strings, or `null` for anything else — including absent. */
function stringsFrom(value: unknown): readonly string[] | null {
  if (!Array.isArray(value)) return null;
  return value.every((entry) => typeof entry === 'string') ? (value as readonly string[]) : null;
}

export function malformed(endpoint: string, path: string, what: string): RasterStoreError {
  return new RasterStoreError(
    `baseline store ${endpoint}${path} answered with ${what}. ${REFUSAL}`,
  );
}

/*
 * Validation, on the client and not on the server.
 *
 * The asymmetry is the point rather than an omission. A server that mis-reads a
 * request produces a 500, which this client reports as a failure and nobody
 * mistakes for an answer. A client that mis-reads a *response* produces a
 * verdict. Only one of those directions can lie, so only one is checked field by
 * field, and each value is rebuilt from checked parts rather than cast into
 * shape — a cast is a claim about data that arrived over a network from software
 * this package does not version.
 *
 * The field-by-field readers themselves live in `@variance-authority/raster`,
 * with the interface they check against, because a sidecar read off a disk and
 * a body read off a socket are the same value arriving by different routes. Two
 * copies would be two ideas of what a baseline is, and the drift would show up
 * as a store that accepts what another refuses.
 */
