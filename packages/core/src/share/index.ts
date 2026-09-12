/**
 * `@variance-authority/core/share` — one machine's evaluation, reachable from another.
 *
 * A run derives a great deal that is not about the run: what the suite is made
 * of, which subjects exist, every name each one carries, which files declare
 * which components. All of it is a fact about a *commit*, and all of it is
 * expensive — a source scan, a browser, a composition pass — while being
 * identical on every machine that starts from the same tree.
 *
 * So the second machine should not derive it again. A pull-request runner wants
 * what mainline already knows, and mainline already knew it an hour ago on a
 * runner that has since been destroyed. This module is the seam between those
 * two: a place bytes can be left under a key, and a place they can be looked
 * for, with nothing in between that knows what the bytes are.
 *
 * ## The rule, inherited
 *
 * > **A `SharedCache` never throws.**
 *
 * `get` answers `null` for a miss, an outage, a permission error, a truncated
 * body and a response nobody can parse. `put` resolves whether or not anything
 * was written. This is the same rule
 * [`RenderCache`](../../../raster/src/store.ts) is defined by, and it is safe
 * here for the same reason: everything a share holds is derivable from the tree
 * it was derived at. A miss costs the derivation, which is the answer that was
 * always available.
 *
 * What that costs, stated rather than hidden: a cache that is failing looks
 * exactly like a cache that is cold, so a broken share makes CI slow and never
 * makes it red. An operator watching the wall clock has to go looking. The
 * alternative — failing a build because a bucket answered 503 — is worse.
 *
 * ## Why a key is a commit
 *
 * Everything shared here is derived, so the only question a reader has is *of
 * what*, and the answer is a tree. A commit names one; a branch names whichever
 * one it points at this second, and two runners resolving `main` four minutes
 * apart would silently compare against different suites.
 *
 * Mainline moves while a branch is open, though, which is why the lookup is
 * {@link firstShared} over a lineage rather than a single `get`: the runner asks
 * for the commits its branch actually descends from, newest first, and takes the
 * first one anybody published. What it gets back says which commit it is, so a
 * reader is never in doubt about what it is holding.
 *
 * ## What this is not
 *
 * Not a baseline store. A baseline is the thing a comparison is *against*, it
 * cannot be re-derived, and losing one silently is how a suite records whatever
 * happened to be on screen — which is why
 * [`RasterStore`](../../../raster/src/store.ts) throws on every failure and this
 * throws on none. The two are configured separately because they are answers to
 * different questions, and a share is disposable in a way a baseline may never
 * be.
 */

// Declared rather than imported, as elsewhere in this package: `core` takes no
// platform's types, and `fetch` is present in every runtime it targets. Only the
// three members used are named, so a runtime with a narrower one still fits.
declare const fetch: (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: Uint8Array;
  },
) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

/**
 * Bytes under a key, on terms where losing them is free.
 *
 * Deliberately the smallest interface that can carry an evaluation: no listing,
 * no deletion, no expiry. A backend that can do more is welcome to; nothing
 * here may depend on it, because the set of things every one of a directory, an
 * action cache, a bucket and a deployment can do is this.
 */
export interface SharedCache {
  get(key: string): Promise<Uint8Array | null>;
  put(key: string, bytes: Uint8Array): Promise<void>;
}

/**
 * Hold an implementation to the rule.
 *
 * Backends are built out of a disk, a socket or a bucket, every one of which
 * throws, and every one of them would otherwise have to remember not to.
 * Wrapping at construction makes the rule a property of the value rather than a
 * promise in a comment.
 */
export function neverFails(cache: SharedCache): SharedCache {
  return {
    async get(key): Promise<Uint8Array | null> {
      try {
        return await cache.get(key);
      } catch {
        // A miss and a failure are the same instruction: derive it.
        return null;
      }
    },
    async put(key, bytes): Promise<void> {
      try {
        await cache.put(key, bytes);
      } catch {
        // Nothing to report and nothing to retry. The next run publishes again.
      }
    },
  };
}

/**
 * The key an artifact is published under.
 *
 * `project` is a namespace and not a secret: two suites in one monorepo share a
 * bucket and must not share a key. `artifact` names the format, so a reader that
 * does not understand version 2 of something asks for a key version 2 was never
 * written to rather than parsing bytes it will reject.
 */
