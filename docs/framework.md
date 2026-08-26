# The framework, as a dimension

Every dimension in this system reads the artefact — the markup, the CSS that applies
to it, the boxes it produced. The artefact is a render in the past tense, and a
whole class of fact never reaches it.

Two components can produce a byte-identical document and differ in everything
that decides what happens next: which one skips its parent's re-render, which one
keeps a row's state through a reorder, which one loses what the user typed. A
suite that cannot see those differences is not missing an edge case. It has
recorded two different components as the same component and called it a pass.

`@variance-authority/react` reads them off the fiber. There is no protocol to
adopt, no build plugin and no annotation — the fiber is already in the page, and
the four instruments below are four different questions asked of it.

| Instrument | Answers | Shape |
|---|---|---|
| [`wiringOf`](#wiring-a-sixth-digest) | how the framework holds this component — hooks, wrappers, contexts, keys | a **digest**, hashed and stored beside the others |
| [`remountedSince`](#remounts-what-the-document-cannot-show-you) | which instances were destroyed and rebuilt rather than updated | a **finding**, from an export you call |
| [`awaitQuiet`](stabilization.md#tapcommits--which-components-rendered-and-when-they-stopped) | which components are still committing, by name | a wait, and a diagnostic |
| [`awaitSuspense`](stabilization.md#pendingsuspense--the-boundary-that-has-not-arrived-by-name) | which boundary has not resolved, and who wrote it | a wait, and a **refusal** |

The last two are about a page that has not finished and live in
[`stabilization.md`](stabilization.md#the-framework-which-knows-when-it-has-finished).
This page is about the first two, which are about a page that has.

---

## Wiring: a sixth digest

```ts
collect(subject, { …, provenanceOf, wiringOf })
```

One option. With it, every component's root node carries what React knows about
that component, and `componentInstances` folds it into a `wiring` digest beside
`structure`, `semantics`, `text`, `style` and `geometry`.

| recorded | why it is not derivable from the document |
|---|---|
| **hook shape**, in call order | `useState` and `useReducer` leave the same markup. React's own record separates them; no heuristic can |
| **wrapper chain** — `memo`, `forwardRef` | a memoised component renders exactly what the unmemoised one renders, and re-renders on completely different occasions |
| **context subscriptions**, by display name | a component reading a theme and a component merely sitting inside a provider are the same markup and different components |
| **reconciliation keys** | `['0','1','2']` and `['a','b','c']` serialize identically and behave differently the moment the list reorders |

Measured on the example application
([`fiber.test.tsx`](../examples/todomvc/src/fiber.test.tsx)): a
`memo(Row)` with `useState` and `useContext` and a plain `Bare` returning the
same `<li>` agree on `rendering`, `structure`, `semantics`, `text` and `style` —
byte-identical `innerHTML` — and disagree on `wiring`.

**Hook *values* are deliberately absent.** `useState(0)` records `useState` and
never `0`. A value moves between two readings of an unchanged page by design, and
a dimension that moves when nothing changed is worse than none, because it
produces work.

### It stores nothing you were storing before

`wiring` sits **beside** `rendering` rather than inside it, exactly where
`geometry` already sits. `rendering` is the four content digests and its contract
is that two instances sharing it rendered the same thing — a component that gains
a `memo()` renders the same thing. So turning this on invalidates no baseline,
re-approves nothing, and changes no stored digest
([ADR-0036](context/adr/0036-the-fiber-is-a-band-and-a-finding.md)).

### Absent is not empty

A node no adapter could read is **absent** from the digest. A component that was
read perfectly and declares nothing reports an empty wiring, which is a different
claim and hashes differently. A page with no framework and a plain component must
not compare equal, and a component that *lost* its `memo` must not read like one
that never had a framework at all.

One conflation is real and is stated rather than hidden: React assigns
`_debugHookTypes` only once a hook runs, so a **hookless component in a
development build is indistinguishable from a production build**. Both report
absent. The cost is a component gaining its first `useState` reading as "became
readable"; the alternative claims something the observation does not support.

---

## Remounts: what the document cannot show you

React can respond to a parent's re-render in two ways. It can **update** a child —
keep the fiber, the hooks, the state, the DOM node — or it can **remount**: tear
the subtree down and build a new one. Both produce the same document. Not a
similar one, the same one.

What differs is everything the user had:

| | update | remount |
|---|---|---|
| `useState` | kept | reset to its initial value |
| focus | kept | lost to `<body>` |
| scroll position of a subtree | kept | reset |
| an uncontrolled `<input>` | kept | emptied |
| a CSS transition in flight | continues | restarts |
| `useEffect` with `[]` | does not re-run | runs again, cleanup fires |

```ts
const mark = markRender(subject);
// …do the thing: a click, a prop change, a route
const remounted = remountedSince(subject, mark);
// [{ name: 'InnerRow', owners: ['InlineHost'], element }]
```

Two calls by construction. After a page's first commit every fiber looks newly
built, correctly and uninterestingly, so a one-call `remounted()` would report the
entire page — the mark is what makes the distinction impossible to forget.

Measured
([`identity.test.tsx`](../packages/react/src/identity.test.tsx)): a child declared
inside its parent's body, which is the most common way to write this bug, against
the same child declared at module scope. The two renders serialize identically,
and a counter clicked once reads `1 of 1` under the stable child and `0 of 1`
under the inline one. That the same pair is identical in `rendering` and in
`wiring` as well is measured separately, on differently-named boundaries, in
[`fiber.test.tsx`](../examples/todomvc/src/fiber.test.tsx).

**A remount that was asked for and one that was not look identical**, so the
reconciliation key is reported rather than filtered on. Under a key, somebody
wrote `key={…}` and it changed — a decision. With no key, nothing asked for it.

**Findings come back cause-first.** A component that renders only another
component owns no element of its own, and it is usually the one the author wrote
and the one whose remount explains the rest, so `remounted[0]` is the outermost
thing that was rebuilt rather than the innermost thing that noticed.

### Why this is a finding and not a digest

The rule is checkable, and it is what splits this page in two: **read the same
page twice without changing anything, and if the value moved, it is not one.**

Hook shape, wrappers, contexts and keys survive that. Whether an instance
remounted cannot, by construction — it is a property of a *reading*, not of a
*revision*, and it has no value at all when read once. So it is reported by a
run, and never stored beside `style`.

The residual ambiguity is stated: two unkeyed siblings of one component at one
depth, one removed and one added, will match each other. That is a list with no
keys — which the wiring digest reports separately, and the two are meant to be read
together.

---

## What this does not do

- **It is React.** `collect()` takes `wiringOf` as a callback, exactly as it takes
  `provenanceOf`, so another framework supplies its own — but no other
  implementation exists, and a page without one is absent from the digest rather
  than reported as unwired.
- **Nothing waits on these two.** Wiring and remounts are exports a caller uses,
  and no shipped collector passes `wiringOf` — the digest is defined and hashed
  where a caller supplies the reader, and absent otherwise.
  The Suspense reader is the exception: every *browser* collector waits for
  boundaries to settle before it reads, and refuses a subject that is still
  showing a fallback
  ([`stabilization.md`](stabilization.md#pendingsuspense--the-boundary-that-has-not-arrived-by-name)).
  The commit tap is still an export, for the reason given there.
- **A remount is not attributed to a line.** It names the component, its owner
  chain and its element. Which parent re-render caused it is not recovered.
