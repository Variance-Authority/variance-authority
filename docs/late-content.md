# Content that loads late

A component that loads its code or its data after its first render shows a
placeholder, then its content, and a screenshot records whichever of the two is
on screen. A run waits for the late content React reports as pending: a
`React.lazy` component, a promise read with `use()` inside `<Suspense>`, a
server-rendered route that has not hydrated. When that wait runs out, the run
refuses the subject: it records nothing for it and fails with a message that
names what is still pending. Content an effect sets after it loads something is
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

In the second version the same work is a promise, and the component reads it
with `use()` under a `<Suspense>` boundary:

```jsx
const rendered = new Map();

function diagramOf(source) {
  if (!rendered.has(source)) {
    rendered.set(source, import('./render-diagram').then(({ render }) => render(source)));
  }
  return rendered.get(source);
}

function Diagram({ source }) {
  const svg = use(diagramOf(source));
  return <div dangerouslySetInnerHTML={{ __html: svg }} />;
}

// where it is used
<Suspense fallback={<Spinner />}>
  <Diagram source={source} />
</Suspense>;
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
  every root on a server-rendered route.
- **The marker you declare.** A `ready` selector, when you name one, is waited
  for first ([below](#mark-the-subject-ready)).

The defaults are 5 seconds for Suspense, 2 seconds for hydration on a route,
and 10 seconds for a `ready` marker on a route or 15 on a story. They are the
`suspenseTimeoutMs`, `hydrationTimeoutMs` and `readyTimeoutMs` options of the
[route collector](../packages/route-collector/README.md#options), the
`suspenseTimeoutMs` and `readyTimeoutMs` options of the
[Storybook collector](../packages/storybook-collector/README.md#options), and
`suspenseTimeoutMs` on one `observe` call in a Playwright test. A boundary still
open when its wait runs out refuses the subject, and the message names the
boundary, where it is, and the component that wrote it. How the wait reads
React's tree, and the message in full, are in
[holding a page still](stabilization.md#the-wait-and-the-decision-it-forces).

The run does not wait for scripts or `fetch` responses. The collectors' network
wait counts the images, fonts and media the page requested, and a script or a
response still in flight when the subject is read is neither waited for nor
reported. A `React.lazy` chunk is still waited for, through its boundary.

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

A timer or CPU work could be seen only by replacing `setTimeout` or `Promise` in
the page, and a run does not substitute the page's runtime: a difference the
patch caused would read as one your code caused
([how far an intervention goes](stabilization.md#how-far-an-intervention-goes)).

That costs you in two ways. Close to the point where the work finishes as the
waits do, the subject records its spinner on one run and its content on the
next, and the change is reported against a component nobody edited. Far from
it the cost is quiet. The baseline is a picture of the spinner, every run after
it agrees, and the verdict is `unchanged`. A change inside the diagram is never
shown to anyone, because the diagram is never recorded.

## Put the work under Suspense

The fix is to put the work where React reports it: a promise the component
reads with `use()`, under a `<Suspense>` boundary. That is the second version
of the diagram above. It has one rule that matters: **one promise per input,
created outside render.** `diagramOf` keeps one promise for each `source` in a
module-level map. A promise created inside the component body is a new promise
on every render, and the component suspends on each new one forever.

After the change:

- **The run waits for the work.** The import and the render are inside the
  promise, so the boundary shows its fallback until both are done.
- **Work that never finishes is reported.** A promise that never settles keeps
  its boundary open, and the run refuses the subject with the boundary's name
  instead of recording a spinner as your baseline.
- **Your users see the same thing.** The boundary's fallback is the spinner the
  effect used to render.

`use()` is React 19. On React 18, use `React.lazy` for code, and the Suspense
mode of your data library for data, for example `useSuspenseQuery` in TanStack
Query. Work that is code and then computation, like the diagram, goes in the
data library's query function as one promise. Both suspend the same way, and
the run waits for them the same way.

## When the work stays in an effect

Some work stays in an effect: a third-party widget that renders itself, a
measurement of the laid-out page, a component you do not own. Then you say
when the subject is done, or you say that the placeholder is what you review.

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
A declared subject waits for no boundary, and the declaration is checked in both
directions ([the wait, and the decision it forces](stabilization.md#the-wait-and-the-decision-it-forces)).
One of those checks is the one an effect spinner meets: a declared subject that
holds no Suspense boundary at all is refused, and in a Playwright test `observe`
throws, because an effect's spinner is not a fallback.

So the loading state of the first version of the diagram cannot be recorded on
purpose. Put the work under Suspense first, then give the declared subject a
promise that does not settle while it is read, for example a story that reads a
promise which never settles. Its boundary stays open, and the run records the
fallback every time.
