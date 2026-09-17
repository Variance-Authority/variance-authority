# Visual guidelines

Variance Authority uses a quiet technical visual language for a tool that makes
visual regression explainable. Geometry, hierarchy and controlled light carry
the meaning. The system is abstract rather than illustrative: it represents
pages, components, baselines and findings with shapes that remain legible at
thumbnail size.

## Where the visuals live

Nothing in this repository generates an image. There is no illustration script,
no model call and no raster pipeline; every visual here was authored by hand as
SVG and committed. Three kinds exist:

- **Brand assets** — `assets/brand/variance-authority-logo.svg`,
  `assets/brand/variance-authority-mark.svg` and
  `assets/brand/variance-authority-github.svg`. The mark is copied
  byte-identically to `site/public/mark.svg` and to `packages/<name>/mark.svg`
  in every workspace package, and each package manifest lists `mark.svg` in its
  `files` array. No script performs that copy: edit `assets/brand/` first, then
  overwrite the copies. `tools/surface.check.ts` fails if a package stops
  publishing its copy.
- **Figures** — React components holding inline SVG, under
  `site/app/components/`. A figure reaches a documentation page through
  `site/app/components/DocumentFigure.tsx`, which switches on the page slug. The
  Markdown pages under `docs/` carry no images of their own; `docs/journeys.md`
  gets its figure because that file has a `case "journeys"`.
- **Committed rasters** — the icons and `og.png` under `site/public/`, and
  `examples/readme-case/artifacts/*.png`, which are a recorded run's own output
  rather than artwork.

