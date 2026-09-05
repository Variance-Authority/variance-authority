# Spec 0036 — a journey crosses processes, and no import declares it

**Missing:** the edge, and every head nobody can rebuild. A journey crosses a
process today — one opaque id per execution rides a cookie, a Node service
collects under it in async context, and one record per run joins what every head
entered to the subject that caused it
([`sense/journey`](../../packages/sense/src/test-selection/journey.ts)). That buys
*what a head executed*, and it buys nothing wherever the head was not built with
probes. `fetch('/api/cart')` is still a string: nothing records that a subject
called an endpoint, nothing resolves an endpoint to the file that served it, and
nothing follows a call the browser never made.
**Built on:** [0028](0028-the-instrument.md) (the instrument, and its rule that a
new realm needs a transport rather than a second instrument),
[0029](0029-what-a-run-remembers.md) (what may be trusted rather than merely
read), [0030](0030-a-diff-lands-on-blocks.md) (the diff-to-block mapping this
feeds), [0035](0035-a-flake-is-what-the-run-did-not-execute.md) (the ladder that
has no rung for a cause on the other side of a request),
[ADR-0004](../context/adr/0004-defer-native-acceleration.md) (a cost is a measured
number before it is a design),
[ADR-0038](../context/adr/0038-a-change-reaches-a-component-through-files.md) and
[ADR-0041](../context/adr/0041-a-request-is-the-edge-a-binding-is-the-name.md)
(how a change reaches a component through files, and what a specifier can be asked).

## Purpose

**Between a component and the handler that answers it there is no edge at all.**
Not a weak one, not an over-broad one: `fetch('/api/cart')` is a string, and every
structure this project derives selection and attribution from is built by
resolving specifiers. Two services in one repository, in one process tree, on one
machine, are as unrelated to the file graph as two repositories would be. So a
change to `app/api/cart/route.ts` reaches no component, the walk refuses, and the
suite runs whole — the safe answer, and worth nothing. In the other direction it
is worse than nothing: when a subject's pixels move because a handler started
returning a different row, the movement ladder has no rung that can reach the
cause, and the run reports `unexplained` over a diff that plainly explains it.

The same blindness has a second face inside one service. A change to
`app/globals.css` resolves cleanly — `globals.css ← layout.tsx ← RootLayout` — and
then rules out every subject in the suite, because no baseline records
`RootLayout`: it is a server component, and the seam that writes a source location
onto an element is installed in the build that ships to the browser. The run
reports **0 of 21 subjects observed** and exits 0. The structural ground
([`affected.ts`](../../packages/cli/src/commands/affected.ts)) did not fail to find
a component; it found one, and a name nothing in the suite can match is
indistinguishable from a name nothing in the suite renders. The second ground
([`journey.ts`](../../packages/cli/src/commands/journey.ts)) cannot repair it — it
is offered only what the first one kept, and it only ever removes.

**Both are the same fact: the code ran where nothing was watching.** A server
component, a loader, a middleware, a route handler. All of it is product source,
all of it sits between the diff and the pixel, and none of it can appear in a
coverage index whose only collector is a page or in a graph whose only edge is an
import.

A component that renders markup on the server is reachable a cheaper way — install
the provenance runtime in the server build and its elements carry a location. That
settles the one case and nothing else, because provenance answers *which
component's JSX made this node* and can never answer *which code ran to produce
what the node says*. A loader that returned a different row has no element to
carry a location. Only a record of what executed reaches it.

**A head that can be rebuilt is watched.** A service built with
`testSelectionProbes()` and running `collectJourneys` records which blocks each
journey entered; the driver holds `journey -> subject` and is the only participant
that does, so the join happens there, and one record per run puts a service's
crossings in the same index as a page's without either retiring the other. That
reaches a loader, a middleware, a route handler and a server component. It reaches
none of them in a service the adopter cannot rebuild, and no hop the browser never
made.

## What would discharge it

**1. The edge, observed — and this is the floor.** A run records which journey
called which endpoint. The driver already sees every request the page made and
already knows whose it is, so the observation needs no header, no propagation and
no change to the service: it is one listener and a filter to the origins the
operator declared as product. That alone converts *a handler changed, so run all
three hundred* into *these four subjects called it*.

```ts
/** One call a journey made, as the driver saw it leave. */
interface ObservedCall {
  readonly owner: string;
  readonly method: string;
  readonly endpoint: string;
}
```

**2. The endpoint resolves to a file, and the record says who answered.** Three
authorities, and they are not equally good:

- **the head says so** — a response header naming the module that served the
  request. Exact, and the only one that survives dynamic segments, rewrites, route
  groups and catch-alls. Costs the adopter one middleware.
