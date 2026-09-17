# Spec 0051 — a sensitivity is scoped by id and nothing else

**Missing:** every axis but one. A sensitivity declares which bands a subject
asserts on, and the only thing it can be scoped to is the subject's id —
`subjects` is a list of globs and `appliesToSubject` matches them against the id
string (`packages/core/src/judge/scope.ts`). One declaration therefore covers a
whole page at one grain, and every finer statement an operator might want to
make has nowhere to be written down.

## 1. The page is not uniform and the declaration is

A route declared at `geometry` is saying *this page asserts that it still
assembles*. That is right for the shell — the nav, the sidebar, the regions —
and wrong for the one component the page exists to show, which is the thing a
component test would have asserted on in full. Today those two are the same
subject, so the operator picks the grain that hurts least and loses the other:
declare the route strictly and a token landing in forty routes turns them all
red, declare it loosely and a content defect inside the panel is absorbed with
the rebrand.

The missing axis is *where inside the subject*. Not a pixel region — that is an
[ignore](../ignores.md), which excludes a named place and counts what it
absorbed. A sensitivity states a kind of change, and the kind that matters is
not uniform across a page.

## 2. What a journey would supply, and what it would not

A [journey](../journeys.md) is the set of regions one execution entered
while it was painted. It knows something no declaration does: which parts of the
source this subject's render actually went through, per subject, as of the last
run. That is the first reading in the tree that could scope a sensitivity to
something other than a name the operator typed.

What it would not supply is the map from a region to a place on the page. A
journey names source regions; a band names a kind of difference the comparison
found between two documents. Nothing joins a region to the nodes it produced, so
"assert on `content` in the part of the page `CartCard` rendered" cannot be
evaluated today even with every journey recorded. The
[component hash](../../packages/core/src/attribute/component-hash.ts) attributes
a difference to a component; whether that attribution is the join, or only looks
like it, is the first question this spec owes an answer to.

## 3. Three refusals this must keep

A declaration that derives itself from a recording stops being a declaration.
Everything an [ignore](../ignores.md) owes, a sensitivity owes: an id, a
reason, a place, and a count of what it absorbed in the report. So:

- **Never inferred from a run.** A sensitivity that widens or narrows because
  last night's execution took a different branch is a policy nobody attributed
  and nobody can disagree with six months later. A recording may be what a
  declaration *names*; it may not be what decides.
- **Never silent when the recording is absent.** A subject with no journey has
  to fall back to the subject-wide declaration and say so, the way an absent
  component list is read as *unknown* and never as *renders nothing*.
- **Never a threshold in a costume.** The unit stays the band. A region-scoped
  sensitivity absorbs exactly one kind of change in exactly one place, however
  large; it never absorbs anything small enough.

## 4. The order the work comes in

Nothing here is blocked on a decision. It is blocked on a measurement and a
join, in that order:

1. Whether the component attribution on a difference is stable enough to scope a
   declaration to — measured on a suite where the same component appears in many
   subjects, not on one where it appears once.
2. Whether a region and a difference can be joined at all, or whether the
   component is the finest thing the two sides share.
3. Only then, the config shape: what an operator writes, and what the report
   prints so the absorption is visible.

## What it forecloses

Scoping by anything the operator did not write. Deriving a policy from a
recording. Replacing the band with a size. Letting a subject with no journey
silently assert on less than its declaration says.
