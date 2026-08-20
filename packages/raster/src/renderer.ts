import type { Raster, RenderDocument, RenderIdentity } from '@variance-authority/core';

/**
 * Rendering — phase two, and the only phase that is allowed to be expensive.
 *
 * One interface, three implementations, and the reason they share it is the
 * economics. Rasterization is machine-bound and slow — roughly 18× a semantic
 * collection of the same page in the same process, measured by
 * `examples/todomvc`'s pixel arm at 54.0 ms against 3.0 ms and, on an earlier
 * machine, 65.4 against 3.4. The multiple is the durable half. Every
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
   * Who this renderer is: the machine, not the image.
   *
   * Available before the first render, because the durable store has to decide
   * whether a stored baseline is even comparable *before* paying to produce the
   * image it would compare against.
   *
   * **Incomplete on purpose.** `deviceScaleFactor` is a property of the
   * *document* — the viewport declares it, and one renderer serves documents at
   * several scales in one run — so the value here is whatever the renderer
   * defaults to and is not the value the next raster will carry. Nothing may key
   * a store on this identity; see {@link Renderer.identityFor}.
   */
  readonly identity: RenderIdentity;

  /**
   * The identity {@link Renderer.render} will stamp on *this* document's raster.
   *
   * The lookup key and the write key have to be the same value, and for a while
   * they were not: baselines were written under the raster's identity, which
   * carries the document's scale, and looked up under the renderer's, which
   * carries 1. At 1x the two coincide and everything works. Above 1x the lookup
   * never finds its own baseline — it finds it again under a *sibling* identity
   * and reports `incomparable`, on every run, forever, in a sentence blaming a
   * machine difference that does not exist. Worse in the other direction: a 1x
   * baseline is found under the 1x key and called comparable, so a 2x image is
   * diffed against a 1x one and the result is reported as a change.
   *
   * On the interface rather than computed by the caller because only the
   * renderer knows how it will stamp an identity. A caller deriving the key
   * would be asserting on a renderer's behalf, which is how the two keys drifted
   * apart the first time. The cost is one more method on every implementation.
   */
  identityFor(document: Pick<RenderDocument, 'viewport'>): RenderIdentity;

  render(document: RenderDocument): Promise<Raster>;

  close(): Promise<void>;
}

/**
 * The machine identity, plus the scale this document asks to be painted at.
 *
 * Shared so the local and remote renderers cannot answer `identityFor`
 * differently — an offloaded render whose identity is computed by one rule on
 * the client and another on the server writes baselines nobody looks up, which
 * is the failure {@link Renderer.identityFor} exists to close.
 *
 * Only the scale is folded in. Everything else in {@link RenderIdentity} is a
 * fact about the machine that a document cannot change; a renderer that
 * genuinely varies more than the scale per document must not use this.
 */
export function identityAtScale(
  identity: RenderIdentity,
  document: Pick<RenderDocument, 'viewport'>,
): RenderIdentity {
  return { ...identity, deviceScaleFactor: document.viewport.deviceScaleFactor };
}

/**
 * An identity as a sentence, for the reader of a refusal.
 *
 * One function because every refusal in this package is a claim that two
 * identities differ, and a reader comparing two differently-formatted strings
 * has to work out whether the formatting or the machine is what moved. The
 * scale is spelled out for the same reason it is the field that goes wrong.
 */
export function describeIdentity(identity: RenderIdentity): string {
  // Every field the digest covers, because a refusal that omits one can print
  // two identical sentences about two different identities — which is what it
  // did, for as long as `stabilization` was being dropped by the wire codec. A
  // reader then sees "these are not comparable" beside one machine described
  // twice and has nowhere to go.
  //
  // The two digests are abbreviated rather than dropped: what a reader needs is
  // *whether they differ*, and sixteen characters of hash answers that while a
  // font list and a recipe printed in full would bury the sentence.
  const fonts = identity.fonts.length === 0 ? 'no fonts declared' : `fonts ${short(digestOf(identity.fonts))}`;
  const recipe =
    identity.stabilization === undefined
      ? 'no stabilization recorded'
      : `stabilization ${short(identity.stabilization)}`;
  const rasterization =
    identity.rasterization === undefined
      ? 'no rasterization recipe recorded'
      : `rasterization ${short(identity.rasterization)}`;

  return (
    `${identity.renderer} (${identity.engine}, ${identity.platform}, ` +
    `${identity.deviceScaleFactor}x, ${fonts}, ${recipe}, ${rasterization})`
  );
}

/** Last eight characters of a `v1:`-prefixed digest, or of whatever was given. */
function short(digest: string): string {
  return digest.slice(-8);
}

/**
 * A stable short name for a font list.
 *
 * Not a cryptographic digest — this is only ever printed, never compared by
 * anything but a person reading two lines. What it has to do is differ when the
 * lists differ, which a length and a checksum do.
 */
function digestOf(fonts: readonly string[]): string {
  let hash = 0;
  for (const character of fonts.join('\u0000')) {
    hash = (Math.imul(hash, 31) + character.codePointAt(0)!) | 0;
  }
  return `${fonts.length}/${(hash >>> 0).toString(16).padStart(8, '0')}`;
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
