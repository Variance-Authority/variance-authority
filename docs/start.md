# Find out which component changed, and whether anyone changed it

One question picks your guide: which harness already puts the app in the UI
state you want to review — a Playwright spec, a built Storybook, a served
route, a jsdom unit test, Vitest browser mode, an Rstest suite, or a mount
nobody else owns. Whichever row of the table below you land on ends the same
way: that state gets a baseline image you approved, and a later run that moves
pixels reports the component that drew them and the `file:line` it was written
at.

This page takes one UI state through that loop end to end, so you can see the
whole review cycle before deciding how much of the suite belongs in it.

## Start from a state something already knows how to set up

A **subject** is one named UI state you asked for and can ask for again — one
Storybook story, one route at one viewport, one component mounted in a test —
captured and compared under an id you choose. Pick a first subject whose state
a harness you already trust can set up: a Playwright spec, a Storybook story, a
served route. Navigation, fixtures, authentication, and readiness stay with that
harness. [Variance Authority](README.md) either keeps the document for later
rendering or takes an image the caller already painted.

The recipes below all use **durable retention**: the approved baseline image is
written to a store and read back by the next run, instead of being rendered and
thrown away inside a single run. That is what makes the first run report `new`
and the second report `unchanged`.

## The loop you are building

| Step | What you see |
| --- | --- |
| The harness puts the app in the intended UI state | Navigation, fixtures, authentication, and readiness stay where they already work. |
| The first run reports `new` | The subject was captured, and no approved baseline exists yet. |
| You accept that candidate | `variance accept <subject-id>`, or Playwright's snapshot update flag, promotes exactly the image the run under review produced. It never renders a replacement. |
| The next run reports `unchanged` | The stored baseline and the new capture were comparable, and nothing differs. |

## Choose who already owns the state

Start from the place where the UI is already ready. Do not rebuild navigation or
fixtures in a second harness.

| You already have | Start here | Choose it when |
| --- | --- | --- |
| A Playwright test | [`@variance-authority/playwright-test`](start-playwright.md) | The state only exists after navigation, login, or fixture setup the suite performs. |
| A built or served Storybook | [`@variance-authority/storybook-collector`](start-storybook.md) | Story ids are the ids you want your baselines named by, and decorators or play functions already set up the state. |
| A served application, sitemap, or static build | [`@variance-authority/route-collector`](start-routes.md) | The application route, not an isolated component, is what you review. |
| Jest or Vitest with a mounted jsdom tree | [`@variance-authority/unit-test`](start-unit.md) | The unit run must not start a browser; a later CLI process renders what it captured. |
| Vitest browser mode with a mounted component | [`@variance-authority/vitest-browser`](start-vitest-browser.md) | The component is mounted in a real browser by the Vitest run itself. |
| An Rstest suite, in `jsdom` or under `@rstest/playwright` | [Rstest, both ways](start-rstest.md) | One runner covers both adoptions, and the page is the choice between them. |
| Another harness | [A custom collector or `@variance-authority/observe`](start-custom.md) | Nothing above owns the state lifecycle. |

If you have both a Playwright suite and a Storybook, both rows apply and you can
use both later. For the first subject, choose by where the state you want to
review lives: use Storybook when the story already renders it and you want the
story id as the baseline id, and use Playwright when setting that state up needs
navigation, authentication, or fixtures a story does not perform.

If you have already written a collector that plans and captures subjects itself,
you are past this chooser: [run its review loop with
`@variance-authority/cli`](start-cli.md).

Where pixels are made is a separate choice from which harness you start in. A
Playwright test can hand its document to a pinned renderer or capture the browser
it is already driving, and a collector's documents can be rendered locally or by
a renderer you host. [Choose from the state you already
have](cases.md) covers those choices.

Not every path can supply every kind of evidence. Browser accessibility evidence
needs a browser, and `file:line` [attribution](attribution.md) needs a build that
keeps source locations. Where a path cannot supply something, the result leaves
it out rather than guessing.

## Bound the first subject

Give the state an id that survives a renamed test title or route, such as
`cart/empty`. Select the smallest root that contains the behavior you are
reviewing — the cart, not the whole page. Shared chrome and unrelated updates
then stay outside the subject.

Keep the first state deliberately ordinary:

- its inputs are controlled by the existing harness;
- its ready condition is explicit;
- its fonts and images are available to the renderer you chose;
- its root is on the page before capture begins.

If the root is missing or the ready condition never holds, the run reports a
collection failure for that subject. That is not a visual result, and it is not
an `unchanged`: fix the boundary the run names.

## Run the first review loop

Follow your chosen recipe through its first run. With durable retention the
expected first result is `new`. Accepting an unseen baseline automatically would
record whatever is on screen as the truth and report green from then on, so
nothing accepts on your behalf.

For a Playwright-owned loop the comparison lives inside the existing test. Its
first assertion fails with `new`; `npx playwright test --update-snapshots=all`
promotes the candidate that run produced, and the next run reports `unchanged`.

For Storybook, route, unit-capture, and custom collectors the CLI owns the loop:

```bash
variance doctor --config variance.config.json
variance run --config variance.config.json
```

`doctor` checks the environment your config selects, against the machine or CI
image that will do the comparing. The first durable run exits `1`, because every
subject without a baseline is `new`. Render its report, open it, and copy the id
of the candidate you want to keep:

```bash
variance report --config variance.config.json --format html > .variance/report.html
variance accept --config variance.config.json cart/empty
variance run --config variance.config.json
```

The rerun exits `0` once the subject is `unchanged`. Keep `accept --all` out of
unattended workflows: it cannot tell a candidate somebody reviewed from one
nobody opened.

## Read what came back

| Result | What you do |
| --- | --- |
| `new` | Open the report, check the candidate is the state you meant, and accept that id. |
| `unchanged` | The subject is through the loop. Add another state, or ask a deeper question below. |
| `changed` | Open the report at the region it names: it includes the component and the `file:line` that drew it. [Trace the region to source](attribution.md), or [compare across subjects](composition.md) to see whether the same component held elsewhere. |
| `incomparable` | The two images were refused a comparison because they were not made under the same renderer identity — engine, platform, scale factor, fonts, or stabilization recipe. The report names which. Make the pixels in one fixed place, a pinned local renderer or one you host, or switch to ephemeral retention where both sides are rendered in the same run. See [baseline placement](placement.md) and [stabilization](stabilization.md). Do not read a refused comparison as zero difference. |
| Collection failure | The run could not read the subject at all, so it has no visual result. Fix the boundary it names. |

## Choose the next question

Once one subject is through the loop, add only the evidence the next decision
needs:

- resolve a changed region to a component and `file:line` with
  [attribution](attribution.md);
- separate a change somebody authored from an unstable subject, and name the
  input a component saw differently, with [parting](parting.md) and
  [flakiness](flakiness.md);
- select the subjects a source edit can reach with
  [source reach](source.md) and [test selection](selecting.md);
- choose ephemeral, directory, Git LFS, or remote retention with
  [baseline placement](placement.md);
- ask whether the same component held in every other subject that rendered it,
  with [composition](composition.md);
- read presentation or runtime behavior without a stored baseline with
  [presentation intelligence](presentation.md) and
  [runtime scenarios](scenarios.md).

The [documentation overview](README.md) resumes from any of those results.
