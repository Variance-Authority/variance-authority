# System under test

## What it is

The adopter's own application: the interface whose states are observed. It
exists, ships and changes for reasons that have nothing to do with being
observed, and it is the only party in the chart that is not instrumentation.

## Good at

Being reached through a surface it already has — a route it serves, a story it
publishes, a component a test already mounts. Rendering the same state the same
way twice when nothing about it changed.

## Bad at

Announcing what it decided. A negative has no timing: *the modal does not
appear* is indistinguishable from *the modal has not appeared yet*, and the
application says nothing either way unless its authors add an announcement.

## How it breaks

It arrives late, so a **subject** is captured mid-flight and a skeleton becomes
a **baseline** nobody wrote. It leaks state across **subjects** sharing one
standing world. It renders something whose identifiers change on every load,
so a stable interface digests differently every time.

## How you talk to it

Through a host that already reaches it. The system mounts nothing itself: it is
handed a live element, a page, or an already-rendered document, and reads it.

## Their chart

—
