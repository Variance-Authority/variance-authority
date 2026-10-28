import { sep } from 'node:path';

/**
 * A file path as the path of a URL that names the same file.
 *
 * A file name and a URL are two spellings, and a picture's name is already
 * percent-encoded once: the run writes `route:/page` as `route%3A%2Fpage`, so
 * that is the name on disk. Written into a URL as it is, it decodes back to
 * `route:/page` and asks for a file that does not exist, so each segment is
 * encoded again, here and only here. The separators stay `/`, so a relative
 * path stays relative to the page or root it is read against. On Windows
 * `path.relative` separates with `\`, which would otherwise be encoded as `%5C`.
 *
 * The result is a URL, not markup: an attribute still escapes it.
 */
export function urlOfPath(path: string): string {
  const segments = sep === '/' ? path.split('/') : path.replaceAll(sep, '/').split('/');
  return segments.map(encodeURIComponent).join('/');
}
