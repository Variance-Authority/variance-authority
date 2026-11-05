import type { D1Like, R2Like } from '@variance-authority/tribunal';

/**
 * What this deployment reads, and nothing else.
 *
 * Typed here rather than imported from `@cloudflare/workers-types` for the same
 * reason the package types `D1Like` and `R2Like` itself: the bindings are used
 * through a narrow structural subset, and a dependency on the platform's whole
 * type surface would buy nothing and cost an install.
 */
export interface TribunalEnvironment {
  readonly DB: D1Like;
  readonly BUCKET: R2Like;
  /** Scopes every row and object key. */
  readonly PROJECT: string;
  readonly RETENTION_DAYS?: string;
}
