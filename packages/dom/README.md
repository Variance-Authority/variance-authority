<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/dom

> Extract a Variance Authority capture from a mounted element, under jsdom or a browser, with CSS applicability pruning.

Part of [Variance Authority](https://variance-authority.dev), which retains what
a test run knows — what it rendered, which code it entered, what the workspace
exposes — so the next question is answered from the record, not another run.

Point this package at an element that is already mounted and it reads back two
things: a **capture** — the element's tree, its ARIA, and the CSS declarations
that actually reach it, as serializable data — and a **render document**, the
same subtree as markup plus the frame it was mounted in and only the CSS that
applies to it, which another process can paint. It does not mount anything,
launch a browser, or take a screenshot; it reads a DOM you already have.

```bash
npm install --save-dev @variance-authority/dom
```

## Requirements

ESM only, Node 22 or newer. Nothing here imports a DOM implementation, so it
runs in whichever one your test already has:

| Environment | What you get |
| --- | --- |
| jsdom (`jsdom`, or Vitest's `jsdom` environment) | tree, ARIA, and declared CSS |
| a real browser (Chromium, via Playwright or a collector) | the above, plus computed styles and element geometry |

`@variance-authority/core` installs with it and carries the capture types. The
examples below also use `jsdom`:

```bash
npm install --save-dev jsdom
```

## Smallest working path

Save this as `capture.ts` and run it with `node capture.ts` (Node 24 and
newer) or `node --experimental-strip-types capture.ts` (Node 22):

```ts
import { JSDOM } from 'jsdom';
import { acquireDocument, collect } from '@variance-authority/dom';

const dom = new JSDOM(`<!doctype html>
<html><head><style>
  .sb-show-main { padding: 1rem; background: #fff; }
  .u-mt-2 { margin-top: 8px; }
  :root { --brand: #0000ff; }
  .btn { color: var(--brand); padding-top: 8px; }
</style></head>
<body><div id="canvas"><button class="btn">Save</button></div></body></html>`);

const root = dom.window.document.getElementById('canvas')!;

// A subject is one named UI state you asked for and can ask for again — a
// story, a route, a fixture, a value. The id is yours and stays stable when
// the element that renders it changes.
const subject = { id: 'story:button--primary', kind: 'story' as const };
const viewport = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  colorScheme: 'light' as const,
};
const fonts = ['Inter/400/normal/9f2c1ab4'];

const capture = collect(root, { subject, viewport, engine: 'jsdom@30.0.1', fonts });
const renderDocument = acquireDocument(root, { subject, viewport, fonts });

console.log(JSON.stringify(capture.root.children[0], null, 2));
console.log(renderDocument.css);
```

`collect` is synchronous and returns data ready for `normalize` in
`@variance-authority/core`. `acquireDocument` returns markup, frame context, and
applicable CSS, ready for a renderer in another package or on another machine —
a document acquired in a jsdom unit test can be painted by a pinned host
elsewhere.

### What you get

The first `console.log` — the captured button, one child of the captured root:

```json
{
  "tag": "button",
  "attributes": { "class": "btn" },
  "aria": { "role": "button", "name": "Save", "state": {} },
  "matchedRules": [
    {
      "sheet": "<style:0>",
      "selector": ".btn",
      "specificity": [0, 1, 0],
      "order": 4,
      "declarations": [
        { "property": "color", "value": "var(--brand)", "important": false, "references": ["--brand"] },
        { "property": "padding-top", "value": "8px", "important": false }
      ]
    }
  ],
  "children": [
    { "tag": "#text", "attributes": {}, "matchedRules": [], "text": "Save", "children": [] }
  ]
}
```

Values leave as authored — generated ids intact, hashed class names intact,
shorthands unexpanded, cascade losers retained. `normalize` decides what to do
with them, so the rules that settle a comparison are versioned in one place.

Around that node the capture also carries `subject`, an `environment` block
(engine, viewport, fonts, resolved conditions, assets), `inheritedSeed` —
`{"--brand": "#0000ff"}` here, the custom properties in force at the root — and
`diagnostics`. The run above reports one:

```json
{
  "severity": "warn",
  "code": "portals-not-resolved",
  "message": "no portal provider supplied; content rendered through createPortal is outside this capture, and a subject that portals will report unchanged when that content changes"
}
```

Diagnostics are never hashed. Omit `fonts` as well and you get a second one,
`unverified-fonts`: a page can see that `Inter` is in use and cannot read the
bytes it was handed, so a font substitution moves geometry with no change to
your code.

The second `console.log` — the CSS the render document ships:

```
[ ':root {--brand:#0000ff}\n.btn {color:var(--brand);padding-top:8px}' ]
```

Two of the four rules in that page are gone. `.sb-show-main` and `.u-mt-2`
cannot reach anything in the subtree, so they are not in the payload and not in
the comparison.

## What applicability pruning removes

`collect` and `acquireDocument` both discard every stylesheet rule that cannot
reach the mounted element, keeping only what could style it.

On a single-button subject mounted under Storybook chrome — a preview reset,
dead utility classes, CSS-in-JS accretion — pruning reduced 1,010 parsed rules
to the one that could reach the subject. Without it, a baseline moves when a
stylesheet the subject never touched does.

## Use this package when

Use `@variance-authority/dom` when your code already owns a live `Element` and
the `document` it belongs to — a collector, or a test that has rendered
something. You supply that element, the subject, the viewport, and any font or
asset hashes you can verify.

Skip it when nothing has mounted an element yet:
`@variance-authority/storybook-collector` and
`@variance-authority/route-collector` own the browser and the mounting for you,
and call this underneath.

## Controls

| Call | Useful options |
| --- | --- |
| `collect` / `acquireDocument` | `subject`, `viewport` and `engine` name what was read; `features` supplies media conditions such as `prefers-reduced-motion`; `index` reuses a stylesheet index across subjects sharing one document, and is refused if it was built for a different viewport or colour scheme |
| `acquireDocument` | `inherited` overrides the values and custom properties resolved from ancestors outside the subject; design tokens live on `:root`, which pruning correctly drops, so this is what keeps `var(--brand)` resolving |
| `collect` | `ignore` excludes subtrees by selector, `provenanceOf` adds component ownership, `wiringOf` adds framework wiring, `holdingOf` adds what each component was handed and retained, `portalsOf` pulls in portalled subtrees, and `stabilization` records the digest of whatever held the page still; none of these is inferred from markup |
| `stabilizeForObservation` | `recipe` selects the interventions to apply — animations, carets, and the rest — and the result reports which ones actually applied. `tier` raises how much the run is claiming about: declarations, geometry, or pixels. Pass the raster tier when you are screenshotting the document you just read, so holds such as the caret are installed |
| `resolveIgnores` | `selectors` names the excluded places, `markers` controls handling of the `data-variance-ignore` attribute |
| `attributeProvenance` | `component`, `createdBy` and `props` name the attributes to read provenance from, defaulting to `data-component`, `data-created-by` and `data-props`. What they carry is declared by whatever rendered the element, never guessed from a tag name |

## What is in here

| Module | Answers |
| --- | --- |
| `collect` | the tree, its ARIA, and the declarations that reached each node |
| `document` | markup plus applicable CSS, ready to be assembled and painted |
| `css` | which rules match — `css-index` flattens the sheets once per document, `css-match` answers once per element |
| `media` / `specificity` | `@media` and `@supports` evaluation, and cascade order |
| `aria` | role, accessible name, and state, computed rather than read off attributes |
| `ignore` | which subtrees you excluded, from selectors and from `data-variance-ignore`. An excluded node is marked, never deleted: "absorbed by the `carousel` rule" and "was never there" are different answers downstream |
| `profile` | whether this DOM has a layout engine, probed rather than declared, and therefore whether geometry and computed styles are in the capture |
| `assets` | the external URLs a document refers to, so hashes fetched over the wire have somewhere to land |
| `stabilize` | the interventions applied to a live page, and which ones reported applying |
| `attributed` | component names, creators, and props written onto the nodes that carry them, from values you declare rather than guesses from a tag name |

## Component names are optional

`provenanceOf`, `wiringOf` and `holdingOf` are parameters, not imports. This
package knows nothing about React. For React, pass the providers from
`@variance-authority/react`:

```bash
npm install --save-dev @variance-authority/react
```

Continuing the file above:

```ts
import { provenanceOf, portalContentOf } from '@variance-authority/react';

const capture = collect(root, {
  subject,
  viewport,
  engine: 'jsdom@30.0.1',
  fonts,
  provenanceOf,
  portalsOf: portalContentOf,
});
```

Both read the fiber React attaches to the DOM node, so they report names only
where React rendered the subject. Pass none of the providers and attribution stops at the
node rather than the component; a project on another framework supplies its
own.

`collect` cannot infer fonts, the contents of external assets, or portal
ownership. Omit one only when the missing fact is outside what you are
asserting: without `portalsOf`, a subject's container is byte-identical whether
a modal is open or closed, and an opening dialog reads as unchanged.

---

**[@variance-authority/dom](https://variance-authority.dev/reference/packages/dom)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
