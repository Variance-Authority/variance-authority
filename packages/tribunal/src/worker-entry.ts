import { declaredPolicy, createTribunal, type Tribunal } from './worker.js';
import type { D1Like, R2Like } from './bindings.js';
import { reviewPage } from './ui/page.js';
import { isPagePath } from './ui/route.js';

/**
 * The deployable Worker: `createTribunal` answers `fetch` over a `D1Like` and an
 * `R2Like`, and a Worker needs a module whose default export has that method. This
 * is the one file in the Worker that reads an environment.
 *
 * ## Why the instance is memoised
 *
 * `declaredPolicy` validates what was declared and `createTribunal` builds the
 * routing table. An isolate serves many requests, and rebuilding per request would
 * re-run those checks and refetch every issuer's keys on every call — which is not a correctness problem and is a pointless one. The
 * cache is keyed on the `env` object identity rather than held unconditionally,
 * so a different environment cannot be served by an instance built from another.
 *
 * ## Why a bad environment answers 500 rather than throwing at import
 *
 * A Worker that throws while constructing its module fails deployment-wide with a
 * platform error the operator has to go and find. Every refusal in this package
 * is a sentence, and the one an operator most needs — *your token is too short*,
 * *github is declared and needs GITHUB_CLIENT_SECRET* — is worth more than an exception trace. So the
 * construction happens inside `fetch` and its message is the body.
 *
 * ## The page, and what it loads
 *
 * The document is answered here so a fresh deployment has a review surface with
 * nothing written by hand. `/ui/review.js` and the fonts are static files in the
 * deployment's `assets` directory, which Cloudflare matches before this runs.
 */

export interface TribunalEnv {
  /** D1 binding. Provisioned by `wrangler.jsonc`; the schema is in `migrations/`. */
  readonly DB: D1Like;
  /** R2 binding. Holds baseline and candidate bytes; never a row. */
  readonly BUCKET: R2Like;
  /**
   * Scopes every row and object.
   *
   * A deployment setting today, which is exactly what
   * [spec 0014](https://github.com/Variance-Authority/variance-authority/blob/main/docs/specs/0014-hosted-who-the-caller-is-and-what-the-bill-counts.md)
   * says has to change before a second tenant exists: the credential should
   * establish the project, and no route should accept one. Harmless while a
   * deployment serves one project, and the whole of the problem at two.
   */
  readonly PROJECT?: string;
  /** Days of builds the sweep keeps. Absent means the package default. */
  readonly RETENTION_DAYS?: string;
  /** Everything `declaredPolicy` reads: who this deployment recognizes. */
  readonly [declared: string]: unknown;
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
    policy: declaredPolicy(env),
    // `Number(undefined)` is NaN and `Number('')` is 0, and a retention of zero
    // days would sweep every build the first time anyone asked. Both fall back.
    ...(Number.isFinite(retentionDays) && retentionDays > 0 ? { retentionDays } : {}),
  });

  built.set(env, made);
  return made;
}

/**
 * The module a Worker deployment names as its `main`, or re-exports from its
 * own: `export { default } from '@variance-authority/tribunal/worker-entry'`.
 * `fetch` and the scheduled sweep, over the tribunal built from that environment.
 */
export default {
  async fetch(request: Request, env: TribunalEnv): Promise<Response> {
    try {
      // Built before the page too, so a deployment that cannot start says why at `/`.
      const tribunal = tribunalFor(env);
      if (request.method === 'GET' && isPagePath(new URL(request.url).pathname)) {
        return new Response(reviewPage({ endpoint: '' }), {
          headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
        });
      }
      return await tribunal.fetch(request);
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

  /** The schedule `wrangler.jsonc` names. Retention nobody has to remember. */
  async scheduled(_controller: unknown, env: TribunalEnv): Promise<void> {
    await tribunalFor(env).sweep();
  },
};
