---
'@variance-authority/core': minor
---

The differ pairs the one element its author replaced, and says what it became

When, under one matched parent, exactly one element left and exactly one
arrived, and the same component's `createdBy` wrote both, `matchTrees` pairs
them. The pair is compared like any other and leads with a new `tag-changed`
delta, in the geometry band and counted as structural, followed by whatever else
differs: role, name, state, attributes, styles and box. Before, the same change
was a `node-removed` and a `node-added`. Two or more replaced by one author under
one parent stay unpaired, because either could be either, and so do two that
each carry an alias or a role and name of their own: every `<Button>` is created
by `Button`, and a Save button replaced by an Export link is two elements.

`tag-changed` is reported on every pair across two tags, so a pair that a
declared alias or a shared role and name joined — a `<button>` and a
`<div role="button">` with one name — now says its tag changed, where before it
reported nothing for it.

A `style-changed` or `token-changed` delta on a pair across two tags is banded
`geometry`, with the `tag-changed` it follows, rather than `token`: the style is
the new element's, and the structure a `token` delta says held did not. A
`bands: ['token']` ignore rule no longer reads it. `bandOf` owns the rule, as
`bandOf(kind, { retagged })`, and a parting row's bands now read each delta's
own band, so the row and the docket agree.
