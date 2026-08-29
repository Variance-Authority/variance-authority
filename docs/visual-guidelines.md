# Visual guidelines

Variance Authority uses a quiet technical visual language for a tool that makes
visual regression explainable. Geometry, hierarchy and controlled light carry
the meaning. The system is abstract rather than illustrative: it represents
pages, components, baselines and findings with shapes that remain legible at
thumbnail size.

## The mark

The Variance Authority mark is a folded ribbon `VA`. Two charcoal strokes
descend as the `V` and the `A`; between them one ribbon rises, folds at its
apex and descends again in variance orange, with a darker facet where the fold
turns away from the light. The orange ribbon is the selected variant among
otherwise identical paths: a baseline, a variant, a comparison or a finding
that needs review.

The mark is a ribbon lockup, not an outline monogram, a triangle or a generic
branching icon. Do not redraw it from strokes, round its corners or add an
enclosing shape. Use the supplied [full logo](../assets/brand/variance-authority-logo.svg)
when the name is needed, the [mark](../assets/brand/variance-authority-mark.svg)
when the available space is square or small, and the
[avatar](../assets/brand/variance-authority-github.svg) where a circular
organisation or account image is required.

The ribbons keep their flat facets, straight edges and shared angle. The orange
ribbon stays continuous from its lower point through the fold to its opposite
descent, and its shadow facet stays subordinate to it. Neither is recoloured
for decoration. The charcoal ribbons invert to ivory under a dark colour scheme;
the orange does not change.

## Palette

| Token | Value | Role |
| --- | --- | --- |
| Charcoal | `#24282A` | The mark's structural ribbons, headings and primary text |
| Deep charcoal | `#181B1D` | Circular avatar field and deepest inactive surface |
| Ivory | `#F3F4F6` | Light-on-dark counterpart to charcoal; cards and observed content |
| Warm grey | `#756d67` | Alternate paths, secondary outlines and inactive structure |
| Quiet grey | `#8f8580` | Labels and supporting text |
| Variance orange | `#FF4A19` | One active path, change, anomaly or review focus |
| Fold shadow | `#D83A13` | The turned facet of the orange ribbon; orange structure at rest |
| Signal green | `#7fa28c` | Stable, valid or accepted state; use sparingly |

Charcoal is a neutral near-black rather than blue-black. Ivory replaces pure
white. Orange is a semantic signal: one dominant orange path is stronger than
many small accents, and the fold shadow belongs to that path rather than
standing on its own. Green indicates a positive state only; it does not compete
with the active orange path. Blue, purple, cyan and rainbow gradients are
outside the palette.

This governs brand and illustration assets and the review surface in
[`@variance-authority/tribunal`](../packages/tribunal) alike. The review surface
spends the palette on a deep charcoal ground and adds two hues the brand assets
have no use for: an amber and a red, for the two things only a verdict UI has to
say — *this was not observed* and *this was refused*. Orange keeps its meaning
there and is never spent on chrome: it marks the cause, and nothing else.

## Shape and line grammar

Build illustrations from a small vocabulary:

- modestly rounded rectangular browser or content fragments;
- small circular nodes and precise connector lines;
- branches, junctions and convergence points;
- comparison pairs, grids and restrained concentric geometry;
- one focused card or region that carries the active state.

Rectangles have modest corner radii, never soft product-dashboard rounding.
Lines are thin and controlled. Nodes are small. Circles and halos identify a
relationship or a focus point, not empty decoration. A panel may use subtle
transparency and a faint border, but its surface remains flat.

## Composition

Each illustration communicates one visual idea. Prefer one of these structures:

- one-to-many branching;
- many-to-one convergence;
- before and after;
- baseline and current;
- divergence at one junction;
- an isolated anomaly;
- a comparison that ends in review.

Use three to seven major objects at most and leave substantial negative space
around them. The composition stays understandable without labels and remains
clear when reduced. Background dot grids, alignment points and construction
circles are optional, faint and subordinate to the subject.

## Illustration generation grammar

Use this stable grammar when generating a new visual:

```text
Create a minimal abstract technical illustration for a professional developer
tool. Use a near-black charcoal background, ivory primary elements, subdued
warm-grey secondary elements, and variance orange as the single semantic accent
for change, anomaly, review or the active path. Use muted sage green only
for a stable or positive state.

Build from simplified rectangular UI fragments, small circular nodes, thin
precise connector lines, branches, convergence points and restrained geometric
indicators. Use one clear visual metaphor, three to seven major objects and
substantial negative space. Keep text absent unless a tiny functional label is
necessary. Use modest corner radii, flat surfaces, thin outlines and restrained
warm ambient glow. Make the result precise, quiet, technical and legible at
thumbnail size.

Do not create a complete interface, dashboard, machinery, fictional device,
folder, paperwork, stamp, character, game UI, isometric scene, dense diagram,
decorative sci-fi prop, excessive text, excessive glow, triangle logo or blue,
purple, cyan or rainbow SaaS gradient.
```

The subject changes from illustration to illustration; the grammar stays
stable. Branching, divergence, convergence and isolation are recurring motifs,
not requirements to include every time.

## Typography

The wordmark uses a narrow sans-serif with generous tracking. Product-facing
prose uses the host surface's readable sans serif. Illustrations use little or
no text. When a label is necessary, use a short functional term such as
`baseline`, `current` or `review`; the geometry must carry the explanation.

## Light and surfaces

Ivory elements may have a soft ambient bloom against charcoal. Orange focus
may glow slightly more strongly, but glow clarifies hierarchy rather than
creating a neon or cyberpunk effect. Avoid glossy 3D rendering, volumetric
lighting, organic blobs, waves and decorative texture. A barely visible grain
or dot field is acceptable only when the primary geometry remains dominant.

## Usage rules

- Use the full logo for the repository identity and broad entry surfaces.
- Use the mark for package headers, compact navigation and square placements.
- Use the avatar for circular organisation, account and app-icon placements.
- The standalone mark asset is transparent and tightly cropped, and inverts its
  charcoal ribbons under a dark colour scheme. Place it on a charcoal field when
  the house background is available.
- Keep enough surrounding space to read all three ribbons and the fold.
- Preserve the supplied proportions, facets, ribbon relationship and colours.
- Treat orange as a single semantic focus; do not scatter it across a scene.
- Treat green as a status signal, never as a second active path.
- Prefer the mark asset over a hand-drawn approximation.

The logo is an identity asset. The illustration grammar is a construction rule
for anything made from it. Neither requires a realistic product interface to
explain the product.
