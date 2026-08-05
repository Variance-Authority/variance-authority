import { createTribunal, type Tribunal } from './worker.js';
import type { D1Like, R2Like } from './bindings.js';

/**
 * The deployable Worker: the twenty lines that were missing between a package and
 * a running service.
 *
 * Everything below this file is platform-free by design — `worker.ts` composes
 * routes over a `D1Like` and an `R2Like` and names no Cloudflare type. That is
 * why the package is testable without a Workers runtime, and it is also why it
 * had **no entry point at all**: `createTribunal` returns an object with a
 * `fetch` method, and a Worker needs a module whose default export has one. The
 * two are one adapter apart, and until now the adapter did not exist, so the
 * surface shipped and could not be deployed.
 *
 * This file is the only one in the package that reads an environment.
 *
 * ## Why the instance is memoised
 *
 * `createTribunal` validates the secrets and builds the routing table. An isolate
 * serves many requests, and rebuilding per request would re-run the token checks
 * on every call — which is not a correctness problem and is a pointless one. The
 * cache is keyed on the `env` object identity rather than held unconditionally,
 * so a different environment cannot be served by an instance built from another.
 *
 * ## Why a bad environment answers 500 rather than throwing at import
 *
 * A Worker that throws while constructing its module fails deployment-wide with a
 * platform error the operator has to go and find. Every refusal in this package
 * is a sentence, and the one an operator most needs — *your token is too short*,
 * *your two tokens are the same* — is worth more than an exception trace. So the
 * construction happens inside `fetch` and its message is the body.
 */

export interface TribunalEnv {
  /** D1 binding. Provisioned by `wrangler.jsonc`; the schema is in `migrations/`. */
  readonly DB: D1Like;
  /** R2 binding. Holds baseline and candidate bytes; never a row. */
  readonly BUCKET: R2Like;
  /** Written into CI. Writes builds, baselines and history. 16 characters or more. */
  readonly INGEST_TOKEN: string;
  /** Held by people. Reads the review surface and decides. 16 characters or more. */
  readonly REVIEW_TOKEN: string;
  /**
   * Scopes every row and object.
   *
   * A deployment setting today, which is exactly what
   * [spec 0014](../../../docs/specs/0014-hosted-who-the-caller-is-and-what-the-bill-counts.md)
   * says has to change before a second tenant exists: the credential should
   * establish the project, and no route should accept one. Harmless while a
   * deployment serves one project, and the whole of the problem at two.
   */
  readonly PROJECT?: string;
  /** Days of builds `POST /review/sweep` keeps. Absent means the package default. */
  readonly RETENTION_DAYS?: string;
}

const built = new WeakMap<object, Tribunal>();

function tribunalFor(env: TribunalEnv): Tribunal {
  const found = built.get(env);
  if (found !== undefined) return found;

  const retentionDays = Number(env.RETENTION_DAYS);
  const made = createTribunal({
    db: env.DB,
    bucket: env.BUCKET,
    project: env.PROJECT ?? 'default',
    ingestToken: env.INGEST_TOKEN ?? '',
    reviewToken: env.REVIEW_TOKEN ?? '',
    // `Number(undefined)` is NaN and `Number('')` is 0, and a retention of zero
    // days would sweep every build the first time anyone asked. Both fall back.
    ...(Number.isFinite(retentionDays) && retentionDays > 0 ? { retentionDays } : {}),
  });

  built.set(env, made);
  return made;
}

export default {
  async fetch(request: Request, env: TribunalEnv): Promise<Response> {
    try {
      return await tribunalFor(env).fetch(request);
    } catch (error) {
      // Only construction failures reach here — `Tribunal.fetch` answers with a
      // status rather than throwing. The message is the operator's, and it names
      // the setting rather than the stack.
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : 'this deployment is misconfigured',
        }),
        { status: 500, headers: { 'content-type': 'application/json' } },
      );
    }
  },
};
