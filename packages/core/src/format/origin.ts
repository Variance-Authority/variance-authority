/**
 * The origin a page was served from, and a URL with that origin taken off.
 *
 * A collector serves a build on a free port, so the page's own origin is an
 * accident of the run and never part of what was built. Every identity that
 * holds a URL the page resolved — a `url()` in a computed value, a document's
 * base and its resources — drops it through these two, so they agree on what
 * counts as the page's own.
 *
 * `URL` answers, as it does for the engine that serialized `baseURI`. Only an
 * `http` or `https` page has an origin to take off: `about:blank` and `file:`
 * serialize theirs as `"null"`, and a string that does not parse has none.
 */
export function pageOrigin(baseUrl: string | undefined): string | undefined {
  if (baseUrl === undefined) return undefined;
  let parsed: { readonly origin: string; readonly protocol: string };
  try {
    parsed = new URL(baseUrl);
  } catch {
    return undefined;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : undefined;
}

// `core` builds against ES2022 alone; every host it runs in has the WHATWG `URL`.
declare const URL: {
  new (url: string, base?: string): { readonly origin: string; readonly protocol: string; toString(): string };
};

/**
 * `url` as a path when `origin` serves it, unchanged otherwise.
 *
 * Matched up to the slash that follows the authority, so `:400` never claims
 * `:4001`, and a URL another origin serves keeps its origin.
 */
export function withoutOrigin(url: string, origin: string | undefined): string {
  return origin !== undefined && url.startsWith(`${origin}/`) ? url.slice(origin.length) : url;
}

/**
 * The URL an asset key names, for looking up the bytes a document carries.
 *
 * The inverse of keying through {@link withoutOrigin}: a path the page's origin
 * serves is resolved against the document's `baseUrl`, the URL the browser
 * asked for and the resources are keyed by. An absolute key is returned as it
 * is. A key that does not resolve, or a document with no base, answers the key
 * unchanged, so the lookup that follows misses and says which key it missed.
 */
export function assetUrl(key: string, baseUrl: string | undefined): string {
  if (baseUrl === undefined) return key;
  try {
    return new URL(key, baseUrl).toString();
  } catch {
    return key;
  }
}
