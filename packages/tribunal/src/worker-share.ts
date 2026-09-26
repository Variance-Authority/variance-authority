import { linePath, type ShareLine } from '@variance-authority/core/share';
import type { R2Like, R2PutOptions, R2Written } from './bindings.js';
import { digestOf } from './objects.js';
import { sharable, type Granted } from './worker-auth.js';
import { BadRequest, MethodNotAllowed, json } from './worker-http.js';

/**
 * A share, served: the store an `http` share with this deployment as its
 * endpoint reads and writes.
 *
 * The protocol is `httpLineCell`'s, from `@variance-authority/core/share`, and
 * nothing here adds to it. A line is a manifest and the entries it names; the
 * images every line names sit beside the lines, so an image two lines name is
 * stored once:
 *
 * ```
 * /share/<mainline|branch>/<line…>/manifest.json
 * /share/<mainline|branch>/<line…>/entries/<sha256>
 * /share/images/<sha256>
 * ```
 *
 * ## The manifest is the only conditional write
 *
 * Blobs are addressed by the SHA-256 of their bytes, so writing one twice
 * writes the same thing, and this checks the digest rather than trusting it: a
 * blob stored under a digest it does not have would be read back by every
 * reader as a corrupt entry. The manifest is replaced only on the version it was
 * read at — `If-Match` on its `ETag`, or `If-None-Match: *` when the writer found
 * no manifest — and a write whose version is stale answers 412. That status is
 * the one `publishLine` reads as a lost race, so the losing writer reads the
 * winner's manifest, adds its own entries to it, and writes again.
 *
 * The comparison is R2's own `onlyIf`, and the version is R2's own `httpEtag`.
 * Nothing here reads the stored manifest to compare it, because a read and a
 * write are two requests and another writer fits between them.
 *
 * ## Not the baseline store
 *
 * A share holds what a run derived and can derive again, so it has no ledger
 * rows, no retention and no sweep, and its keys sit under `<project>/share/`
 * where the sweep never looks. Losing one costs the derivation; a baseline is
 * the other kind of thing, and the two are kept apart for that reason.
 */

/** Every route in this file starts here, and nothing else in the router does. */
export const SHARE_PREFIX = '/share/';

/** What this file needs from the deployment: its bucket, and the project its keys are under. */
export interface ShareSurface {
  readonly bucket: R2Like;
  readonly project: string;
}

/** Answers one request under {@link SHARE_PREFIX}, for the capability the router granted. */
export type ShareRoute = (granted: Granted, path: string, request: Request) => Promise<Response>;

// TODO: nothing deletes a share's objects. A branch line outlives its branch,
// and an image no manifest names any more stays in the bucket; both need a
// sweep that reads every manifest under the project, which R2Like's missing
// `list` rules out today.
export function createShareRoutes({ bucket, project }: ShareSurface): ShareRoute {
  const keyOf = (path: string): string => `${project}/share/${path}`;

  return async (granted, path, request) => {
    const writes = request.method === 'PUT' || request.method === 'POST';
    if (!writes && request.method !== 'GET' && request.method !== 'HEAD') {
      throw new MethodNotAllowed(
        `${path} is read with GET and written with PUT or POST, not ${request.method}`,
        'GET, HEAD, PUT, POST',
      );
    }

    sharable(granted, writes, path);
    const relative = addressOf(path);
    const key = keyOf(relative.path);

    if (!writes) {
      const found = await stored(`the share object ${key}`, () => bucket.get(key));
      if (found === null) return json(404, { error: `this share holds nothing at ${path}` });
      const headers: Record<string, string> = {
        'content-type': 'application/octet-stream',
        etag: found.httpEtag,
        // A manifest is replaced by every publish, so a cached one is a stale
        // version; an entry or an image never changes, because its name is its
        // digest.
        'cache-control': relative.blob ? 'private, max-age=31536000, immutable' : 'no-cache',
      };
      return new Response(request.method === 'HEAD' ? null : await found.arrayBuffer(), { headers });
    }

    const bytes = await request.arrayBuffer();
    if (relative.blob) {
      const digest = await digestOf(bytes);
      if (digest !== relative.digest) {
        throw new BadRequest(
          `${path} names the digest ${relative.digest}, and the bytes sent have the digest ` +
            `${digest}. A blob is stored under its own digest, so a reader can check what it reads`,
        );
      }
    }

    const options = relative.blob ? undefined : conditionOf(request);
    const written: R2Written | null = await stored(`the share object ${key}`, () =>
      bucket.put(key, bytes, options),
    );
    if (written === null) {
      return json(412, {
        error:
          `the manifest at ${path} changed after it was read, so this write would drop what the ` +
          'other writer added. Read it again and write the result',
      });
    }
    return new Response(null, { status: 204, headers: { etag: written.httpEtag } });
  };
}

