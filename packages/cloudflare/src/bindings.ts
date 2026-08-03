/**
 * The platform, named in full, in one file, by us.
 *
 * Every other module here takes a `D1Like` and an `R2Like` and never a
 * Cloudflare type. That is not portability theatre — it is the same rule
 * [ADR-0013](../../../docs/context/adr/0013-packages-are-named-for-their-requirements.md)
 * applies everywhere else in this repository: a package requires what it says it
 * requires. Depending on `@cloudflare/workers-types` would put a global
 * `DOM`-shaped ambient declaration into the build of a package the CLI links
 * against, and it would make the store untestable without a Workers runtime.
 *
 * What is declared below is exactly the surface used, and nothing else. It is
 * structurally satisfied by the real `D1Database` and `R2Bucket` — an operator's
 * Worker passes `env.DB` and `env.BUCKET` straight in and TypeScript accepts it,
 * because a wider interface is assignable to a narrower one.
 *
 * **The cost is stated rather than hidden.** These are hand-written shapes, so a
 * breaking change to D1 or R2 is a runtime failure here rather than a compile
 * error. The mitigation is that the surface is tiny: five methods on D1, three on
 * R2, all of them years old and all of them exercised by the tests through a
 * `node:sqlite`-backed double that runs the same SQL a real D1 would.
 */

/** A value D1 accepts as a bound parameter. D1 has no `bigint` and no `Buffer`. */
export type D1Value = string | number | null | ArrayBuffer;

export interface D1PreparedLike {
  bind(...values: readonly D1Value[]): D1PreparedLike;
  first<Row>(): Promise<Row | null>;
  all<Row>(): Promise<{ readonly results: readonly Row[] }>;
  run(): Promise<unknown>;
}

export interface D1Like {
  prepare(sql: string): D1PreparedLike;

  /**
   * Several statements, committed together or not at all.
   *
   * The whole reason the history backend can satisfy its atomicity requirement
   * on a platform with no `BEGIN`. D1 wraps a batch in an implicit transaction
   * and rolls the whole thing back if any statement fails, which is what
   * [spec 0002](../../../docs/specs/0002-history-store.md) needs: rows without
   * their run leave a change with no denominator, and a run without its rows is
   * a quiet run that was not quiet.
   *
   * **Unverified against the platform.** See the known limits in
   * [spec 0010](../../../docs/specs/0010-cloudflare-review-backend.md) — the
   * double used in tests is genuinely transactional, and the claim that D1 is
   * has never been measured here.
   */
  batch(statements: readonly D1PreparedLike[]): Promise<unknown>;
}

export interface R2ObjectLike {
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface R2Like {
  /** `null` means the bucket answered and there is no such object. */
  get(key: string): Promise<R2ObjectLike | null>;
  /**
   * Existence without the bytes.
   *
   * Here for one reason: `describe` must agree with `find` about whether a
   * baseline exists. A sidecar row whose object is gone would be a description to
   * the cheap lookup and a corrupted pair to the full one, and the verdict would
   * then depend on which question the caller happened to ask. The directory store
   * spends a `stat` for exactly this; this spends a HEAD.
   */
  head(key: string): Promise<unknown | null>;
  put(key: string, value: ArrayBuffer): Promise<unknown>;
  delete(keys: string | readonly string[]): Promise<unknown>;
}

/**
 * The two bindings, together, because nothing here works with one of them.
 *
 * A deployment with a database and no bucket can record that a subject changed
 * and cannot show anyone what it looks like; a deployment with a bucket and no
 * database has images nobody can address. Taking them as a pair means the
 * missing one is a wiring error at construction rather than a `TypeError` on the
 * first request that happens to need it.
 */
export interface VarianceBindings {
  readonly db: D1Like;
  readonly bucket: R2Like;
}

/**
 * Base64 in, `ArrayBuffer` out — the one conversion this package does twice.
 *
 * A `Raster` carries its bytes as base64 precisely so it survives JSON hops, and
 * R2 stores bytes. `atob` is the conversion both Workers and Node 22 have; going
 * through `Buffer` would tie this file to Node and would be the only thing in the
 * package that could not run on the platform it is named for.
 */
export function bytesOf(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

/** The other direction. Chunked, because `String.fromCharCode` has an argument limit. */
export function base64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}
