# ADR-0007 — A subject's boundary is the component tree, not DOM containment

**Status:** accepted
**Date:** 2026-08-01
**Amends:** ADR-0002 (which covers *what* a profile can observe, not *where* a subject ends)

## Context

A containment-based definition of "subject" treats the subject as a DOM subtree:
`collect(root)` walks `root` and its descendants, and applicability pruning keeps
rules matching something inside it.

`createPortal` breaks that definition. A dialog, tooltip, or toast renders into a
host elsewhere in the document — usually `document.body` — while remaining part
of the component tree rooted at the subject. Every containment-based definition
puts that content outside the subject.

The contested case `dialog-open/dialog` measures the consequence: opening a modal
moves **342 bytes** out of the subject's container into the portal host, leaving
the container **byte-identical**. Under DOM containment, a dialog opening and a
dialog closed produce the same render hash.

That is a false `unchanged` on a change no user could miss. It is precisely the
failure ADR-0002 exists to prevent, arriving through a door ADR-0002 does not
cover: not a dimension the profile cannot *see*, but content the subject
definition declines to *look at*.

A containment-based collector and a containment-based fixture agree with each
other perfectly, so no test built on containment can expose the gap.

## Decision

**A subject is the set of DOM nodes its component subtree renders, wherever they
land in the document.**

- `RawCapture.portals` carries the top-level elements the subject renders through
  portals, in fiber traversal order.
- `portalContentOf` in `react` finds them by walking for `HostPortal`
  fibers, so the boundary is read from the component tree, which is the thing
  that actually defines it.
- Normalization appends each portalled subtree as a child of the subject root,
  flagged `portalled: true`, and that flag is in the structure hash — so "the
  dialog moved from inline to portalled" is a change, not a coincidence of
  identical content.
- Aliasing spans container and portals as one space, since a dialog's
  `aria-labelledby` routinely points at a title on the other side of the boundary
  and must resolve rather than report as dangling.
- Ordering is **fiber traversal order, not DOM order**, so a subject's hash does
  not depend on where in the shared container its portal happened to be appended
  relative to another subject's.

### Portal content, not the portal container

The captured elements are what the portal *renders*, never the container it
renders into. The container is typically `document.body`; capturing it would pull
in the whole page — every other mounted subject, the harness chrome, every
sibling portal — and make one subject's hash depend on what else happened to be
on screen.

### Omitting the provider is reported, not tolerated

`portalsOf` is an injected option, because the collector carries no framework
dependency (spec §9). A collector called without it emits
`portals-not-resolved`. Without that diagnostic, a caller who omits the provider
gets exactly the silent false negative this ADR exists to remove, and gets it in
the configuration most likely to be reached by accident.

## Consequences

- The portal path is the *only* way to reach this content. It is not reachable by
  walking the DOM from the subject root, which means an adapter for a framework
  with no provenance provider cannot support portals at all — it must report
  them unsupported rather than silently omit them.
- A test asserts the defect remains reachable without the provider
  (`is invisible to a DOM-containment reading`). Keeping the broken behaviour
  demonstrable stops the fix decaying into a no-op that nobody notices.
- `findFiber` alone is not sufficient to implement this. A subject root is very
  often the element a React root was mounted *into*, and `react-dom` marks those
  with `__reactContainer$` rather than the `__reactFiber$` expando — so the
  element React renders *through* has no fiber of its own. The lookup falls back
  to a rendered descendant and climbs to the `HostRoot`.

## What this forecloses

- Defining subjects purely by CSS selector or DOM range. The definition needs a
  provenance provider, which is load-bearing for correctness rather than only
  for attribution.
- Treating `collect(root)` as a pure function of `root`'s DOM subtree. It is a
  function of the subtree *and* the component tree rooted there.

## Known limits

Shadow DOM is captured (`shadowChildren`), and `<dialog>` with the top layer is
not: a native modal is promoted out of normal flow at paint time, which affects
raster and stacking but not the semantic tree, so it is out of scope until Stage 2
exists. The corpus's other two contested cases — a band that differs per profile,
and a subject reporting a set of bands rather than one — remain undecided.