type Address =
  | { readonly path: string; readonly blob: false }
  | { readonly path: string; readonly blob: true; readonly digest: string };

/**
 * The key a share path addresses, relative to `<project>/share/`, or a 400.
 *
 * A line's name must be the one `linePath` would give it. That is the client's
 * own rule for spelling a line, and holding a writer to it keeps two spellings
 * of one line — `release/2.0` and `release//2.0` — from becoming two lines, and
 * keeps every segment a plain file name for the directory bucket.
 */
function addressOf(path: string): Address {
  const image = /^\/share\/images\/([0-9a-f]{64})$/.exec(path);
  if (image?.[1] !== undefined) return { path: `images/${image[1]}`, blob: true, digest: image[1] };

  const entry = /^\/share\/(mainline|branch)\/(.+)\/entries\/([0-9a-f]{64})$/.exec(path);
  if (entry?.[1] !== undefined && entry[2] !== undefined && entry[3] !== undefined) {
    const line = lineOf(entry[1], entry[2], path);
    return { path: `${line}/entries/${entry[3]}`, blob: true, digest: entry[3] };
  }

  const manifest = /^\/share\/(mainline|branch)\/(.+)\/manifest\.json$/.exec(path);
  if (manifest?.[1] !== undefined && manifest[2] !== undefined) {
    return { path: `${lineOf(manifest[1], manifest[2], path)}/manifest.json`, blob: false };
  }

  throw new BadRequest(
    `${path} is not a share path. A share answers /share/<mainline|branch>/<line>/manifest.json, ` +
      '/share/<mainline|branch>/<line>/entries/<sha256> and /share/images/<sha256>',
  );
}

function lineOf(kind: string, name: string, path: string): string {
  const line: ShareLine = { kind: kind as ShareLine['kind'], name };
  const spelled = linePath(line);
  if (spelled !== `${kind}/${name}`) {
    throw new BadRequest(
      `${path} names the line ${JSON.stringify(name)}, which a share spells ${spelled}. Line ` +
        'names are the segments `linePath` keeps: letters, digits, `.`, `_` and `-`',
    );
  }
  return spelled;
}

/**
 * The condition a manifest write carries, in R2's terms.
 *
 * `If-Match` comes back exactly as the `ETag` went out, quoted, and R2 compares
 * unquoted, so the quotes and a weak marker are taken off. A header naming more
 * than one version is refused rather than narrowed to one of them, because the
 * writer asked for something this cannot honour.
 */
function conditionOf(request: Request): R2PutOptions | undefined {
  const match = request.headers.get('if-match');
  const noneMatch = request.headers.get('if-none-match');
  const onlyIf: { etagMatches?: string; etagDoesNotMatch?: string } = {};
  if (match !== null) onlyIf.etagMatches = versionOf(match, 'If-Match');
  if (noneMatch !== null) onlyIf.etagDoesNotMatch = versionOf(noneMatch, 'If-None-Match');
  return match === null && noneMatch === null ? undefined : { onlyIf };
}

function versionOf(header: string, name: string): string {
  const value = header.trim();
  if (value === '*') return value;
  const version = /^(?:W\/)?"([^",]*)"$/.exec(value)?.[1];
  if (version === undefined) {
    throw new BadRequest(`${name} must name one version, as the ETag spelled it; received ${value}`);
  }
  return version;
}

/**
 * A bucket call whose failure says it was the share's.
 *
 * The router answers anything it does not recognise with a 500, and a 500 is
 * what `httpLineCell` reads as *unreachable* — a miss that costs the reader a
 * derivation, never a wrong answer.
 */
async function stored<T>(where: string, call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new Error(
      `the share could not reach its bucket for ${where}: ` +
        (error instanceof Error ? error.message : String(error)),
      { cause: error },
    );
  }
}
