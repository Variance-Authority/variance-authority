import type { Band, DeltaKind } from './band.js';
import type { Delta } from './diff/delta.js';
import { diffSnapshots } from './diff/index.js';
import { formatSource, resolveSource, type SourceIndex } from './source.js';
import type { NodePath, SemanticSnapshot } from './snapshot.js';

/**
 * Where an instability lives, and what kind it is.
 *
 * Two captures of the *same* subject at the *same* commit are supposed to agree.
 * When they do not, the usual response is to capture again until two agree and
 * proceed — which works, and destroys the only evidence that existed. The
 * disagreement was the finding. A run that resolves it by repetition has paid
 * for the extra captures and learned nothing, and will pay again tomorrow.
 *
 * There is always a cause and always a place. A pixel comparison cannot supply
 * either: it reports that some pixels moved, which is true of every cause
 * equally. The semantic representation can, because the same two captures also
 * carry structure, resolved declarations and geometry — so the question "what
 * moved between two observations of one commit" has an answer in terms of a
 * component, a declaration, and a file.
 *
 * That answer is what makes prevention possible instead of suppression. An
 * animation caught mid-flight is fixed by pausing it, not by masking the region
 * it happens to occupy this week; a clock is fixed at the fixture. Both fixes are
 * at a source location, and both make every later run cheaper — the stabilisation
 * captures stop being needed at all.
 *
 * The honest boundary: when nothing moved semantically and pixels still differ,
 * the cause is below the box tree and **no component is responsible**. Naming one
 * would be inventing a location. That case is reported as its own kind, because
 * "we cannot see it from here" and "nothing is wrong" are different sentences.
 */

export type InstabilityBand =
  | Band
  /** Pixels moved and the box tree did not. Rasterization, compositing, fonts. */
  | 'sub-semantic'
  | 'none';

export interface UnstableProperty {
  readonly property: string;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
}

export interface UnstableLocation {
  readonly component: string;
  readonly bands: readonly Band[];
  readonly properties: readonly UnstableProperty[];

  /** Landmark phrase, e.g. `main → list item 2 of 3`. */
  readonly where?: string;
  readonly path?: NodePath;
  /** Custom property the moving value resolved through, when there is one. */
  readonly token?: string;

  readonly deltas: number;

  /**
   * A conservative reading of the *shape* of the evidence, not a conclusion.
   *
   * Present only where one shape fits and the others do not. Absent is the
   * common case and is not a failure — the location and the moved declarations
   * are the deliverable; this is a hint about where to look first.
   */
  readonly likely?: 'animation' | 'dynamic-content' | 'displacement';
}

export interface Instability {
  readonly stable: boolean;
  readonly band: InstabilityBand;
  /** Ordered by how many deltas landed in each, widest first. */
  readonly locations: readonly UnstableLocation[];
  /** One sentence stating what moved and what that implies. */
  readonly because: string;
}

/** Properties whose movement is characteristic of something still animating. */
const ANIMATED = new Set(['transform', 'opacity', 'filter', 'offset-distance', 'rotate', 'scale', 'translate']);

/**
 * Compare two observations of one subject that ought to be identical.
 *
 * `pixelsDiffer` is supplied by the caller when an image comparison was also
 * taken. It is what separates "stable" from "unstable in a way this tier cannot
 * see", and omitting it means the second answer is unavailable rather than
 * assumed — a subject reported stable on the strength of a comparison nobody
 * made would be the same false negative this system exists to refuse.
 */
export function locateInstability(
  before: SemanticSnapshot,
  after: SemanticSnapshot,
  options: { readonly pixelsDiffer?: boolean } = {},
): Instability {
  // `diffSnapshots` refuses a cross-subject or cross-profile comparison, which
  // is the right failure here: two captures that are not of the same thing
  // cannot be evidence about stability.
  const diff = diffSnapshots(before, after);

  if (diff.deltas.length === 0) {
    if (options.pixelsDiffer === true) {
      return {
        stable: false,
        band: 'sub-semantic',
        locations: [],
        because:
          'two captures of the same subject are identical in structure, resolved style and ' +
          'geometry, and their images are not. The cause is below the box tree — glyph ' +
          'rasterization, compositing, or a font resolving differently — so no component is ' +
          'responsible and there is no source location to fix. This belongs to the ' +
          'environment key, not to the code',
      };
    }

    return {
      stable: true,
      band: 'none',
      locations: [],
      because:
        options.pixelsDiffer === false
          ? 'two captures of the same subject agree in structure, style, geometry and pixels'
          : 'two captures of the same subject agree in structure, style and geometry; no image ' +
            'comparison was supplied, so sub-semantic movement is unobserved rather than absent',
    };
  }

  const locations = group(diff.deltas);

  return {
    stable: false,
    band: worst(diff.deltas.map((delta) => delta.band)),
    locations,
    because: sentence(locations, diff.deltas.length),
  };
}

/**
 * The instability as the thing a person reads, with a file on the end.
 *
 * Same shape as every other report here: a cause per line, and a path an editor
 * opens, because `Spinner` is an identifier and `src/ds/components.tsx:88` is an
 * edit.
 */
