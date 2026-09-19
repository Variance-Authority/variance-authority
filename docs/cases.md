# Choose from the state you already have

You can already get to the state you want to watch: a story renders it, a
Playwright test drives to it, a Vitest test mounts it. Which of those supplies
it decides what travels into a run, where the pixels are painted, and what your
baselines end up named, so the choice below starts from the lifecycle you
already trust. New to [Variance Authority](README.md)?
[Your first run](start.md) takes one UI state through capture, review and
acceptance end to end.

Every path below shares one CLI, installed as a devDependency and invoked
through `npx`:

```bash
npm install --save-dev @variance-authority/cli
npx variance run --config variance.config.json
npx variance accept --config variance.config.json cart/empty
```

Start with the harness that already knows how to get the app into that state
and declare it ready. Keep that lifecycle where it works, then choose what to
capture and where to render it. A Storybook or route host does not require
local rendering, and a Playwright host does not require in-place pixels.

## The three questions

| Question | Choices | Consequence |
| --- | --- | --- |
| Where is the UI already ready? | Storybook, served routes or static output, Playwright Test, browserless unit DOM, custom host | Selects the lifecycle, the discovery mechanism, and the naming adapter |
| What travels from your test into the run? | A document — the serialized DOM with the styles and resources it needs, either pointing at your server or carrying the bytes — or a PNG the test already painted | Selects portability, what leaves the test environment, and how much source evidence survives the trip |
| Where are pixels made? | Caller browser, local renderer, operator-owned remote renderer | Selects latency, reproducibility, infrastructure, and renderer identity |

Whatever you answer, the rest of the loop is the same: the image is looked up
against the baseline you approved, what moved is
[attributed to a component and a `file:line`](attribution.md), and you accept or
reject the result.

## Built or served Storybook

Use `@variance-authority/storybook-collector` when your stories are already the
catalogue of states worth reviewing. A **collector** is the package that knows
one host: it finds the subjects there, drives the host to each one, and hands
the run what it captured. This one runs beside Storybook, reads its index,
reuses a single preview, applies each story's viewport before mount, waits for
the rendered state, and emits documents. Fonts, images and stylesheets the
story loads from elsewhere are identified by hash rather than copied, so the
renderer has to be able to read them too.

Choose it when:

- story ids are the desired baseline ids;
- decorators and play functions own the ready state;
- the Storybook build must remain untouched;
- a local renderer, or a remote renderer with equivalent resource access, owns
  pixels.

If the state you review is a served route rather than an isolated story, use
the route collector below instead.

## Served routes or static output

Use `@variance-authority/route-collector` for an explicit map of stable subject
ids to URLs, or for static output whose HTML files are the chosen subjects. Each
viewport is planned separately and navigation happens at that viewport.

Choose it when:

- the application route, not an isolated component, is the subject;
- deterministic navigation and setup get the app into the state;
- the route list is an owned contract.

The collector is not a crawler: it never follows a link from one page to
another. A sitemap or a built directory may supply the route list instead of an
explicit map. You still get told when a page drops out — the run names it as a
subject the baseline store holds and this run did not plan — but the removal
itself never shows up in a diff you review. List the routes explicitly when
dropping one should be a reviewable change.

## Existing Playwright Test

Use `@variance-authority/playwright-test` when the suite already owns the page,
fixtures, navigation, and ready state. The package exports observation and
assertion helpers; `test` and `expect` remain imports from `@playwright/test`.

Choose deferred rendering — the test hands over the document and a later
process paints it — when:

- a pinned local renderer, or a remote renderer with equivalent resource access,
  should own pixels;
- render-cache reuse is valuable;
- disclosing the DOM and its resources across that renderer boundary is
  acceptable.

Choose in-place rendering — the browser running the test takes the screenshot
itself — when:

- the exact caller browser paint is the evidence;
- a second browser would duplicate expensive state;
- DOM material must stay inside the test environment.

In-place capture requires an explicit browser launch recipe, captures at least
twice, and refuses disagreement before baseline comparison.

## Browserless Vitest in jsdom

Use [`@variance-authority/unit-test`](start-unit.md) when the test process owns
a mounted DOM but must not own a browser. `capture` serializes the mounted
subtree with the CSS that applies to it and the bytes of the resources it
references, `writeCapture` persists that to a directory, and a later
`npx variance run` loads it through `captureCollector` and paints it locally or
remotely.

Choose it when:

- the ordinary Vitest lifecycle must remain unchanged;
- browser startup does not belong in unit workers;
- the resource bytes can be copied into the capture, so the renderer needs
  nothing from your machine;
- capturing in one process and painting in another is acceptable.

Nothing inside jsdom decides a verdict — the run's answer for a subject, such as
`new`, `unchanged`, `changed` or `incomparable`. The verdict comes from the
later run that paints the capture. jsdom also has no layout engine, so a changed
pixel region on this path is reported without the component that drew it. To
keep a real engine inside the test instead, use
[`@variance-authority/vitest-browser`](start-vitest-browser.md).

## Existing rasters

Use `observeRasters` from
[`@variance-authority/observe`](https://variance-authority.dev/reference/packages/observe)
to compare two PNGs you already hold, or `observeCaptureAgainstBaseline` to
compare one against the baseline a store holds for that subject id. No browser
is started on this path.

Choose it when another system you trust already paints the images and can say
what painted them. Without a matching capture of the DOM, you get changed pixel
regions and nothing else: no component, no ignored regions and no `file:line`.
This is a library path — the CLI will not ingest loose PNGs.

## Local or remote deferred rendering

Local rendering starts a browser in the process running the CLI. Remote
rendering sends the document to an endpoint you operate and gets back the image
and the identity of what painted it. Either way the subject id, the baseline
lookup and the verdict are the same.

Choose local when the setup and transport cost of an endpoint outweighs what it
buys. Choose remote when one pinned machine, placement next to your data, or
several renderers in parallel is worth the network hop. A document that carries
its own resource bytes paints identically anywhere; one that still points at
your server needs an endpoint that can call that server.

## Where the baseline lives between runs

**Retention** is where the image you approved is kept, and how long it survives.
Every path above works with every row here.

| Retention | Baseline owner | Fit |
| --- | --- | --- |
| Ephemeral | none | Two revisions rendered in one run; no approval history |
| Directory | checkout/CI workspace | Simple durable baseline with explicit file ownership |
| Git LFS | repository plus LFS service | Baselines travel with source workflow while large bytes stay out of ordinary blobs |
| Remote store | operator service | Shared baselines across workers or repositories |

Moving between these stores changes nothing about the verdicts you get. A store
the run cannot open fails the run as a store error; it is never reported as a
subject with no baseline.

## When the answer is a managed product

Choose Percy, Chromatic, Argos, or Applitools when what you need is a hosted
review UI for the whole team, a browser and device fleet you do not maintain, a
support contract, a branch-and-merge baseline workflow, a perceptual differ, or
a compliance commitment. Variance Authority gives you the component and
`file:line` behind a changed region and a second read before a change is
reported; it does not give you any of those six.

To weigh those trade-offs side by side, read
[how the operating models compare](comparison.md#5-choose-the-ownership-model-you-want).
For the exact API each package exports, read
[the surface reference](surface.md).
