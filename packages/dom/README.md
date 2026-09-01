<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/dom

> Extract a Variance Authority capture from a mounted element, under jsdom or a browser, with CSS applicability pruning.

**Requires:** a live DOM in scope — a mounted element and the `document` that
owns it. jsdom or a browser; it never asks which.

Extract a `RawCapture` — a serializable snapshot of an element's tree, ARIA, and
applicable styles — from a mounted element. One implementation covers both
**observation profiles**, i.e. what a document can be asked for: jsdom in a unit
test, Chromium in a page, same code, same ruleset.

```bash
npm install --save-dev @variance-authority/dom
```
## Use this package when

Install `@variance-authority/dom` when your code — the **host** — already owns a
live `Element` and the `document` it belongs to; a collector or a test is a
host. The host supplies that document, the **subject** (a stable id naming the
story, route, fixture, or value under test, independent of which element
renders it), viewport conditions, and any font or asset hashes it can verify.
This package does not mount React, launch a browser, decode images, or
normalize the capture; pass its result to `@variance-authority/core`. React
attribution is optional and is injected by `@variance-authority/react`.

Skip this package if nothing has mounted an element yet: a collector such as
`@variance-authority/storybook-collector` or `@variance-authority/route-collector`
owns the browser and the mounting for you.

## Applicability pruning

**CSS applicability pruning** discards every stylesheet rule that cannot reach
the mounted subject, keeping only what could actually style it. It happens in
this package, not in `@variance-authority/core`, because deciding whether a rule
applies needs a live document; every other normalization rule stays versioned by
the ruleset instead of the collector.

On a single-button subject mounted under Storybook chrome, a preview reset, dead
utility classes and CSS-in-JS accretion, applicability pruning reduced 1,010
parsed rules to the one rule that could reach the subject. A design system's
stylesheet is almost entirely irrelevant to any one subject, and a comparison
that carries it is comparing the document a subject happened to be mounted in.

## Smallest working path

```ts
import { acquireDocument, collect } from '@variance-authority/dom';

const root = document.querySelector('[data-variance-subject]');
if (root === null) throw new Error('subject is not mounted');

const subject = { id: 'story:button--primary', kind: 'story' as const };
const viewport = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  colorScheme: 'light' as const,
};

const capture = collect(root, {
  subject,
  viewport,
  engine: 'chromium@131.0.6778.33',
});

const renderDocument = acquireDocument(root, { subject, viewport });
console.log(capture.root.tag, renderDocument.html.length);
```

The mounted element is the same value for both paths. `collect` is synchronous and returns serializable data
for `normalize`. `acquireDocument` returns serializable markup, frame context, and
only the CSS that applies to the subject, ready for a renderer owned by another
package or process.

The profile is not an argument here. It is **detected** from the document —
jsdom has no layout engine and a browser does — and passing one is the override,
not the normal case. `fonts` is a caller's job for the reason stated in the type:
a page can see that `Inter` is in use and cannot read the bytes it was given, so
a substituted font changes geometry without changing a line of code. Omit it and
the collector says so in a diagnostic rather than putting a confident value in
the environment key.

`acquireDocument` produces something **serializable**, which is what lets the
next hop be a network hop: a document acquired in a jsdom unit test can be
painted by a pinned machine two networks away, and nothing above or below has to
know that happened.

The example prints the captured root tag and the acquired document size. A
consumer that needs component names adds `provenanceOf` to `collect`; a consumer
that needs pixels sends `renderDocument` to a renderer. Neither operation is
implicit.

The options that make a capture applicable are supplied by the host:

| call | useful controls |
|---|---|
| `collect` / `acquireDocument` | `subject`, `viewport`, and `engine` identify the reading; `features` supplies media conditions, `inherited` supplies declarations from ancestors outside the root, and `index` reuses a stylesheet index for a standing document |
| `collect` | `wiringOf` adds framework wiring and `holdingOf` adds what each component was handed and what it retained, while `stabilization` records the intervention recipe already applied; none of the three is inferred from markup |
| `stabilizeForObservation` | `recipe` selects the intervention list; the default is profile-specific `COLLECT_RECIPE`, and the returned digest records what was applied |
| `attributeProvenance` | `component`, `createdBy`, and `props` are caller-declared metadata written to a node, not guesses from a tag name |
| `resolveIgnores` | `selectors` names the excluded places and `markers` controls `data-variance-ignore` handling |

## What is in here

| module | answers |
|---|---|
| `collect` | the tree, its ARIA, and the declarations that reached each node |
| `document` | markup plus applicable CSS, ready to be assembled and painted |
| `css` | which rules match, indexed rather than re-queried per node — `css-index` flattens the sheets once per document, `css-match` answers once per element |
| `media` / `specificity` | `@media`/`@supports` evaluation, and cascade order |
| `aria` | role, accessible name, and state — computed, not read off attributes |
| `ignore` | which subtrees the operator excluded, from selectors and from `data-variance-ignore` — resolved here because that is the only step needing a document, and recorded as a **mark** rather than a deletion |
| `profile` | which tier this DOM can actually answer for, detected rather than declared |
| `assets` | the external URLs a document refers to, so the wire's hashes have somewhere to land |
| `stabilize` | the collection recipe applied to a live page, and what it reports having applied |
| `attributed` | provenance and state written onto the nodes that carry them |

`inherit` is used by `collect` and is not part of the export surface: what the
ancestors outside the subject contribute is decided during collection, not by a
caller.

## Owner chains are optional and injected

`provenanceOf` is a parameter, not an import, and so are `wiringOf` and
`holdingOf`. This package knows nothing about React, and a project using
something else supplies its own — or none, and gets attribution down to the node
rather than the component.

`collect` cannot infer fonts, external asset contents, or portal ownership. Omit
one only when the missing fact is genuinely outside the assertion; otherwise pass
`fonts`, `assets`, or `portalsOf` so the resulting identity does not claim more
than the page established.
