# Spec 0061 — a `/// <depends>` directive takes a glob

**Missing:** `/// <depends path="./queries/*.graphql" />`. Today a directive
names one file. A glob resolves to nothing and is reported as a relative
specifier that resolves to nothing, so it stays visible and draws no edge.
**Built on:** `packages/sense/native/src/depends.rs` (the directive),
`packages/sense/src/depends.test.ts` (the `it.todo` this discharges).

## Purpose

A mock server loads every operation in a directory, and a fixture loader reads a
folder of snapshots. Naming each file in a directive goes stale the first time a
file is added, and a stale directive is a missing edge that nothing reports.

## What would discharge it

**1. A glob draws an edge to every tracked file it matches.** Git owns what files
exist, so the match runs over `git ls-files`, never a directory walk. Matching
is the same `fast_glob` dialect the `sideEffects` reading already uses.

**2. A request may resolve to several targets on the native scan.** The oracle's
`resolveAll` already returns several. The native `targets` column holds one per
request, and gains the rest without changing the first.

**3. A file added under the glob moves the edge.** The reuse record for the
declaring module carries a witness over the glob's base directory, so a new
matching file re-reads the module instead of reusing an edge list that misses
it.

**4. A glob that matches nothing is reported**, the way a path that resolves to
nothing is.
