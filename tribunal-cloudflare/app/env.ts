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
  /** Written into CI. Writes builds, baselines and history. */
  readonly INGEST_TOKEN: string;
  /** Held by this Worker, never by a browser. Reads the review surface and decides. */
  readonly REVIEW_TOKEN: string;
  /** Scopes every row and object key. */
  readonly PROJECT: string;
  readonly RETENTION_DAYS?: string;
  /**
   * The Cloudflare Access team domain, for example `acme.cloudflareaccess.com`.
   *
   * Absent means **no review surface**: this app has an approve button and no
   * accounts of its own, so the identity has to come from somewhere, and a
   * deployment that never said where is not one where the button is safe to draw.
   */
  readonly ACCESS_TEAM_DOMAIN?: string;
  /** The Access application audience tag. Checked, so one team's other app cannot review here. */
  readonly ACCESS_AUD?: string;
}
