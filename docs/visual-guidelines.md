# Visual guidelines

Variance Authority uses a quiet technical visual language for a tool that makes
visual regression explainable. Geometry, hierarchy and controlled light carry
the meaning. The system is abstract rather than illustrative: it represents
pages, components, baselines and findings with shapes that remain legible at
thumbnail size.

## The mark

The Variance Authority mark is a bottom-rooted fork with one selected route. A
longer path rises from the root, turns at the junction and continues into the
upper-right branch in variance amber. The shorter alternate branch is warm
grey. Together they describe a choice between paths: a baseline, a variant, a
comparison or a finding that needs review.

The mark is a fork, not a triangle, an enclosing monogram or a recursively
subdivided geometric symbol. Do not redraw it as an `A`, a `V`, a triangle or a
generic branching icon. Use the supplied [full logo](../assets/brand/variance-authority-logo.svg)
when the name is needed and the [mark](../assets/brand/variance-authority-mark.svg)
when the available space is square or small.

The fork keeps its right-angle geometry, square line ends and unequal path
lengths. The amber route remains continuous from the bottom root through the
junction to the selected branch. It is never recoloured for decoration.

## Palette

| Token | Value | Role |
| --- | --- | --- |
| Graphite | `#080909` | Primary background and deepest inactive surface |
| Warm graphite | `#18120f` | Ambient background lift |
| Warm ivory | `#d7cec7` | Primary text, cards and observed content |
| Warm grey | `#756d67` | Alternate paths, secondary outlines and inactive structure |
| Quiet grey | `#8f8580` | Labels and supporting text |
| Variance amber | `#ff8a3d` | One active path, change, anomaly or review focus |
| Amber shadow | `#4d3528` | Low-contrast rules and amber structure at rest |
| Signal green | `#7fa28c` | Stable, valid or accepted state; use sparingly |

Graphite is warm rather than blue-black. Ivory replaces pure white. Amber is a
semantic signal: one dominant amber path is stronger than many small orange
accents. Green indicates a positive state only; it does not compete with the
active amber path. Blue, purple, cyan and rainbow gradients are outside the
palette.

This governs brand and illustration assets. The review surface in
[`@variance-authority/tribunal`](../packages/tribunal) is on a light ground with
its own slate and blue, chosen for a verdict UI before this palette existed, and
does not follow it.

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
tool. Use a warm near-black graphite background, warm ivory primary elements,
subdued warm-grey secondary elements, and variance amber as the single semantic
accent for change, anomaly, review or the active path. Use muted sage green only
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

Warm ivory elements may have a soft ambient bloom against graphite. Amber focus
may glow slightly more strongly, but glow clarifies hierarchy rather than
creating a neon or cyberpunk effect. Avoid glossy 3D rendering, volumetric
lighting, organic blobs, waves and decorative texture. A barely visible grain
or dot field is acceptable only when the primary geometry remains dominant.

## Usage rules

- Use the full logo for the repository identity and broad entry surfaces.
- Use the mark for package headers, compact navigation and square placements.
- The standalone mark asset is transparent and tightly cropped. Place it on a
  warm graphite field when the house background is available.
- Keep enough surrounding space to read the fork and its selected route.
- Preserve the supplied proportions, line ends, path relationship and colours.
- Treat amber as a single semantic focus; do not scatter it across a scene.
- Treat green as a status signal, never as a second active path.
- Prefer the mark asset over a hand-drawn approximation.

The logo is an identity asset. The illustration grammar is a construction rule
for anything made from it. Neither requires a realistic product interface to
explain the product.
