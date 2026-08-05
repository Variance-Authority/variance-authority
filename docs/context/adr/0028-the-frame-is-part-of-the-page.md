# ADR-0028 — The frame is part of the page, so its rules are applicable

**Status:** accepted
**Date:** 2026-08-06
**Amends:** ADR-0003 (cruft removal and CSS applicability)
**Breaking:** every `documentDigest` moves. Existing baselines report `new`.

## Context

`acquireDocument` reproduces a frame around the subject — `<html>`, `<body>` and
every ancestor, by tag and attributes — and `assemble` paints it. `applicableCss`
collected the rules matching the subject **and its descendants**, walking down
from the subject and never up.

So the render was given a body carrying `class="sb-show-main"` and no rule for it.
A Storybook preview that centres its story with `body { display: flex;
justify-content: center }` painted the subject full-width at the top left instead.

Measured on `cases/storybook-case` on 2026-08-06: the acquired subject is
**147.33** CSS pixels wide and the image was **1024** device pixels at scale 1.
Every baseline that case held was a photograph of a layout that exists in no
browser, and every region coordinate was converted between the two.

It attributed correctly there anyway, because that story sits at its container's
origin and the two spaces disagree by zero at that corner. That is what made it
survive a measurement looking straight at it: the failure is silent, produces a
complete and confident report, and only bites on a subject that is centred,
right-aligned, or shrink-to-fit inside a wider frame.

`verify()` could not catch it. It re-tests every shipped rule against the
reconstructed frame, and a rule that was never collected is never a `Binding`.

## Decision

**A rule is applicable if it matches anything the render will contain, and the
render contains the frame.** `applicableCss` now also collects rules matching each
element from the subject's parent up to `<html>`.

This is ADR-0003's own rule applied to the whole of what is painted rather than to
part of it. Pruning drops a rule that matches *nothing in the render*; it never
meant "nothing in the subtree", and the difference was invisible while the frame
was a shell with no styling of its own.

**Ancestors produce no bindings, and that limit is stated rather than closed.**
The frame is reconstructed from tags and attributes rather than serialized, so
ancestors carry no `data-va-path` and `verify` has no node to re-test them
against. A frame rule that fails to match in the render can only *lose* styling
the page had — never invent it — and `subject-size-diverged` is the detector for
the outcome. Stamping ancestors would put the attribute on elements outside the
subject, which is a larger change to what a document *is* than this fixes.

**Every baseline is invalidated, deliberately and visibly.** The document is
different, so its digest is different, so a stored baseline is found under a key
nothing was written to and the subject reports `new`. That is the loud failure
mode this system is built around, and it is the correct one: the old image is of
a page that never existed, and silently comparing against it would be worse than
re-recording. Nothing is published yet, so the cost falls on this repository's own
cases.

## Consequences

**The case went from wrong to right, measurably.** `cases/storybook-case`'s
flagship story reported `the subject resized from 1024×76 to 1024×82` and now
reports `136×76 to 148×82` — 148 device pixels against the 147.33 CSS the page
actually laid out. `subject-size-diverged` is silent, and its silence is the
acceptance test.

**The inherited floor is no longer the only carrier of design tokens, and one
test was passing for a reason that had stopped being true.**
`examples/todomvc`'s offload suite asserted that stripping `inherited` deleted the
design system's colours, because `:root` is outside every subject and pruning
dropped it. `:root` matches `<html>`, which the frame reproduces — so the rule now
ships as authored and stripping the floor changes nothing. The test asserts
against both carriers being gone, which is what it always meant.

The floor is kept. It carries *computed* values and loses to every declaration, so
it cannot override a real rule; what it can still do is stand in where a value
reached the subject by a route the reproduced frame does not recreate.

**Documents get bigger, and the pruning figure is unaffected.** A page's
body-level rules now ship with every subject. ADR-0003's measured 99.90% is about
the *collector's* pruning into a snapshot and does not move; what grows is the
render document, which is text beside a PNG.

**What this does not fix.** The frame is still tags and attributes: an ancestor's
inline style, its shadow content, and anything about it that is not an attribute
are not reproduced. And the subject's *position* on the page is still deliberately
not reproduced — `html,body{margin:0;padding:0}` stays, because where a subject
sat is not what is being compared.
