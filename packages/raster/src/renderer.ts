import type { Raster, RenderDocument, RenderIdentity } from '@variance-authority/core/format';

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

/**
 * What to call the two sides of a refusal.
 *
 * The baseline and this run, almost always; two images handed in from outside,
 * for `observeRasters`. Named rather than built into the sentence so that every
 * refusal is the same sentence about whichever two things were compared.
 */
export interface IncomparableSides {
  readonly stored: string;
  readonly current: string;
}

const BASELINE_AND_RUN: IncomparableSides = { stored: 'the baseline', current: 'this run' };

/**
 * Whether two identities differ by the machine or only by this tool's recipe.
 *
 * `renderer`, `engine`, `platform`, scale and fonts are the machine: what is
 * installed and how it is configured to paint. `stabilization` and
 * `rasterization` are the recipe: what this tool does to a page before and while
 * it is photographed, which moves when variance-authority is upgraded or a
 * renderer option changes, on a machine that did not. The two need opposite
 * actions — compare where the baseline was painted, or adopt this run's images
 * — so a difference is classified before it is described.
 *
 * Each entry is a field that differs, with both values, stored side first. A
 * field the two share is not listed: a reader handed two full descriptions has
 * to find the one that moved by diffing seven fields by eye.
 */
function identityDifference(
  stored: RenderIdentity,
  current: RenderIdentity,
): { readonly machine: readonly string[]; readonly recipe: readonly string[] } {
  const machine = moves([
    ['renderer', stored.renderer, current.renderer],
    ['engine', stored.engine, current.engine],
    ['platform', stored.platform, current.platform],
    ['scale', `${stored.deviceScaleFactor}x`, `${current.deviceScaleFactor}x`],
  ]);
  const fonts = fontsMoved(stored.fonts, current.fonts);
  if (fonts !== undefined) machine.push(fonts);
  const recipe = moves([
    ['stabilization', recorded(stored.stabilization), recorded(current.stabilization)],
    ['rasterization', recorded(stored.rasterization), recorded(current.rasterization)],
  ]);

  return { machine, recipe };
}

/**
 * The fields that moved, as `field a → b`. Fields that moved between the same
 * two values share one entry — a declared painter is its renderer, engine and
 * platform at once, and three copies of one pair of names bury nothing but the
 * sentence.
 */
function moves(fields: readonly (readonly [string, string, string])[]): string[] {
  const merged: { names: string[]; from: string; to: string }[] = [];
  for (const [name, from, to] of fields) {
    if (from === to) continue;
    const same = merged.find((entry) => entry.from === from && entry.to === to);
    if (same === undefined) merged.push({ names: [name], from, to });
    else same.names.push(name);
  }
  return merged.map((entry) => `${entry.names.join(', ')} ${entry.from} → ${entry.to}`);
}

/**
 * The reason a stored image and this run's cannot be compared, for every caller
 * that refuses: the settlement, a baseline lookup, and two rasters handed in.
 *
 * One function so the classification cannot differ between the path that
 * settles without painting and the path that paints and then looks up. A recipe
 * difference is said to be one, with the command that re-baselines; a machine
 * difference keeps the sentence it always had, naming only what moved.
 */
export function incomparableBecause(
  stored: RenderIdentity,
  current: RenderIdentity,
  sides: IncomparableSides = BASELINE_AND_RUN,
): string {
  const { machine, recipe } = identityDifference(stored, current);
  const both = `${sides.stored} and ${sides.current}`;

  if (machine.length === 0 && recipe.length > 0) {
    return (
      `${both} were painted on the same machine under different recipes ` +
      `(${recipe.join(', ')}). The recipe is variance-authority's, not the machine's — ` +
      'an upgrade or a changed renderer option moves it — so this is a re-baseline, ' +
      'not a regression: review the new images and adopt them with `variance accept --all` ' +
      "(or the test runner's update-snapshots flag)"
    );
  }

  // Nothing differs by field and the digests still disagreed: the identity grew
  // a field this function does not know. Both descriptions in full, then, since
  // there is no narrower true sentence.
  if (machine.length === 0) {
    return (
      `${sides.stored} was painted by ${describeIdentity(stored)}, and ${sides.current} by ` +
      `${describeIdentity(current)}; pixels are machine-bound, so the two are not comparable`
    );
  }

  return (
    `${both} differ in the machine that painted them (${machine.join(', ')})` +
    (recipe.length === 0 ? '' : `, and under different recipes (${recipe.join(', ')})`) +
    '; pixels are machine-bound, so the two are not comparable'
  );
}

/** Whether a difference between two identities is the recipe's alone. */
export function recipeOnly(stored: RenderIdentity, current: RenderIdentity): boolean {
  const { machine, recipe } = identityDifference(stored, current);
  return machine.length === 0 && recipe.length > 0;
}

/** A recipe digest as printed, or the fact that none was recorded. */
function recorded(digest: string | undefined): string {
  return digest === undefined ? 'not recorded' : short(digest);
}

/**
 * The fonts that one side declared and the other did not, or `undefined` when
 * the lists are equal. A list printed whole buries the one font that moved.
 */
function fontsMoved(stored: readonly string[], current: readonly string[]): string | undefined {
  if (stored.length === current.length && stored.every((font, i) => font === current[i])) {
    return undefined;
  }
  const gone = stored.filter((font) => !current.includes(font));
  const added = current.filter((font) => !stored.includes(font));
  if (gone.length === 0 && added.length === 0) return 'fonts declared in a different order';
  return `fonts ${[...gone.map((font) => `-${font}`), ...added.map((font) => `+${font}`)].join(' ')}`;
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
