# Spec 0019 — Provenance without React

**Missing:** one non-React application, actually run. The path exists, is
twenty-five lines, and has never carried a real Vue, Svelte or Angular tree.
**Built on:** `attributeProvenance` at
[`packages/dom/src/attributed.ts`](../../packages/dom/src/attributed.ts), and the
caller-supplied provenance callback that makes the framework a count of
implementations rather than a property of the approach.

## Purpose

Attribution needs exactly two things per element: a component name and a digest
of what was passed in. React supplies both from fibers, which is why the React
path needed nothing written. Everything else supplies them from two `data-*`
attributes, which is what a build step already emits — Vue's
`vite-plugin-vue-inspector` emits an attribute of this shape, and Svelte's
compiler knows the component and the file for every element.

So the claim "this is not React-only" rests on twenty-five lines of code and two
ecosystem facts, and on no application. That is the weakest evidence-to-claim
ratio in the project: the reasoning is sound and entirely untested, and the
failure modes it would meet are the ones reasoning does not find.

## What would discharge it

**One application per framework is too many. One is enough to start.** Take a
Vue or Svelte application somebody else wrote, add the build plugin, and score it
the way [`cases/`](../../cases) scores everything else — declared ground truth
before the run.

What the run has to demonstrate, beyond "it produced names":

- **A component boundary that means the same thing.** The subject boundary is the
  component tree
  ([ADR-0007](../context/adr/0007-subject-boundary-is-the-component-tree.md)),
  and a framework whose components do not nest the way React's do may not
  partition a document the same way. Slots, scoped styles and single-file
  component boundaries are where this is most likely to be wrong.
- **A file that resolves.** A name without a `file:line` is what every competitor
  already gives.
- **The attributes are dropped before hashing.** They are, by construction, so
  adding the build plugin invalidates no stored baseline — but that is asserted
  and not observed against a real build.

## The prerequisite nobody documents

A build that preserves function names. A minified bundle reports `a` instead of
`Button`, in every framework, and the React path has the same requirement — it is
simply invisible in development. Whatever lands here should say it once, in a
place both paths reach.

## Leaves behind

An ADR only if the component boundary turns out to differ. If two `data-*`
attributes are genuinely sufficient, the evidence belongs in a case and a journal
entry, and this file is deleted with nothing lifted out of it.
