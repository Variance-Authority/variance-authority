import { digestValue, type Digest } from './hash.js';

/**
 * The browser accessibility trees exposed by one Playwright acquisition.
 *
 * `roots[0]` is the subject locator. Remaining roots are React portal contents,
 * in component-tree order, because a portal remains part of the subject even
 * though its DOM lives elsewhere (ADR-0007). The text is Playwright's ARIA
 * snapshot format rather than this project's ARIA approximation: browser
 * visibility, naming and role computation are the boundary being observed.
 */
export interface AccessibilitySnapshot {
  readonly snapshotVersion: 1;
  readonly producer: 'playwright-aria@1';
  readonly engine: string;
  readonly roots: readonly string[];
  readonly digest: Digest;
}

/** Build the canonical, content-addressed form stored beside a raster. */
export function accessibilitySnapshot(
  engine: string,
  roots: readonly string[],
): AccessibilitySnapshot {
  const stableRoots = [...roots];
  return {
    snapshotVersion: 1,
    producer: 'playwright-aria@1',
    engine,
    roots: stableRoots,
    digest: digestValue({
      producer: 'playwright-aria@1',
      engine,
      roots: stableRoots,
    }),
  };
}