- **the filesystem convention** — the route is the path, for every framework whose
  routing is a directory. Free, and wrong exactly where the header is right.
- **a build manifest** — what the framework wrote down. Framework-version-shaped,
  and it drifts silently.

An asserted edge and an inferred one are different evidence and are stored as
different evidence. A run that inferred `/api/items/42` onto a file it guessed
must be able to say so, because the alternative is a narrowing whose ground nobody
can check.

**3. One hop, and the record says so.** A driver sees what the browser sent and
nothing else. A handler that calls a second service, a render that fetches
internally, a queue worker downstream of either — none of that crosses the
browser, and none of it is observed. So an edge record is honest only when it
names the origins it watched, and a change behind an origin nobody watched has to
widen. This is what stops a run implying it mapped a service graph when what it
did was watch one hop of one.

**4. The edge belongs in the index, not in the file graph.** `Relations` is
scanned from source at rest, and every consumer reads it that way — a trail whose
hops were half derived and half remembered is a trail a reviewer cannot check
without being told which each hop was. The coverage index is already the right
home: it holds which owners entered which file, it carries the trust rules that
decide when a row may be believed rather than merely read, and it already
separates *not instrumented* from *not executed*. A handler known only by a
request is a module the index knows was entered and cannot say where inside.

That is a module-level owner list, and it must not be spelled as a module-kind
block. *Probes ran and only the module probe fired* and *there were never any
probes and a request arrived* are the two facts this format exists to keep apart,
and one of them may justify an exclusion.

**5. The second hop, or an honest refusal.** A cookie reaches the head the browser
called and stops there. `journeyOf` reads what arrived and nothing puts it back on
the request that handler makes next, so a service behind another service is
unattributed however well it is instrumented. The forwarder is small — the id is
already in async context — but until a record names which heads forwarded and
which did not, a change behind the second hop has to widen exactly as a change
behind an unwatched origin does.

**6. The head's cost is a number in the harness.**
`packages/sense/scripts/overhead.mjs` reports against a control band of two
identical uninstrumented builds, and the journey-keyed factory is not an arm in
it. A getter over async context costs one context read per probe, plus a
re-resolve wherever two journeys interleave inside one module — a curve
proportional to real interleaving and flat where there is none.
[ADR-0004](../context/adr/0004-defer-native-acceleration.md) says that is measured
before it is designed around.

**Acceptance is two runs on one machine, and they are not the same size.**

1. A change to one route handler observes the subjects that called it and skips
   the rest, in a repository whose head is somebody else's binary — no probes, no
   rebuild, one listener in the driver. Needs items 1 to 4 and nothing else.
2. A change inside a service the watched head calls narrows to the subjects whose
   calls reached it, instead of widening at the first hop. Needs item 5.

## What it forecloses

**An observed edge is not a service map.** It is one hop, watched from one side,
for the journeys a run happened to drive. Nothing here enumerates endpoints,
discovers services, or claims a call that was not made during a recorded run.

**The file graph stays derived.** Recorded edges do not enter `Relations`, and a
reach trail keeps meaning *these specifiers resolved to these files*. The two
kinds of knowledge stay in the two structures whose trust rules already match
them.

**This does not repair the structural ground, and nothing will.** It cannot
distinguish a component nobody renders from a component nobody can see: both are a
name absent from every baseline, and widening whenever a touched component matches
no baseline would give up the saving the selector exists for. What is available
today, and is hours rather than this spec, is the *sentence*: a narrowing that
empties the suite says so once, at the tally, instead of once per subject in a
list nobody reads to the end. That does not make the answer right. It makes the
two ways of reaching 0 of 21 tell themselves apart.

**Depth does not cross a process, and the record holds none.** This project's
record carries no call-stack depth
([ADR-0056](../context/adr/0056-a-journey-is-the-places-visited.md)); a foreign
execution index may supply one per crossing, and no stack runs from a click in a
page into a request handler. A cross-head crossing carries its own head's depth
or it carries nothing; joining the two would be arithmetic on unrelated units.

**A journey is not a new coordinate.** It is one owner observed in several realms.
Nothing in the index, the report or the selector starts naming journeys where it
names test files, because a second vocabulary for one fact is how two of them come
to disagree.

**The browser does not pay for the server's concurrency.** Whatever a Node head
does to resolve a journey per increment, a page keeps its cached array: one realm,
one subject, and no page is charged for a problem it does not have.

**No native collector, and the gate is a number.**
[ADR-0004](../context/adr/0004-defer-native-acceleration.md) holds unchanged. The
per-increment regime is justified by the overhead harness reporting it outside the
control band, not by the volume of requests sounding large.
