# Sensitivity

A route test that goes red every time a colour token changes is a route test
nobody reads, and the usual cure — a looser threshold — also stops it noticing
that the sidebar collapsed. A **sensitivity** is the other answer: it names the
kinds of change a subject is under test for, so a route test and a component
test can assert on different things without either one going quiet.

A **subject** is one named UI state you asked for and can ask for again,
identified by a stable id like `story:checkout--empty` — a story, a route (a
page rendered at a URL), a fixture, or a value such as a JSON body. A component
test treats a colour-token change as the change under review. A route test asks
whether the page still assembles: the navigation stays in place, the sidebar
does not collapse, and the regions do not overlap.

A **sensitivity** declares which bands a subject asserts on. A band is the kind
of change a comparison found, not its size. There are five, loudest first:

- `a11y` — a role, accessible name or ARIA state changed.
- `geometry` — boxes appeared, vanished, moved or resized.
- `token` — style values changed while structure stayed the same.
- `content` — text changed and nothing else did.
- `texture` — sub-pixel raster noise.

A sensitivity names the bands that matter for a given subject, never a size or
a percentage. It is not an
[ignore](ignores.md): an ignore excludes a named place or difference shape;
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
nothing and moves nothing, but a route test that does not check it would
assert on the shape of the page while ignoring the shape a screen reader sees.

## What the run reports

Every sensitivity has an id, a required reason, a level, and a count of what it
absorbed. A relaxing rule also names its scope. The count includes zero, which
exposes a declaration that matched subjects but did not relax any of them.

```
SENSITIVITY — 38 subject(s) not asserted on in full, by 2 rule(s)
  routes — asserts on layout; absorbed token difference(s) in 38 of 41 subject(s):
    a route asserts the page assembles, not what it is painted
  [dead] legacy-embed — asserts on content across 3 subject(s) and absorbed
    nothing (a third-party embed you do not style); nothing here needed relaxing
```

A rule that absorbs something is working. A rule that matches subjects and
absorbs nothing is `[dead]` — either a route nothing styles or a declaration
nobody needed. A rule that matches no subject is `[unscoped]`, which points to a
scope or spelling error rather than a policy whose reason no longer applies.

## Declaring one

The CLI is a devDependency, so every invocation goes through `npx`:

```bash
npm install --save-dev @variance-authority/cli
```

Add rules to the top-level `sensitivity` list of your [config
file](start-cli.md):

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

Run the suite with `npx variance run`; the rules are read from the config on
every run.

The last matching rule wins. Sensitivities answer how much of one subject is
under test, so two contradictory answers cannot both be true. Put the broad rule
first and its exception after it. Ignores behave the other way
round: two matching ignore rules exclude more than either one alone.

A non-`strict` rule that names neither `subjects` nor `tags` is refused. There is
no run-wide sensitivity setting. `strict` may omit both because it relaxes
nothing and exists to restore the default inside a broader rule.

`subjects` uses exact ids or `*` wildcards. `tags` matches the tags the subject
plan declares. When a rule names both, both must match. Rule ids are unique; a
duplicate is refused.

## How it decides, and what it costs

When both revisions were captured in full, the comparison reads the two
documents directly. `npx variance run` usually has only an image and a stored
baseline instead, and it makes the same absorb-or-report decision from the
per-component hashes the baseline stores, split by band:

| digest | band |
|---|---|
| `semantics` — role, accessible name, ARIA state | `a11y` |
| `text` | `content` |
| `structure` — tags, aliases, attributes, child boundaries | `geometry` |
| `geometry` — rects and computed layout output | `geometry` |
| `style` — declared values and custom properties | `token` |

The run asks the baseline and candidate **sidecars** — the small JSON record
written beside each image, containing the per-component hashes and none of the
pixels — which bands disagree. It absorbs the subject only when every differing
band falls outside the subject's declared sensitivity. Both routes resolve a
level to the same set of bands, so what a level absorbs does not depend on which
evidence a run had.

A relaxed subject is also cheaper. Isolation is the stage that turns a raw
pixel diff into something a reviewer can read: it clusters the changed pixels
into a mask, attributes each region of that mask to the component that
produced it, and fingerprints the region's shape so it can be tracked across
runs. The sensitivity decision happens before any of that, so a route that a
rebrand only repaints never pays to cluster its mask, attribute its regions, or
fingerprint them. It pays one hash comparison instead.

A baseline with no component hashes absorbs nothing, and the subject is
reported in full. A declaration that cannot be evaluated is not satisfied.

`texture` has no document digest. It is raster residue, so the document-side
comparison leaves that band absent rather than silently absorbing it.

---

**Further:** [Ignores](ignores.md) for excluding a named place or difference
shape · [Composition](composition.md#what-a-boundary-hashes) for the
per-component evidence passed into comparison.
