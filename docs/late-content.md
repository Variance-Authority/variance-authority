# Content that loads late

A component that loads its code or its data after its first render shows a
placeholder, then its content, and a screenshot records whichever of the two is
on screen. A run waits for the late content React reports as pending: a
`React.lazy` component, a promise read with `use()` inside `<Suspense>`, a
server-rendered route that has not hydrated. When that wait runs out, or React
is stuck with nothing left arriving that could unstick it, the run refuses the
subject: it records nothing for it and fails with a message that names what is
still pending. Content an effect sets after it loads something is
not pending anywhere React can report, so the run records the placeholder and
says nothing. This page shows both kinds on one component, and how to turn the
second kind into the first. None of the ways is a sleep.

A run here is one execution of `npx variance run`, or one observation in your
test. A subject is what one screenshot is of: a route, a story, or the element
your test names. New here? Start with [your first run](start.md).

## One component, loaded two ways

Here is a diagram component that loads its renderer on demand. In the first
version an effect imports the renderer and stores the result in state:

```jsx
function Diagram({ source }) {
  const [svg, setSvg] = useState(null);
  useEffect(() => {
    import('./render-diagram')
      .then(({ render }) => render(source))
      .then(setSvg);
  }, [source]);
  return svg === null ? <Spinner /> : <div dangerouslySetInnerHTML={{ __html: svg }} />;
}
```

In the second version a component above a `<Suspense>` boundary starts the same
work as a promise, and the component under the boundary reads it with `use()`:

```jsx
function renderDiagram(source) {
  return import('./render-diagram').then(({ render }) => render(source));
}

function DiagramFrame({ source }) {
  const [diagram] = useState(() => renderDiagram(source));
  return (
    <Suspense fallback={<Spinner />}>
      <Diagram diagram={diagram} />
    </Suspense>
  );
}

function Diagram({ diagram }) {
  return <div dangerouslySetInnerHTML={{ __html: use(diagram) }} />;
}

// where it is used: a new source is a new frame, with a new promise
<DiagramFrame key={source} source={source} />;
```

Both versions show a user the same spinner and then the same diagram. A run
treats them differently, whenever the late work outlasts the run's own waits:

| What the component does | What the run records | What the run reports |
|---|---|---|
| `useEffect` → `import()` → `setState` | the placeholder | nothing |
| `useEffect` → `fetch()` → `setState` | the placeholder | nothing |
| `useEffect` → `setTimeout` → `setState` | the placeholder | nothing |
| `useEffect` → `import()` → CPU work → `setState` | the placeholder | nothing |
| `React.lazy` under `<Suspense>` | the content | the wait for the boundary |
| `use()` of an `import()` plus CPU work, under `<Suspense>` | the content | the wait for the boundary |
| the first row, with a `ready` marker declared | the content | the wait for the marker |
| `use()` of a promise that never settles, under `<Suspense>` | nothing: refused | the boundary, by name |

The effect versions record their content only when the late work finishes
before the run's waits do, which on a fast machine is a few tens of milliseconds
after the first render. Close to that point, what the run records depends on
how busy the machine is.

## What the run waits for

Before it reads a subject, the run waits for each of these:

- **A boundary showing its fallback.** A `React.lazy` component waiting for its
  chunk, or a component waiting for a promise it read with `use()`, makes the
  nearest `<Suspense>` above it show its fallback. The run waits until every
  boundary under the subject shows its children.