export function summarizeInstability(
  instability: Instability,
  options: { readonly source?: SourceIndex; readonly limit?: number } = {},
): string {
  if (instability.stable) return instability.because;

  const limit = options.limit ?? 5;
  const shown = instability.locations.slice(0, limit);

  const lines = shown.map((location) => {
    const file =
      options.source === undefined ? null : resolveSource(location.component, options.source);

    const moved = location.properties
      .slice(0, 3)
      .map((property) =>
        property.from === undefined && property.to === undefined
          ? property.property
          : `${property.property} ${property.from ?? '(absent)'} → ${property.to ?? '(absent)'}`,
      );

    return [
      `  ${location.component} — ${location.deltas} delta(s) in ${location.bands.join(', ')}` +
        (location.likely !== undefined ? ` [likely ${location.likely}]` : ''),
      ...moved.map((line) => `      ${line}`),
      location.properties.length > 3
        ? `      +${location.properties.length - 3} more propert(y|ies) not listed`
        : null,
      location.where !== undefined ? `      in ${location.where}` : null,
      location.token !== undefined ? `      through ${location.token}` : null,
      file !== null ? `      ${formatSource(file)}` : null,
    ]
      .filter((line): line is string => line !== null)
      .join('\n');
  });

  return [
    `[unstable] ${instability.because}`,
    '',
    ...lines,
    ...(instability.locations.length > shown.length
      ? [`  +${instability.locations.length - shown.length} more location(s) not listed`]
      : []),
  ].join('\n');
}

function group(deltas: readonly Delta[]): readonly UnstableLocation[] {
  const byComponent = new Map<
    string,
    {
      bands: Set<Band>;
      properties: Map<string, UnstableProperty>;
      kinds: Set<DeltaKind>;
      where?: string;
      path?: NodePath;
      token?: string;
      count: number;
    }
  >();

  for (const delta of deltas) {
    // `createdBy` names the component whose JSX produced the node; `owners[0]`
    // names the nearest enclosing one. Prefer the author, because a fix is made
    // where the markup is written, not where it ends up.
    const component = delta.createdBy ?? delta.owners?.[0]?.name ?? '(unattributed)';

    const entry = byComponent.get(component) ?? {
      bands: new Set<Band>(),
      properties: new Map<string, UnstableProperty>(),
      kinds: new Set<DeltaKind>(),
      count: 0,
    };

    entry.bands.add(delta.band);
    entry.kinds.add(delta.kind);
    entry.count += 1;

    // A whole-node delta — text, a role, a node appearing — carries no
    // `property`. Reading its absence as "only geometry moved" would file a
    // changing clock under displacement, so the kind is what is consulted and
    // the property list is only ever additive.
    if (delta.property !== undefined && !entry.properties.has(delta.property)) {
      entry.properties.set(delta.property, {
        property: delta.property,
        from: delta.from,
        to: delta.to,
      });
    }

    if (entry.where === undefined && delta.where !== undefined) entry.where = delta.where;
    if (entry.path === undefined) entry.path = delta.path;
    if (entry.token === undefined && delta.token !== undefined) entry.token = delta.token;

    byComponent.set(component, entry);
  }

  return [...byComponent.entries()]
    .map(([component, entry]) => {
      const properties = [...entry.properties.values()];
      return {
        component,
        bands: [...entry.bands],
        properties,
        ...(entry.where !== undefined ? { where: entry.where } : {}),
        ...(entry.path !== undefined ? { path: entry.path } : {}),
        ...(entry.token !== undefined ? { token: entry.token } : {}),
        deltas: entry.count,
        ...(guess(properties, entry.kinds) !== undefined
          ? { likely: guess(properties, entry.kinds)! }
          : {}),
      };
    })
    .sort((a, b) => b.deltas - a.deltas || a.component.localeCompare(b.component));
}

/**
 * Read the shape of the evidence, and only where one reading fits.
 *
 * Deliberately narrow. A guess that fires on ambiguous evidence is worse than no
 * guess: it sends someone to the wrong file with confidence, and the location
 * and the moved declarations — which are facts — get read as if they carried the
 * same certainty as the label.
 */
function guess(
  properties: readonly UnstableProperty[],
  kinds: ReadonlySet<DeltaKind>,
): UnstableLocation['likely'] | undefined {
  // Content that rewrote itself between two captures of one commit. Checked
  // before the others because a changing string also moves the box around it,
  // and the text is the cause while the movement is its consequence.
  if (kinds.has('text-changed')) return 'dynamic-content';

  if (properties.length === 0) {
    // Geometry moved and this component declared nothing at all. Something
    // upstream reflowed it, so the cause is elsewhere and this is only where it
    // landed — which is worth saying, because it is the one reading that points
    // away from the component being named.
    const onlyGeometry = [...kinds].every((kind) => kind === 'rect-changed' || kind === 'node-moved');
    return onlyGeometry ? 'displacement' : undefined;
  }

  if (properties.every((property) => ANIMATED.has(property.property))) return 'animation';

  return undefined;
}

function worst(bands: readonly Band[]): InstabilityBand {
  if (bands.includes('geometry')) return 'geometry';
  if (bands.includes('token')) return 'token';
  if (bands.includes('texture')) return 'texture';
  return 'none';
}

function sentence(locations: readonly UnstableLocation[], deltas: number): string {
  const named = locations.slice(0, 3).map((location) => location.component);
  const rest = locations.length > named.length ? ` (+${locations.length - named.length} more)` : '';

  return (
    `two captures of the same subject at the same commit disagree: ${deltas} delta(s) ` +
    `across ${locations.length} component(s) — ${named.join(', ')}${rest}. ` +
    'This is not noise to retry away; the location below is where it is caused'
  );
}
