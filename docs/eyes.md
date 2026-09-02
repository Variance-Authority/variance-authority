# Eyes

Eyes records the DOM elements a test addresses and attributes each live element
to the React tree that rendered it. The record describes test attention: selector
intent, the element resolved at that point, and the action, read, assertion, or
browser event that consumed it. An adopter can place authored Arrange, Act, and
Assert markers in the same chronology. Eyes records those markers and never
classifies surrounding evidence from an API name.

Fiber attribution is copied in the synchronous turn that observes the element.
React deletes its Fiber pointer when a node unmounts, and its double-buffered
tree can make an old pointer describe the previous commit. Eyes resolves the
current Fiber, copies the owner and author evidence, and retains no Fiber or DOM
reference in the journal. Source-map enrichment may happen later; discovering
the Fiber may not.

## RTL

The RTL entrypoint instruments the bound query functions on a supplied `screen`
object. A call to `getByRole`, `queryByText`, or another singular or plural bound
query records its arguments and snapshots every returned node before returning
control to the test. A `findBy` promise registers the snapshot continuation
before the caller receives the promise, so attribution precedes the caller's
`await` continuation.

A query returning `null` records `absent`. A plural query returning no nodes
records `resolved` with an empty target list: the query determined that the set
was empty. A thrown query records the error and rethrows the same value.

`screen` is one bound query object. `within(container)` and the query functions
returned by `render()` are other objects, so instrumenting `screen` does not
claim to observe them.

## Playwright

The Playwright entrypoint exports unbound fixtures. A suite composes those
fixtures into its own extension module and keeps ownership of `test`, `expect`,
configuration, and lifecycle.

Playwright Locators are lazy. Creating `page.getByRole(...)` records the locator
plan but no DOM attribution. A read, action, or assertion snapshots current
matches immediately before consumption and again after it settles. Capture-phase
document listeners snapshot actual event targets before React's delegated event
handler can remove them. An element appearing during a positive assertion is
therefore available after the matcher; an element removed by an action is
available from the event record and the pre-action snapshot.

An assertion on absence carries the locator plan and an observed empty match
set. It carries no invented component owner.

The page agent installs React's commit hook before application code loads. A
commit records `PerformedWork` component names separately from React's
`memoizedUpdaters`: the first says which render bodies ran, while the second
names the live component paths that initiated the update. Each updater path is
innermost first and retains component name, reconciliation key, props digest,
and a JSX source coordinate when React exposes one. Missing updater evidence
means the renderer did not expose the set; an empty updater list is a completed
reading.

## Test chronology

An Eyes log is a monotonic journal within one test realm. `phase('arrange')`,
`phase('act')`, and `phase('assert')` append authored boundaries; later attention
belongs to the most recent marker when a reader presents the chronology. Calls
before any marker remain explicitly unphased. React commits use the same rule,
so an update can be related to the phase in which it occurred without claiming
which callback, event, or source region caused it.

An Eyes archive groups journals under the runner's stable test identity. Every
journal is either complete or partial with a reason. The archive is portable
JSON, so a runner attachment, Jest/Vitest setup integration, or another harness
can hand the same selector, locator, event, and Fiber evidence to an external
reader after the live DOM is gone.

## Boundaries

Eyes reads React's host-node Fiber pointer. A non-React node, unhydrated server
markup, and a node whose Fiber has already been removed produce an explicit
no-Fiber result. Production builds may omit author names and source candidates;
those fields remain absent.

The document event channel covers user-facing DOM events. A store mutation,
network request, timer, or direct function call that emits no DOM event is not
classified as an action by Eyes. A memoized updater identifies the component
instance that scheduled work, not the source statement or callback that invoked
it. Execution regions remain the responsibility of Sense, and cross-realm
correlation remains the responsibility of Journey.
