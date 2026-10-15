# Content that loads late

A component that loads its code or its data after its first render shows a
placeholder, then its content. A screenshot records whichever of the two is on
screen, so the same unchanged component can record its spinner on a slow
machine and its content on a fast one. A run is one execution of
`npx variance run`, or one observation in your test. It waits for the late
content React reports as pending: a `React.lazy` component, a promise read with
`use()` inside `<Suspense>`, a server-rendered route that has not hydrated. If
the wait runs out, the run refuses the subject. A subject is what one
screenshot is of: a route, a story, or the element your test names. Refused
means the run records nothing for it and fails with a message that names the
boundary still waiting. Content that an effect sets after it has
loaded something is reported nowhere. React does not count it as pending, so
nothing that waits can wait for it, and the run records the placeholder without
a word. This page shows both kinds on one component, and how to change the
second kind into one a run waits for. None of the ways is a sleep.

New here? Start with [your first run](start.md).

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

Both versions show the same spinner and then the same diagram to a user. To a
run they are different. The table below is six runs of each pattern through the
[route collector](../packages/route-collector/README.md),
the part of this tool that opens each URL you name and reads it, on one page whose late module is served 600 ms after it is
requested, on an M4 Max laptop:

| What the component does | Recorded, in 6 runs | What the run reported |
|---|---|---|
| `useEffect` → `import()` → `setState` | the placeholder, 6 times | nothing |
| `useEffect` → `fetch()` → `setState` | the placeholder, 6 times | nothing |
| `useEffect` → a 400 ms `setTimeout` → `setState` | the placeholder, 6 times | nothing |
| `useEffect` → `import()` → 400 ms of CPU work in slices → `setState` | the placeholder, 6 times | nothing |
| `React.lazy` under `<Suspense>` | the content, 6 times | the wait for the boundary |
| `use()` of an `import()` plus 400 ms of work, under `<Suspense>` | the content, 6 times | the wait for the boundary |
| the first row, with a `ready` marker declared | the content, 6 times | the wait for the marker |
| `use()` of a promise that never settles, under `<Suspense>` | nothing: refused, 6 times | the boundary, by name, after 5 s |

Six placeholders out of six is the stable form of the failure. In the same
experiment, with the late work shortened, the effect versions recorded their content
when the work took 20 ms or less, and their placeholder when it took 40 ms or
more. Between those two numbers, what the run records depends on how busy the
machine is.

## What the run waits for

Before it reads a subject, the run asks React what is still pending, and waits
for each of these:

- **A boundary showing its fallback.** A `React.lazy` component waiting for its
  chunk, or a component waiting for a promise it read with `use()`, makes the
  nearest `<Suspense>` above it show its fallback. The run waits until every
  boundary under the subject shows its children, in two readings in a row. The
  second reading is there because a boundary that resolves can render a child
  that suspends on a new boundary.
- **A route that has not hydrated.** The route collector waits until React has
  committed every root on a server-rendered route, because until then no
  component on it has run its effects.
- **The marker you declare.** A `ready` selector, when you name one, is waited
  for first ([below](#mark-the-subject-ready)).

Each wait has a default length: 2 seconds for hydration, 5 seconds for
Suspense, and 10 seconds for a `ready` marker on a route or 15 on a story. You
set them once per collector as `hydrationTimeoutMs`, `suspenseTimeoutMs` and
`readyTimeoutMs` (the options of the
[route collector](../packages/route-collector/README.md#options) and the
[Storybook collector](../packages/storybook-collector/README.md#options)), or
as `suspenseTimeoutMs` on one `observe` call in a Playwright test. A subject that is still pending when its wait runs out is refused, and the
message names the boundary and where it is, and the component that wrote it
when one did:

```
`use-never` was still waiting when it was read: 1 Suspense boundary(s) had not
resolved after 5006ms — <Suspense> at the root of the subject. This is a flake
source: the same subject records a fallback on a slow run and its content on a
fast one, and nobody wrote that difference. Fix what the boundary is waiting
for, or declare this subject as a loading-state capture to record the fallback
deliberately.
```

The run also waits for the images, fonts and media the page requested. It does
not wait for scripts or `fetch` responses. A chunk or a response changes the
screen only through the render that uses it, and React reports that render
when it is pending. How each wait reads React's tree is in
[holding a page still](stabilization.md#the-wait-and-the-decision-it-forces).

## What nothing can wait for: work an effect starts

An effect runs after React commits a render. When the render shows a spinner
and the effect starts an import, a request or a timer, React has nothing
pending: the spinner is a finished render. The next render starts only when
the effect calls `setState`, and nothing on the page names that render before
it happens. So no wait can see it:

- **The browser's events** fire before it. `load` and `DOMContentLoaded` mark
  the document, not the work an effect starts after them.
- **A network wait** ends at the last response, not at the render the response
  leads to. Playwright's `networkidle` waits until no request has been in
  flight for 500 ms, and so it covers a request an effect sent at mount. It
  does not cover work after the response, such as parsing, a second import, a
  timer or CPU work, or a request the effect sends after the quiet period. The
  rows with a timer and with CPU work in the table use no network at all. Keep
  `networkidle` where your tests use it; it does not replace the fix below.
- **Readings that agree** say the page is still, not that it is finished. Two
  screenshots of the spinner taken 50 ms apart agree.

That costs you in two ways. Near the line between 20 ms and 40 ms from the same experiment, the subject
records its spinner on one run and its content on the next, and the change is
reported against a component nobody edited. Far from that line it is worse,
because it is quiet. The baseline is a picture of the spinner, every run after
it agrees, and the verdict is `unchanged`. A change inside the diagram is never
shown to anyone, because the diagram is never recorded.

## Move the work into Suspense

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

## When the work cannot move

Some work stays in an effect: a third-party widget that renders itself, a
measurement of the laid-out page, a component you do not own. Then you say
when the subject is done, or you say that the placeholder is what you review.

Do not add a sleep. A sleep is a guess about the machine. A delay that is long
enough on your laptop is near the line on a busy CI runner, and every subject
that has one pays the full delay on every run, even when its content arrived
at once.

### Mark the subject ready

Render a marker in the same render as the content, and tell the run to wait for
it:

```jsx
return svg === null
  ? <Spinner />
  : <div data-diagram-ready dangerouslySetInnerHTML={{ __html: svg }} />;
```

- **The route collector and the Storybook collector** take `ready`, keyed by
  subject id or by a glob over subject ids:
  `ready: { 'docs/diagram': '[data-diagram-ready]' }`. For a route, the id is
  the key you gave it in `routes`. For a story, the id is the story id ([a story that is not ready](start-storybook.md#a-story-that-is-not-ready-when-storybook-signals-it-is)).
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
A declared subject waits for nothing, and it is checked in the other direction:
a declared subject whose boundaries have all resolved is refused, because it
records the fallback on a slow run and the content on a fast one.

The declaration needs a boundary. An effect's spinner is not a fallback, so a
declared subject that shows one is refused as well, and in a Playwright test
`observe` throws:

```
`effect-import-declared` is declared as a loading-state capture, and it holds no
Suspense boundary at all. A declaration that no longer describes its subject is
the same flake from the other side: what gets recorded now depends on how fast
the machine is. Remove the declaration, or point it at the subject that still
waits.
```

So the loading state of the first version of the diagram cannot be recorded on
purpose. Move it into Suspense first, then give the declared subject a promise
that does not settle while it is read, for example a story that reads a promise
which never settles. In the same experiment, a declared subject like that recorded its fallback in 6
runs out of 6.
