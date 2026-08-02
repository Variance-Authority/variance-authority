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
  /**
   * Every render input, including the ones only pixels can see.
   *
   * The key a raster baseline must be stored under. Two machines agree on it only
   * if they agree on device pixel ratio as well as everything else — which is why
   * pixel-based tools end up inside a container.
   */
  readonly digest: Digest;

  /**
   * The inputs that can reach the *semantic* representation.
   *
   * This is the key that matters economically. A raster baseline is machine-bound
   * because rasterization is machine-bound, and the usual answer — put the whole
   * pipeline in Docker — pays that cost on every subject of every build in order
   * to stabilise the tier that decides almost nothing.
   *
   * The semantic representation is built from the box tree, and device pixel
   * ratio cannot reach a box tree: layout is in CSS pixels, and a 2× render lays
   * out identically. Measured, not assumed — a DPR change moves 3015 pixels and
   * leaves structure and style byte-identical (journal 0012).
   *
   * So the semantic key omits it, and one semantic baseline is valid on a retina
   * laptop, a non-retina CI runner, and a container alike. The container is then
   * needed only for the raster residue, which the tiering already makes rare.
   *
   * What is *not* omitted: fonts, engine, viewport size, ruleset, allowlist, and
   * the resolved conditions. Each of those genuinely changes the box tree, and
   * dropping one to make baselines more portable would buy portability with
   * false `unchanged` verdicts.
   */
  readonly semanticDigest: Digest;

  readonly inputs: EnvironmentInputs;
}

export function environmentKey(inputs: EnvironmentInputs): EnvironmentKey {
  const shared = {
    profile: inputs.profile,
    engine: inputs.engine,
    ruleset: inputs.ruleset,
    allowlist: inputs.allowlist,
    fonts: [...inputs.fonts].sort(),
    conditions: { ...inputs.conditions },
    assets: { ...inputs.assets },
  };

  // Layout depends on the viewport's size and colour scheme; rasterization also
  // depends on its scale factor. Splitting the viewport is what makes the two
  // keys differ, and it is the only difference between them.
  const { deviceScaleFactor, ...layoutViewport } = inputs.viewport;

  return {
    digest: digestValue({ ...shared, viewport: { ...inputs.viewport } }),
    semanticDigest: digestValue({ ...shared, viewport: layoutViewport }),
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
