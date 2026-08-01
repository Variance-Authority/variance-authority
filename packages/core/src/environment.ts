import { digestValue, type Digest } from './hash.js';
import type { ProfileId } from './profile.js';

/**
 * The environment key: a hash of every render input that is not code.
 *
 * The system's central guarantee is *same hash ⇒ same render*. That guarantee is
 * exactly as strong as this key's coverage, and no stronger — an uncovered input
 * (a font that silently changed, an asset served from a URL whose bytes moved)
 * produces two different renders under one key, which is a false `unchanged`.
 *
 * Adding a field here is a mass-invalidation event (spec §7.3) and must be
 * treated as one. Leaving a field out is a correctness bug. When in doubt,
 * include it: over-invalidation costs CI minutes, under-invalidation costs trust.
 */
export interface EnvironmentInputs {
  /** Which collector, and therefore which dimensions exist at all (ADR-0002). */
  readonly profile: ProfileId;

  /** Engine identity. `jsdom@26.1.0`, `chromium@131.0.6778.33`. */
  readonly engine: string;

  /**
   * Normalization ruleset version. Changing the rules changes every hash by
   * design, so the ruleset is a render input like any other.
   */
  readonly ruleset: string;

  /** Computed-style allowlist version. Widening it is also mass invalidation. */
  readonly allowlist: string;

  readonly viewport: Viewport;

  /**
   * Fonts available at render time, as `family/weight/style/contentHash`.
   * A font substitution changes metrics, and therefore geometry, without
   * changing a single byte of code.
   */
  readonly fonts: readonly string[];

  /**
   * Resolved media/feature conditions. ADR-0003 flattens `@media`, `@supports`,
   * and `@container` away from the CSS text, so the conditions they were
   * flattened against must live here or they vanish from the key entirely.
   */
  readonly conditions: Readonly<Record<string, string | boolean | number>>;

  /**
   * External assets keyed by request URL, valued by content hash. URLs are not
   * identities: the same `url(...)` can resolve to different bytes tomorrow.
   */
  readonly assets: Readonly<Record<string, string>>;
}

export interface Viewport {
  readonly width: number;
  readonly height: number;
  readonly deviceScaleFactor: number;
  /** `prefers-color-scheme`, and the reason a theme switch is not a code change. */
  readonly colorScheme: 'light' | 'dark';
}

export interface EnvironmentKey {
  readonly digest: Digest;
  readonly inputs: EnvironmentInputs;
}

export function environmentKey(inputs: EnvironmentInputs): EnvironmentKey {
  return {
    digest: digestValue({
      profile: inputs.profile,
      engine: inputs.engine,
      ruleset: inputs.ruleset,
      allowlist: inputs.allowlist,
      viewport: { ...inputs.viewport },
      fonts: [...inputs.fonts].sort(),
      conditions: { ...inputs.conditions },
      assets: { ...inputs.assets },
    }),
    inputs,
  };
}

/**
 * Explain why two environment keys differ, field by field.
 *
 * Mass invalidation is only survivable if the docket can collapse it to a single
 * named root — "chromium 131→132", "ruleset v3" — and offer one-action
 * re-baselining (spec §7.3). That collapse needs the specific field, so a diff of
 * environments is a product feature, not a debugging aid.
 */
export function diffEnvironments(
  before: EnvironmentInputs,
  after: EnvironmentInputs,
): readonly EnvironmentDelta[] {
  const deltas: EnvironmentDelta[] = [];

  const scalar = (field: EnvironmentField, a: unknown, b: unknown): void => {
    const from = JSON.stringify(a);
    const to = JSON.stringify(b);
    if (from !== to) deltas.push({ field, from, to });
  };

  scalar('profile', before.profile, after.profile);
  scalar('engine', before.engine, after.engine);
  scalar('ruleset', before.ruleset, after.ruleset);
  scalar('allowlist', before.allowlist, after.allowlist);
  scalar('viewport', before.viewport, after.viewport);
  scalar('fonts', [...before.fonts].sort(), [...after.fonts].sort());
  scalar('conditions', before.conditions, after.conditions);
  scalar('assets', before.assets, after.assets);

  return deltas;
}

export type EnvironmentField =
  | 'profile'
  | 'engine'
  | 'ruleset'
  | 'allowlist'
  | 'viewport'
  | 'fonts'
  | 'conditions'
  | 'assets';

export interface EnvironmentDelta {
  readonly field: EnvironmentField;
  readonly from: string;
  readonly to: string;
}
