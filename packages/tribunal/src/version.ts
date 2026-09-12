import { SCHEMA_VERSION } from './schema.js';

/**
 * What this deployment is, in the two numbers a client can act on.
 *
 * Every symptom of a client newer than its service looks like something else. A
 * `variance push` against a deployment that predates `POST /review/have` uploads
 * every image it is holding, because the question it asks to avoid that is
 * answered 404 and a 404 is read as *nothing is here* — correct, silent, and
 * indistinguishable from a suite that really did change. The same push against a
 * deployment that predates per-document identity records baselines under the
 * machine's identity, and the subject stays `new` after an approval the page
 * reported as recorded.
 *
 * None of that is a bug in either half. It is the two halves being different
 * ages, which is the normal state of a self-hosted service: the deployment is
 * whatever was current the day somebody ran `wrangler deploy`, and the CLI is
 * whatever CI installed this morning. The only defect is that neither end could
 * say so. This route is the sentence they were missing.
 *
 * ## Behind the token, like everything else
 *
 * `worker.ts` authenticates before it routes, on the argument that an
 * unauthenticated 404 hands a stranger a map of the API. This route is that map,
 * so it is inside the same gate — either capability may ask, because both halves
 * of a mismatch need to hear it and only one of them ever holds the review token.
 */

/**
 * The wire contract, bumped when a client can tell the difference.
 *
 * Not the package version, and deliberately not derived from it. A patch release
 * that changes nothing on the wire would move a version string and tell a client
 * to worry; this number moves when what a client may send or expect changes, so
 * a client comparing it against its own is comparing the thing it cares about.
 *
 * - **1** — builds, decisions, changelog. What `0.1.x` served.
 * - **2** — `POST /review/have`, so a push may name bytes by digest; per-document
 *   `identity` on an ingested candidate, so a retina baseline is promoted under
 *   the digest a later run asks for.
 *
 * A client that speaks 2 against a service that speaks 1 works, slowly and with
 * that identity caveat. A client that speaks 1 against a service that speaks 2
 * works, and sends more than it needs to. Neither is an error; both are worth a
 * line on the way past.
 */
export const TRIBUNAL_API = 2;

export const VERSION_PATH = '/version';

/** What {@link VERSION_PATH} answers. */
export interface ServiceVersion {
  /** Always `variance-authority-tribunal`: a client that reached something else should say so. */
  readonly service: 'variance-authority-tribunal';
  readonly api: number;
  /**
   * The row shape this build of the service expects, for an operator reading a
   * failure that is neither the client's nor the code's.
   *
   * A deployment whose database was migrated by a newer `applySchema` than its
   * Worker is a state nothing else surfaces, because the Worker never reads
   * `schema_version` while serving a request — it is an operator's number, and
   * this is where an operator can see it.
   */
  readonly schema: number;
}

export function serviceVersion(): ServiceVersion {
  return { service: 'variance-authority-tribunal', api: TRIBUNAL_API, schema: SCHEMA_VERSION };
}
