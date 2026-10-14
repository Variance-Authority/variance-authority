# ADR-0093 — Probes are placed after the project's transforms, on regions cut from the authored text

**Status:** accepted
**Date:** 2026-10-15
**Reverses:** the probe-first placement of commit `3ece7550b` (every seam
probed the text the author wrote, before any other transform)
**Amends:** [spec 0028](../../specs/0028-the-instrument.md) §2, §4 and §5
**Relates to:** [`packages/sense/native/instrument/src/place.rs`](../../../packages/sense/native/instrument/src/place.rs),
[`packages/sense/src/test-selection/captured-modules.ts`](../../../packages/sense/src/test-selection/captured-modules.ts),
[`packages/sense/src/test-selection/unmapped-transforms.ts`](../../../packages/sense/src/test-selection/unmapped-transforms.ts)

## Context

Commit `3ece7550b` put every seam first: `testSelectionProbes` and the Vitest
plugin at `enforce: 'pre'`, the Jest transformer ahead of the one it wraps, the
Rstest loader ahead of SWC. Its reason was the record's address. A region is
the file's own: its name, its digest, its lines. Probing the text the author
wrote kept compiler-written code (decorator helpers, a generated constructor)
out of the record, and kept stack traces on their lines. An earlier placement
after the transforms had cut the regions from compiled text and lost both.

A compiler that reads the syntax it compiles reads probes as code. Compiled,
the CSS-in-JS extractor, cannot extract a probed `styled` call that takes a
function, or an object holding an arrow, and throws. It compiles a probed
dynamic prop or template interpolation into a runtime CSS variable instead of
a static class. Nothing fails then, but the recorded build is not the one that
ships: a Vite 8 SSR page grew from 448 to 547 bytes of HTML, all of it the
runtime variables. React Compiler restructures a probed component the same way.

The address requirement constrains where a region is *cut*. It does not
require the probe text to sit in front of the compilers.

Prior art places in two ways. Istanbul instruments source as one Babel
transform among the project's, so where its counters sit against a compiler
depends on plugin order. V8 coverage (`c8`, Vitest's `v8` provider) counts the
engine's output and maps it back through the composed source map, after every
transform. This decision takes V8's placement and keeps regions cut from the
source, as Istanbul's are.

## Decision

**The regions are cut from the authored text. The probes are placed on the
transformed text, after every transform of the project's, through the composed
source map. A map that would place a probe on the wrong code is never used.**

1. **One native call places.** `place(authored, transformed, map)` cuts the
   authored text exactly as `instrument` does, so ordinals, names, digests and
   module ids do not depend on the transforms. It walks the transformed text
   into regions and reads the map one way: a generated position names the
   authored region its origin sits in. A transformed region fires the regions
   its positions name, and one that names none carries no probe.

2. **The nearest origin is an over-approximation, and never an
   under-approximation.** An authored region no origin falls in, because an
   extractor moved its text and mapped what it wrote to the declaration, is
   fired by the code holding the nearest origin in front of it, inside a region
   enclosing it. That code runs on every entry into the enclosing region before
   the region can, so a test that ran the region is charged with it. A test that
   ran only that code is charged too. A compiler's own map over-approximates the
   same way: React Compiler names a component's closing `}` as its last
   statement's end, so the region after an early `return` fires at entry. An
   extra selection is a cost; a missed one is a wrong answer.

3. **A map that names the wrong code is refused, by name.** Every region is
   placed: one with no origin fires at the entry of the code in front of it,
   or at module load. What stops the run is a map that cannot be believed. A
   rewrite whose map leads back to no source that is the file stops it with
   the file's project-relative path. Vite composes a plugin that rewrote a file
   and returned no map as identity under a dev server and as an empty map in a
   build, so each plugin's `transform` is watched and such a plugin is refused
   by name; `map: null` says nothing moved and is believed. Rstest refuses a
   file that reaches the second loader with no map, a configuration whose
   loaders leave the second out, and, when Rspack lists no loaders, at the
   run's end, a file that went through the first loader and never reached the
   second.

4. **Four cases still meet the probes, or the case marks, before the
   transforms.** A file that names its own source map under a Vite dev server,
   Vitest or Rstest, because each composes from that map and names the build's
   sources, not the file; a Vite build and Jest place it after. A Jest
   transformer that returns no map, or one leading back to no source that is
   the file, which is handed the probed text, transforms twice and is warned
   about once by name. Vitest browser mode, because `vi.mock` loads a mock under
   the file's name from no text a map carries back. A test file, cut for its
   cases first so its case marks sit on the author's lines.

5. **A new recipe id.** The probes a module carries moved, so a recording made
   before names another id. Selection reads it as it stands, since the regions
   are cut alike; a journal or page report naming another is refused; the next
   run that writes a record replaces it rather than merging, so the first run
   after upgrading should be the full suite.

## Consequences

- A build-time compiler compiles the same output under a recorded run as it
  ships, outside the four cases.
- The placement pays a second parse and a map read: about 0.4 ms a module under
  a Vite dev server and 0.07 ms under Jest, rounded, on one machine.
- A test can be selected for a region it did not run. It is never left
  unselected for one it ran, except a function called before the enclosing code
  in front of it, a hoisted declaration or one handed out earlier.
- A project whose plugin returns no map under Vite, whose rewrite maps back to
  another file, or whose Rstest config turned `devtool` off or left out the
  second loader, fails where it ran before. The error names the plugin, the
  file or the setting.

## What this forecloses

- A list of compilers or call shapes whose arguments are left unprobed. It is
  per library and per caller, and a skipped argument has no region of its own.
- Regions cut from compiled text.
- A silent fallback when a map is missing under Vite or Rstest.
