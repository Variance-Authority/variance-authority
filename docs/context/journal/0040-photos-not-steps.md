# Journal 0040 — Photos, not steps

**Date:** 2026-09-06

Three clean-room rounds, each a set of subagents given the question and no
prior answer, on what a journey — the set of source regions a subject entered
while it was painted — says beside that subject's Fiber and DOM tree. No code
was written and nothing was measured; the cost was the rounds themselves, and
the result is [ADR-0056](../adr/0056-a-journey-is-the-places-visited.md) with
[spec 0038](../../specs/0038-a-journey-is-read-against-the-committed-tree.md)
holding what the decision makes possible and does not build.

**Round one** asked for the four cells of journey against output. Same journey and same output is
redundancy or an inert axis, and redundancy is a set property that needs
containment before it can be named. Different journey and same output is a
divergence with no observable consequence: a cache hit against a miss, a memo, a
telemetry branch, a swallowed `catch`, a service branch that returned the same
row. Never a reason to merge baselines, and a `catch` in the delta with identical
output is a product defect. Same journey and different output is data flowing
through the same code, which is ordinary, and becomes an untracked input only
when the props digest — the hash of a component's props that a boundary carries
— is equal and the environment is clamped. Different and different is the
normal case, and its value is correspondence. Output granularity names the
cause: Fiber props, then DOM, then pixels, and a DOM that differs under
identical pixels is semantics that moved. Only an output against an accepted
baseline is a verdict; journeys explain or withhold.

**Round two** started from memoization. A module-scope cache with one slot makes
a subject's journey depend on its immediate neighbour on a reused page, and
selection changes the neighbour. `useMemo` is absorbed by presence: the first
render computes, the cache lives in the Fiber, a remount recomputes. The
correction came from the user: purity has two halves, the output *and* the
places, so a journey that moved with output held is an impurity awaiting its
trigger, not a benign cell. The predicate is that a journey be a function of the
props digest, the scenario and the run's identity.

**Round three** was concurrent React and the start boundary. The agents refuted
the premise that a stable journey is what modern React yields and an unstable
one is state outside it: restarts after interleaved updates, discarded renders,
StrictMode's doubled effects, a cold Suspense cache, React 19 sibling
prewarming, the eager-state bailout, first-subject hydration, `useDeferredValue`
and `Activity` all move the set with every input fixed. `useMemo` is a hint
React may discard. The agents ranked the responses: block-granular comparison,
then a derived quarantine, then a user's prune gated to places already reported
unstable; depth limits never. On selection they confirmed that the instrument's
first goal — a change to a click handler selecting nothing that only rendered —
is already met with no phase tag: the drain separates subjects in time, the
lexical name says which phase a region is, and selection takes the innermost
region of each changed line.

**The turn.** I proposed occurrence records with enter and exit brackets and a
current-block global so the picture could be rebuilt. The user overturned it in
one move: an `async` function has many enters and exits, so the path can be
reconstructed as the photographs taken and never as the steps walked. What
survives is what was visited. Block identity then comes from the inventory
rather than from the runtime, and the committed Fiber — React's own record of
which attempt won — is the arbiter of what the visited places belonged to.

The user's picture of it: one traveller walks from A to C through B, photographs
the lake and the waterfall, rests on the bench at the cliff top. A family walks
the same trail, reaches the same milestones in the same order, stops at the same
places, takes the same photographs. The record is identical and the journeys
were not, least of all for the dog. That is the record on purpose: it equates
two executions by their milestones, and what the dog did between them is
recoverable only where it left a milestone off the trail — a region under a
component the committed tree does not hold.

The user then named the premise the rounds had walked past: the record says
*have you been here* and *left or right at that fork*, and both arms can have
been walked. A journey is a memory of the real trip — a map, and the map is not
the territory. Every tree and every deviation the rounds argued over was drawn
on the map, and the premise is now the first line under the decision.

**Found on the way.** [`journal.ts`](../../../packages/sense/src/test-selection/journal.ts)
shares a module's root region with every drained subject and charges every other
region entered during module evaluation to the subject in whose window the
module first evaluated. A helper called at module initialization is invisible to
every later subject's selection. Marked at the site with a `FIXME` and an
`it.todo`, not fixed here.

**Corrected by review.** A blind reading of the first draft against the code
found the block-name examples wrong — the instrument names a component's entry
`CartCard`, an effect callback `useEffect.arg0`, and an inline JSX handler
`anon#n`, never `CartCard/render` or `useEffect@2` — and found four readers
written in the present tense with no code under them. The names were corrected
and the readers moved into spec 0038. The same reading found that the reverse
index still accepts a call-stack depth from a foreign execution index; the ADR
records that this project's own record writes none.
