# ADR-0055 — Update initiators are structural attention

**Status:** accepted
**Date:** 2026-09-03
**Extends:** ADR-0002 (absent is not empty), ADR-0005 (Fiber provenance uses the
host expando), ADR-0012 (observability is bounded and cannot break the subject),
ADR-0043 (the extension does not own the host)

## Context

The commit tap records `PerformedWork` flags. They answer which component render
bodies ran, which includes both the instance that scheduled an update and every
component React visited because of it. Test attention records the structural
component path of a DOM target. An execution index records source reached by the
whole test. None of the three can substitute for the others.

React roots expose `memoizedUpdaters`, the set of Fibers that initiated a commit.
The values are live renderer objects, alternate between trees, and carry names
that are not unique. Keeping the Fiber, or joining on a display name, would turn
an ephemeral diagnostic into an ambiguous reference.

## Decision

**A commit records update initiators as portable structural component paths,
separately from components that performed work.**

The tap reads `memoizedUpdaters` synchronously in the commit callback, resolves
the current alternate, and copies an innermost-first path. Each composite frame
contains its name, reconciliation key, and props digest excluding children. The
updater carries a JSX source coordinate when the Fiber exposes one. No Fiber or
DOM reference survives the callback.

The updater member is absent when the renderer does not expose the set and is an
empty array when it exposes a measured empty set. Both the updater count and
Fiber traversal have explicit bounds and report truncation.

Eyes installs the tap through an init script before application code and appends
commit records to the same authored phase chronology as DOM attention. The MCP
testing-surface view compares updater paths with addressed owner paths using
their common structural suffix. It reports initiators inside and outside the
addressed paths separately. It does not join by component name alone and does
not call either group the cause of a source statement.

The public Fiber helpers are read-only traversal primitives over an already-held
Fiber. They do not locate a page, own a browser, install an active callback, or
add a helper server.

## Consequences

A testing-surface reader can distinguish code that rendered, a component
instance that initiated an update, a DOM location the test addressed, and source
the test executed. The relation supports narrowing and diagnosis without
claiming that collateral work is irrelevant or safe to replace.

The page agent must run before React loads to observe commits. A late collector
still refuses rather than manufacturing coverage. React internals remain a
version-sensitive input, so validation occurs at the process boundary and every
read stays bounded.
