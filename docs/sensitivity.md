# Sensitivity

A route-level test and a component-level test assert on different things. A
component test treats a colour-token change as the change under review. A route
test asks whether the page still assembles: the navigation stays in place, the
sidebar does not collapse, and the regions do not overlap.

A **sensitivity** declares which frequency bands a subject asserts on. It is not
an [ignore](ignores.md): an ignore excludes a named place or difference shape;
a sensitivity states the kinds of change that matter for a named set of
subjects.

## Levels

| level | asserts on | absorbs |
|---|---|---|
| `strict` | everything | nothing — the default, and how an exception is written back inside a relaxed group |
| `layout` | `a11y`, `geometry` | `token`, `content`, `texture` |
| `content` | `a11y`, `content` | `geometry`, `token`, `texture` |

A sensitivity is not a threshold. A threshold absorbs anything small enough; a
band absorbs exactly one kind of thing, however large it is. A route declared
`layout` still reports a navigation region that moved by one pixel and does not
report a rebrand that repainted every surface on the page.

`a11y` belongs to every level. A control that loses its accessible name repaints
nothing and moves nothing, but a route test blind to it would assert on the
shape of the page while ignoring the shape a screen reader sees.

## What the run reports

Every sensitivity has an id, a required reason, a level, and a count of what it
absorbed. A relaxing rule also names its scope. The count includes zero, which
exposes a declaration that reached subjects but did not relax any of them.

```
SENSITIVITY — 38 subject(s) not asserted on in full, by 2 rule(s)
  routes — asserts on layout; absorbed token difference(s) in 38 of 41 subject(s):
    a route asserts the page assembles, not what it is painted
  [dead] legacy-embed — asserts on content across 3 subject(s) and absorbed
    nothing (a themed embed we do not control); nothing here needed relaxing
```

A rule that absorbs something is working. A rule that reaches subjects and
absorbs nothing is `[dead]` — either a route nothing styles or a declaration
nobody needed. A rule that matches no subject is `[unscoped]`, which points to a
scope or spelling error rather than a policy that has outlived its cause.

## Declaring one

Add rules to the top-level `sensitivity` list in the Variance Authority config:

```jsonc
{
  "sensitivity": [
    {
      "id": "routes",
      "reason": "a route asserts the page assembles, not what it is painted",
      "level": "layout",
      "subjects": ["route/*"]
    },
    {
      "id": "checkout-is-strict",
      "reason": "the one page where a colour is the product",
      "level": "strict",
      "subjects": ["route/checkout"]
    }
  ]
}
```

The last matching rule wins. Sensitivities answer how much of one subject is
under test, so two contradictory answers cannot both hold. Put the broad rule
first and its exception after it. This is the opposite of ignores, which
accumulate, because two matching ignore rules exclude more than either one does.

A non-`strict` rule that names neither `subjects` nor `tags` is refused. There is
no run-wide sensitivity setting. `strict` may omit both because it relaxes
nothing and exists to restore the default inside a broader rule.

`subjects` uses exact ids or `*` wildcards. `tags` matches tags carried by the
subject plan. When a rule names both, both must match. Rule ids are unique; a
duplicate is refused.

## How it decides, and what it costs

The library folds `applySensitivity` over a pair of snapshots. `variance run`
compares an image with a stored baseline and reaches the same decision because
the baseline carries per-component hashes split by band:

| digest | band |
|---|---|
| `semantics` — role, accessible name, ARIA state | `a11y` |
| `text` | `content` |
| `structure` — tags, aliases, attributes, child boundaries | `geometry` |
| `geometry` — rects and computed layout output | `geometry` |
| `style` — declared values and custom properties | `token` |

The run asks the baseline and candidate sidecars which bands disagree. It
absorbs the subject only when every differing band falls outside the subject's
declared sensitivity. The snapshot path and baseline path share the same
`bandsOf` mapping.

A relaxed subject is also cheaper. The decision happens before isolation, so a
route that a rebrand only repaints never pays to cluster its mask, attribute its
regions, or fingerprint them. It pays one hash comparison instead.

A baseline carrying no component hashes absorbs nothing, and the subject is
reported in full. A declaration that cannot be evaluated is not satisfied.

`texture` has no document digest. It is raster residue, so the document-side
comparison leaves that band absent rather than silently absorbing it.

---

**Further:** [`ignores.md`](ignores.md) for excluding a named place or difference
shape · [`composition.md`](composition.md#what-a-boundary-hashes) for the
per-component evidence carried into comparison.
