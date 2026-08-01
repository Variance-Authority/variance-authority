import type { Raster, RenderDocument, RenderIdentity } from '@variance-authority/core';

/**
 * Rendering — phase two, and the only phase that is allowed to be expensive.
 *
 * One interface, three implementations, and the reason they share it is the
 * economics. Rasterization is machine-bound and slow: 65.4 ms against 3.4 ms for
 * a semantic collection of the same page in the same process (ADR-0010). Every
 * strategy this project has for that cost — defer it, cache it, offload it to a
 * pinned machine, skip it entirely because the semantic tier already decided — is
 * a strategy about *who* implements this method, and none of them is expressible
 * if the pipeline calls a screenshot function directly.
 *
 * So the pipeline knows only that something turns a document into a raster, and
 * whether that something is a page in this process or a container two networks
 * away is a wiring decision made once, at the top.
 */
export interface Renderer {
  /**
   * Who this renderer is, for comparability.
   *
   * Available before the first render, because the durable store has to decide
   * whether a stored baseline is even comparable *before* paying to produce the
   * image it would compare against.
   */
  readonly identity: RenderIdentity;

  render(document: RenderDocument): Promise<Raster>;

  close(): Promise<void>;
}

/**
 * Font families a document declares, as a renderer can check them.
 *
 * Font identities are `family/weight/style/hash` (spec §11.1) because a family
 * name alone does not identify the bytes. A renderer can only check the family —
 * `document.fonts.check` answers "is something by this name available", not "is
 * it the same Inter" — so this extracts the part that is checkable and the rest
 * stays in the identity digest, where a mismatch surfaces as incomparable rather
 * than as a silent difference.
 */
export function familiesOf(fonts: readonly string[]): readonly string[] {
  const families = new Set<string>();
  for (const font of fonts) {
    const family = font.split('/')[0]?.trim();
    if (family !== undefined && family !== '') families.add(family);
  }
  return [...families];
}
