import type { SourceIndex, SubjectRef } from '@variance-authority/core';

/**
 * What a test declares about one subject, and what each declaration decides.
 *
 * Split from `fixture.ts` so the shape an adopter reads is not buried in the
 * machinery that consumes it: every field here is a fact only the test holds,
 * and the reason each one could not be defaulted is the documentation.
 */

export interface VarianceOptions {
  /**
   * What the baseline is keyed on. Defaults to the test's title path.
   *
   * A default derived from titles means renaming a test orphans its baseline,
   * which is the right failure — `new` rather than a silent comparison against
   * something else — and is still worth overriding for anything long-lived.
   */
  readonly subjectId?: string;

  /** Defaults to `route`, which is what a navigated page is. */
  readonly subjectKind?: SubjectRef['kind'];

  /**
   * Fonts this machine is asserted to have, as `family/weight/style/hash`.
   *
   * Omitted here it stays omitted: the collector says so in a diagnostic rather
   * than putting a confident value in the environment key. Supplying it is what
   * makes a baseline written on a machine with a different font stack report
   * `incomparable` instead of being compared.
   */
  readonly fonts?: readonly string[];

  /** Component to file. Without it the docket names components and no lines. */
  readonly source?: SourceIndex;

  /** Milliseconds to wait for the subject's Suspense boundaries. Defaults to 5000. */
  readonly suspenseTimeoutMs?: number;

  /**
   * This subject's *loading* state is what is being captured.
   *
   * The escape hatch. Without it, a subtree still showing a Suspense fallback
   * **throws** rather than being recorded: a baseline over a skeleton that was
   * never meant to be one turns every faster machine into a regression, and a
   * failed assertion here is the only thing that reaches the person who can
   * decide which of the two states this test is about.
   */
  readonly loading?: boolean;

  /**
   * Read the framework wiring of each node — props, context, hook cells, keys.
   * Defaults to `true`.
   *
   * On because the fixture already walks the fiber tree for provenance, and
   * wiring is the dimension that says *a prop moved* about a subtree whose
   * markup did not. It is a band of its own rather than part of `rendering`, so
   * a subject that never had it read still hashes to what it hashed before.
   *
   * Off is for a page this project's adapter cannot read anyway — a non-React
   * surface driven by the same suite — where the walk buys an absent band at the
   * price of visiting every node.
   */
  readonly wiring?: boolean;

  /**
   * Read the held state behind each node — the digests of the application values
   * a component was rendered with. Defaults to `false`.
   *
   * Opt-in rather than symmetric with `wiring`, because it changes what a
   * `structureHash` is: a node carrying a holding suppresses the inert-wrapper
   * collapse, so the same subject read with holdings and without produces two
   * different structures. Both sides of a comparison must therefore be read the
   * same way, and a test that sets this on one spec and not another is comparing
   * a subject against a differently-read baseline.
   */
  readonly holdings?: boolean;
}

export interface InPlaceCaptureOptions {
  readonly kind: 'in-place';
  /** Must describe the browser launch owned by the Playwright configuration. */
  readonly browser: {
    readonly headless: boolean;
    readonly launchArgs: readonly string[];
  };
  /** Independent screenshots required to agree. Defaults to 2; minimum 2. */
  readonly stabilityChecks?: number;
}

export type MaterializationOptions =
  | { readonly kind: 'deferred' }
  | InPlaceCaptureOptions;
