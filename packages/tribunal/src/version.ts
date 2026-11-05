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
 * so it is inside the same gate — every capability may ask, because both halves
 * of a mismatch need to hear it and only one of them ever holds the review capability.
 */

/**
 * The wire contract, bumped when a client can tell the difference.
 *
 * Not the package version: this number moves when what a client may send or expect
 * changes, so a client comparing it compares the thing it cares about. A mismatch in
 * either direction works and is worth a line on the way past, never an error.
 *
 * 2 `POST /review/have` and per-document `identity`. 3 the share under `/share/` and
 * its token. 4 concerns. 5 `GET /review/decisions`, and the share token reads what
 * review settled. 6 a baseline keeps its nodes' snapshot. 7 `GET /auth/me`, a run under
 * a GitHub Actions identity, and a decision under the name the credential carries.
 * 8 a concern is raised at `POST /review/concerns/raise`.
 */
export const TRIBUNAL_API = 8;

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
