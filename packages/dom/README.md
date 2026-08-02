# @variance-authority/dom

**Requires:** a live DOM in scope — a mounted element and the `document` that
owns it. jsdom or a browser; it never asks which.

Extract a `RawCapture` from a mounted element. One implementation for both
observation profiles: jsdom in a unit test, Chromium in a page, same code, same
ruleset.

## Why it cannot live in core

Deciding whether a CSS rule *applies* requires a live document. You cannot know
whether `.card:hover .title` matches without something to match against, and
`core` is forbidden from having one
([ADR-0006](../../docs/context/adr/0006-host-free-core.md)).

So applicability pruning happens here and nothing else does. Every other
normalization rule must be versioned by the ruleset rather than by the collector,
or two collectors become two rulesets and the profiles stop agreeing by
construction.

## The pruning is the moat

**1007 CSS rules parsed → 1 reached the normalizer** on the measurement corpus.
A design system's stylesheet is almost entirely irrelevant to any one subject,
and a comparison that carries it is comparing the document a subject happened to
be mounted in.

See [ADR-0003](../../docs/context/adr/0003-cruft-removal-and-css-applicability.md).

## Usage

```ts
import { collect, acquireDocument } from '@variance-authority/dom';
import { provenanceOf } from '@variance-authority/react';

// For the semantic tiers: a capture the normalizer turns into a snapshot.
const capture = collect(container, {
  subject: { id: 'story:button--primary', kind: 'story' },
  profile: 'chromium',
  provenanceOf,                       // optional; owner chains if you have React
});

// For the raster tier: markup plus only the CSS that applies to it.
const document = acquireDocument(container, { subject, viewport, fonts });
```

`acquireDocument` produces something **serializable**, which is what lets the
next hop be a network hop: a document acquired in a jsdom unit test can be
painted by a pinned machine two networks away, and nothing above or below has to
know that happened.

## What is in here

| module | answers |
|---|---|
| `collect` | the tree, its ARIA, and the declarations that reached each node |
| `document` | markup plus applicable CSS, ready to be assembled and painted |
| `css` | which rules match, indexed rather than re-queried per node |
| `media` / `specificity` | `@media`/`@supports` evaluation, and cascade order |
| `aria` | role, accessible name, and state — computed, not read off attributes |

## Owner chains are optional and injected

`provenanceOf` is a parameter, not an import. This package knows nothing about
React, and a project using something else supplies its own — or none, and gets
attribution down to the node rather than the component.