Everything below therefore binds hand-authored SVG. The one exception is marked
where it appears: [the illustration prompt](#illustration-generation-grammar) is
for an image generator that lives outside this repository, and no illustration
it produces is committed here.

### Adding a figure

1. Write `site/app/components/<Name>.tsx` with a default-exported component.
   Give the `<svg>` a `viewBox` and size it with a class (`className="block
   h-auto w-full"`) rather than fixed `width`/`height` attributes, so it scales
   with its column.
2. Use the literal hex values from [Palette](#palette). The figure components
   write hex directly — they do not read the site's CSS variables.
3. Register it in `site/app/components/DocumentFigure.tsx`: one `CAPTIONS` entry
   keyed by the documentation slug, and one `case "<slug>":` returning the
   component wrapped in `<Figure caption={CAPTIONS["<slug>"]!}>`.
4. Build the site to check it. The site is a separate project with its own
   lockfile, not part of the root workspace: run `yarn install && yarn build`
   from `site/`.

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
for decoration. In the logo and the mark, the charcoal ribbons invert to ivory
under a dark colour scheme — a `prefers-color-scheme` media query inside the
asset switches `#24282A` to `#F3F4F6` — and the orange does not change. The
avatar does not invert: it carries its own deep charcoal disc and states its
ribbons as ivory outright.

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

These eight values are declared twice, and both declarations must keep matching
this table: as `--color-*` custom properties in the `@theme` block of
`site/app/globals.css`, and as `--va-*` custom properties on `:root, .va-app` in
`packages/tribunal/src/ui/styles.ts`. The figure components under
`site/app/components/` bypass both and write the hex values literally.

This governs brand and illustration assets and the review surface in
[`@variance-authority/tribunal`](../packages/tribunal) alike. The review surface
spends the palette on a deep charcoal ground and adds two hues the brand assets
have no use for: an amber and a red, for the two things only a verdict UI has to
say — *this was not observed* and *this was refused*. Orange keeps its meaning
there and is never spent on chrome: it marks the cause, and nothing else.

| Token | Value | Role |
| --- | --- | --- |
| `--va-warn` | `#e0a458` | Amber: changed, pending, not observed |
| `--va-warn-bg` | `#2a2118` | Field behind an amber pill or panel |
| `--va-warn-ink` | `#f0c48a` | Text on that field |
| `--va-bad` | `#e5695c` | Red: refused, incomparable, unstable, failed |
| `--va-bad-bg` | `#2c1b18` | Field behind a red pill or panel |
| `--va-bad-ink` | `#f3a99e` | Text on that field |

Amber and red belong to the review surface. Do not spend them on brand or
illustration work; a figure that needs to say *absent* or *refused* says it with
position and contrast instead.

## Shape and line grammar

Build illustrations from a small vocabulary:

- modestly rounded rectangular browser or content fragments;
- small circular nodes and precise connector lines;
- branches, junctions and convergence points;
- comparison pairs, grids and restrained concentric geometry;
- one focused card or region that carries the active state.

Rectangles have modest corner radii, never soft product-dashboard rounding. The
shipped figures use `rx="5"` to `rx="8"`, and `rx="12"` on the largest panel; a
pill radius on a content rectangle is out of the system. Lines are thin and
controlled: `strokeWidth="2"` is the default, `1.5` for subordinate structure
and `3` for an emphasised path, with `5` the widest value anywhere in
`site/app/components/`. Both scales are stated against viewBoxes between roughly
`0 0 96 96` and `0 0 840 300`; scale them with the viewBox rather than copying
the numbers into a much smaller or larger one. Nodes are small. Circles and
halos identify a relationship or a focus point, not empty decoration. A panel
may use subtle transparency and a faint border, but its surface remains flat.

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
clear when reduced. Check both by rendering it at 320 px wide — and the mark at
72 px, the width the package READMEs give it: at that size every major object
must still be separable from its neighbours, and the gaps between them must
still read as gaps. If they merge, remove objects rather than thickening lines.
Background dot grids, alignment points and construction circles are optional,
faint and subordinate to the subject.

## The figure carries the page's intent

A useful documentation figure is a mental model, not a compressed table of
contents. It shows why the parts belong together before the prose develops
them. A reader who sees the figure first should be able to anticipate the page's
argument and know which detail they want to understand next.

Build the figure from the relationship the page exists to explain. A page about
test cost, for example, is not four boxes labelled with its four headings. Its
picture reveals the strategy that makes those outcomes belong together. Labels
name the major ideas; position, direction and contrast carry the relationship.

Use the fewest objects and labels that can carry that model. If the figure needs
a legend, explains every section or merely repeats the headings, remove it or
find the simpler relationship the page is missing.

## Illustration generation grammar

This section is the exception noted in [Where the visuals
live](#where-the-visuals-live): it addresses raster artwork made with an image
generator outside this repository. No tool here runs it, and no generated
illustration is committed here — a figure that belongs to a page is authored as
SVG instead, by [Adding a figure](#adding-a-figure). Use this grammar when you
are producing such artwork anyway; the subject changes, the grammar does not.
Paste the block verbatim, replacing only the subject sentence:

```text
Create a minimal abstract technical illustration for a professional developer
tool. Use a near-black charcoal background (#181B1D), ivory primary elements
(#F3F4F6), subdued warm-grey secondary elements (#756D67), and variance orange
(#FF4A19) as the single semantic accent for change, anomaly, review or the
active path, with its darker facet (#D83A13) where that path turns away from
the light. Use muted sage green (#7FA28C) only for a stable or positive state.
Use no other hue.

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

Branching, divergence, convergence and isolation are recurring motifs, not
requirements to include every time.

The prompt bans text because generated type is unreliable, not because figures
are wordless. A figure component sets its labels itself, as `<text>` or as HTML
beside the SVG, and is held to [Typography](#typography) instead. A generator
will not land on the hex values exactly, so check the result by sampling its
dominant colours: each should be a near neighbour of one of the six above, and
any blue, purple or cyan cast at all fails the image outright.

## Typography

The wordmark is set in the supplied logo asset, not re-typeset: the two lines of
`assets/brand/variance-authority-logo.svg` are `font-size: 92px` with
`letter-spacing: 16px` on the system sans stack (`-apple-system,
BlinkMacSystemFont, "Segoe UI", Inter, Helvetica, Arial, sans-serif`), at weight
300 for `VARIANCE` and 500 for `AUTHORITY`. No font file is bundled for it;
reproduce the wordmark by using that asset.

Product-facing prose uses Inter, with JetBrains Mono for code and captions —
both bundled at `site/public/fonts/` and declared as `--font-sans` and
`--font-mono` in `site/app/globals.css` and as `--va-sans` and `--va-mono` in
`packages/tribunal/src/ui/styles.ts`. Illustrations use little or no text. When a label is necessary, use a short functional term such as
`baseline`, `current` or `review`; the geometry must carry the explanation.

## Light and surfaces

Ivory elements may have a soft ambient bloom against charcoal. Orange focus
may glow slightly more strongly, but glow clarifies hierarchy rather than
creating a neon or cyberpunk effect. In SVG that glow is a CSS `drop-shadow`,
never an SVG blur filter, and the shipped ceiling is the `tl-glow` keyframe in
`site/app/globals.css`: `drop-shadow(0 0 2px rgba(255, 74, 25, 0.5))` at rest,
`drop-shadow(0 0 8px rgba(255, 74, 25, 0.85))` at its brightest. Anything
stronger or wider is out of the system. Avoid glossy 3D rendering, volumetric
lighting, organic blobs, waves and decorative texture. A barely visible grain
or dot field is acceptable only when the primary geometry remains dominant.

## Usage rules

- Use the full logo for the repository identity and broad entry surfaces.
- Use the mark for package headers, compact navigation and square placements.
- Use the avatar for circular organisation, account and app-icon placements.
- The standalone mark asset is transparent and tightly cropped, and inverts its
  charcoal ribbons under a dark colour scheme. Let it sit on whatever surface the
  scheme gives it — charcoal under a dark scheme, ivory under a light one — so
  the inversion keeps the contrast. Do not paint a charcoal field behind it in a
  light context: the ribbons are still charcoal there and would disappear. Where
  a fixed dark field is required, use the avatar, which owns its own.
- Keep enough surrounding space to read all three ribbons and the fold.
- Preserve the supplied proportions, facets, ribbon relationship and colours.
- Treat orange as a single semantic focus; do not scatter it across a scene.
- Treat green as a status signal, never as a second active path.
- Prefer the mark asset over a hand-drawn approximation.

The logo is an identity asset. The illustration grammar is a construction rule
for anything made from it. Neither requires a realistic product interface to
explain the product.