- **A route that has not hydrated.** The route collector, the part of this tool
  that opens each URL you name and reads it, waits until React has committed
  every root that reaches the subject, for as long as React has work it can do
  or the page is still receiving what React waits on. No clock ends it: a root
  React cannot finish, with nothing left arriving, is refused at once
  ([hydration, before anything is read](stabilization.md#hydration-before-anything-is-read)).
- **The marker you declare.** A `ready` selector, when you name one, is waited
  for first ([below](#mark-the-subject-ready)).

The defaults are 5 seconds for Suspense, and 10 seconds for a `ready` marker on
a route or 15 on a story. They are the `suspenseTimeoutMs` and `readyTimeoutMs`
options of the
[route collector](../packages/route-collector/README.md#options), the
`suspenseTimeoutMs` and `readyTimeoutMs` options of the
[Storybook collector](../packages/storybook-collector/README.md#options), and
`suspenseTimeoutMs` on one `observe` call in a Playwright test. A boundary still
open when its wait runs out refuses the subject, and the message names the
boundary, where it is, and, in a development build, the component that wrote
it. How the wait reads React's tree, and the message in full, are in
[holding a page still](stabilization.md#the-wait-and-the-decision-it-forces).

The run does not wait for a script or a `fetch` response requested after the
document has loaded. The route and Storybook collectors also hold the read until
the images, fonts and media the page requested are answered, and refuse the
subject, naming the URL, when one is still open as the wait runs out. A script
or a response still in flight when the subject is read is neither waited for
nor reported
([below](#what-the-run-does-not-see-work-an-effect-starts)). A `React.lazy`
chunk is still waited for, through its boundary.

## What the run does not see: work an effect starts

An effect runs after React commits a render. When that render shows a spinner
and the effect starts an import, a request or a timer, React has nothing
pending: the spinner is a finished render. The next render starts only when the
effect calls `setState`, and nothing on the page names that render before it
happens:

- **The browser's events** fire before it. `load` and `DOMContentLoaded` mark
  the document, not the work an effect starts after them.
- **A network wait** ends at the last response, not at the render the response
  leads to. Playwright's `networkidle` waits until no request has been in
  flight for 500 ms, so it covers a request an effect sent at mount. It does not
  cover work after the response, such as parsing, a second import, a timer or
  CPU work, or a request the effect sends after the quiet period. Keep
  `networkidle` where your tests use it; it does not replace the fix below.
- **Readings that agree** say the page is still, not that it is finished. Two
  screenshots of the spinner taken 50 ms apart agree.

Some of that work leaves a trace the run could read. An `import()` or a
`fetch()` an effect starts at mount is on the wire while the subject is read,
and the run neither waits for it nor names it. That is ours to fix. A timer is
not on the wire, and counting the page's timers would not help: a page with a
`setInterval` or a poll never reaches zero, and a timer does not say whether a
render follows it. Seeing one would mean replacing `setTimeout` in the page, and
the only part of the page's runtime a run replaces is `Date` ([how far an
intervention goes](stabilization.md#how-far-an-intervention-goes)).

That costs you in two ways. Close to the point where the work finishes as the
waits do, the subject records its spinner on one run and its content on the
next, and the change is reported against a component nobody edited. Far from
it the cost is quiet. The baseline is a picture of the spinner, every run after
it agrees, and the verdict is `unchanged`. A change inside the diagram is never
shown to anyone, because the diagram is never recorded.

## Put the work under Suspense

The fix is to put the work where React reports it: a promise that a component
under a `<Suspense>` boundary reads with `use()`. That is the second version of
the diagram above. It has one rule that matters: **the promise is created once
per input, by a component above the boundary.** Where the promise lives decides
whether it works and how long it stays in memory:

- **In the component that reads it**, the promise is new on every render. React
  keeps no state for a component that suspended before it first committed, so
  every attempt starts the work again, and the component suspends on each new
  promise forever.
- **In a module-level cache**, keyed by input, the promise is created once, but
  it lives as long as the page does. Every input ever rendered, and the result
  it settled with, stays in memory. That holds only for a small, fixed set of
  inputs.
- **In the state of the component above the boundary**, the promise is created
  once and goes when that component unmounts. `DiagramFrame` holds it, and
  `key={source}` makes a new source a new frame with a new promise. The work
  starts before the component that needs it renders, the pattern known as
  render-as-you-fetch.

The work can also stay in the effect, when it must not start during render: the
frame holds a promise that is not settled yet, and the effect settles it:

```jsx
function DiagramFrame({ source }) {
  const [diagram] = useState(() => Promise.withResolvers());
  useEffect(() => {
    renderDiagram(source).then(diagram.resolve, diagram.reject);
  }, [diagram, source]);
  return (
    <Suspense fallback={<Spinner />}>
      <Diagram diagram={diagram.promise} />
    </Suspense>
  );
}

// used the same way, keyed by source
<DiagramFrame key={source} source={source} />;
```

That is the first version with one change: the result goes into a promise the
boundary waits on, not into state. A promise settles once, so this frame needs
the key as much as the state-factory frame does: without it, a new source runs
the effect again and the old diagram stays.

Both frames run the work twice in development under `<StrictMode>`, which calls
the state factory and the effect twice and keeps one result. On a page the
server renders, they differ:

- **The state factory** runs on the server too, so the renderer has to load and
  run there, and the browser runs the work again when it hydrates.
- **The effect** never runs on the server, so its promise does not settle there.
  A streaming render holds the boundary open until the server gives up on it;
  render this frame in the browser only.

Wrapping the first version in `<Suspense>` does none of this. A boundary waits
only while something under it suspends, and an effect's spinner is a finished
render: the boundary shows it as its content, and the run records it as before.

After the change:

- **The run waits for the work.** The import and the render are inside the
  promise, so the boundary shows its fallback until both are done.
- **Work that fails reaches your error boundary.** A chunk that does not load
  or a render that throws rejects the promise, and the nearest error boundary
  shows its state instead of a spinner that never goes.
- **Work that never finishes is reported.** A promise that never settles keeps
  its boundary open, and the run refuses the subject with the boundary's name
  instead of recording a spinner as your baseline.
- **Your users see the same thing on the first render.** The boundary's
  fallback is the spinner the effect used to render. On a new source the keyed
  frame shows the spinner again, where the effect kept the old diagram until the
  new one was ready. To keep the old one, hold `{ source, promise }` in state
  without a key, replace it when `source` changes, and read it through
  `useDeferredValue`.

`use()` is React 19. On React 18, use `React.lazy` for code, and the Suspense
mode of your data library for data, for example `useSuspenseQuery` in TanStack
Query, with `source` in the query key. The library keeps the promise in its own
cache, and drops an entry once no component has read it for a while, `gcTime` in
TanStack Query. Work that is code and then computation, like the diagram, goes
in the data library's query function as one promise. Both suspend the same way,
and the run waits for them the same way.

## When the work cannot reach a boundary

Some work cannot be handed to a boundary: a third-party widget that renders
itself, a component you do not own. Then you say when the subject is done, or
you say that the placeholder is what you review.

Do not add a sleep. A sleep is a guess about the machine. A delay that is long
enough on your laptop is too short on a busy CI runner, and every subject that
has one pays the full delay on every run, even when its content arrived at
once.

### Mark the subject ready

Render a marker in the same render as the content, and tell the run to wait for
it:

```jsx
return svg === null
  ? <Spinner />
  : <div data-diagram-ready dangerouslySetInnerHTML={{ __html: svg }} />;
```

- **The route collector** takes `ready`, keyed by the key you gave the route in
  `routes`, or by a glob over those keys:
  `ready: { 'docs/diagram': '[data-diagram-ready]' }`.
- **The Storybook collector** takes `ready` keyed by story id:
  `ready: { 'docs-diagram--default': '[data-diagram-ready]' }`
  ([a story that is not ready](start-storybook.md#a-story-that-is-not-ready-when-storybook-signals-it-is)).
- **A Playwright test** waits itself before it observes:

  ```ts
  const diagram = page.getByTestId('diagram');
  await expect(diagram.locator('[data-diagram-ready]')).toBeVisible();
  const observation = await observe(page, diagram, testInfo, { subjectId: 'docs/diagram' });
  ```

A marker that never appears fails the subject after `readyTimeoutMs`, with the
selector named. The marker is only as true as the render that adds it: put it
on the element the content renders, not on a parent that renders first.

### When the spinner is the state you review

Sometimes the loading state is the design under review. Declare it, and the run
records the fallback on purpose: `loading: ['docs/diagram-loading']` on a
collector, or `loading: true` in `observe`
([loading and Suspense boundaries](../packages/playwright-test/README.md#loading-and-suspense-boundaries)).
A subject declared this way waits for no boundary, and the declaration is
checked in both directions
([the wait, and the decision it forces](stabilization.md#the-wait-and-the-decision-it-forces)).
One of those checks is the one an effect spinner meets: a declared subject that
holds no Suspense boundary at all is refused, and in a Playwright test `observe`
throws, because an effect's spinner is not a fallback.

So the loading state of the first version of the diagram cannot be declared:
nothing on the page says its spinner is a loading state rather than content that
has not arrived. Put the work under Suspense first, then give the declared
subject a promise that does not settle while it is read, for example a story that reads a
promise which never settles. Its boundary stays open, and the run records the
fallback every time.