export function shareKey(parts: {
  readonly project: string;
  readonly artifact: string;
  readonly commit: string;
}): string {
  return `${segment(parts.project)}/${segment(parts.artifact)}/${segment(parts.commit)}.bin`;
}

/** What a lookup over a lineage found, and where. */
export interface SharedHit {
  /** The commit the bytes were published at — never the one that was asked for first. */
  readonly commit: string;
  /** How many commits back that was, zero being the newest candidate offered. */
  readonly behind: number;
  readonly bytes: Uint8Array;
}

/**
 * The newest published artifact among commits this tree descends from.
 *
 * Newest-first because a nearer ancestor is a better description of the same
 * suite, and `behind` is returned rather than discarded because it is the one
 * number that tells an operator their publishing is failing: a share that is
 * always forty commits behind is a share nothing is writing to, and it is
 * otherwise indistinguishable from a healthy one.
 *
 * Stops at the first hit rather than collecting all of them. There is no merge
 * across generations to perform — an evaluation describes one tree — and asking
 * a network for forty keys that will be discarded is the cost this exists to
 * avoid.
 */
export async function firstShared(
  cache: SharedCache,
  lineage: readonly string[],
  of: (commit: string) => string,
): Promise<SharedHit | null> {
  for (let behind = 0; behind < lineage.length; behind += 1) {
    const commit = lineage[behind]!;
    const bytes = await cache.get(of(commit));
    if (bytes !== null) return { commit, behind, bytes };
  }
  return null;
}

/**
 * A cache in this process, for tests and for a run that shares with itself.
 *
 * Kept here rather than in a test helper because it is also the honest answer
 * to "share, but I have nowhere to put it": the seam is exercised, the code
 * path is the real one, and nothing survives the process.
 */
export function memoryShare(): SharedCache {
  const held = new Map<string, Uint8Array>();
  return {
    async get(key) {
      return held.get(key) ?? null;
    },
    async put(key, bytes) {
      held.set(key, bytes.slice());
    },
  };
}

/** What an HTTP share needs to reach its endpoint. */
export interface HttpShareOptions {
  /** Base URL. A key is appended to it, with exactly one `/` between. */
  readonly endpoint: string;
  /** Sent on every request. A bucket wants `Authorization`; a signed URL wants nothing. */
  readonly headers?: Readonly<Record<string, string>>;
  /** The verb a write uses. `PUT` for a bucket, `POST` for a deployment that routes on it. */
  readonly method?: 'PUT' | 'POST';
}

/**
 * A share over HTTP: `GET` to read, `PUT` to write, the key as the path.
 *
 * One backend rather than four because a bucket, a signed URL, a static host
 * and a tribunal deployment differ in exactly two ways — the base and the
 * headers — and every one of them speaks this. S3 with `PUT` object access is
 * this with an `Authorization` header; a presigned base is this with none; a
 * deployment is this with a token. Writing three clients would have produced
 * three sets of error handling for an object whose entire error handling is
 * "return null".
 *
 * Nothing here signs anything. Credentials that must be computed per request —
 * SigV4 against a raw bucket — belong to whatever already holds the operator's
 * credentials, and the shape that reaches this is a base URL it produced. That
 * keeps a secret out of this package and out of the config file it would
 * otherwise have to be written in.
 */
export function httpShare(options: HttpShareOptions): SharedCache {
  const base = options.endpoint.replace(/\/+$/, '');
  const headers = options.headers ?? {};
  return {
    async get(key) {
      const response = await fetch(`${base}/${key}`, { headers });
      // A 404 is the common answer and not an event. Every other refusal is
      // read the same way, because the caller's response to all of them is one
      // response, and a cache that distinguished them would be inviting a
      // caller to act on the difference.
      if (!response.ok) return null;
      return new Uint8Array(await response.arrayBuffer());
    },
    async put(key, bytes) {
      await fetch(`${base}/${key}`, {
        method: options.method ?? 'PUT',
        headers: { 'content-type': 'application/octet-stream', ...headers },
        body: bytes,
      });
    },
  };
}

/**
 * One path segment, with everything that is not a key character removed.
 *
 * A project name comes from a config file and a commit from `git`, and both end
 * up in a URL and on a filesystem. Escaping would be reversible and is not
 * wanted: a name that needs escaping is a name whose two spellings should not
 * address two different entries, so the mapping is deliberately many-to-one and
 * the cost of a collision is a cache miss.
 */
function segment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '');
  return cleaned === '' ? 'unnamed' : cleaned;
}
