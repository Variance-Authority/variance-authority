# Observe one state end to end

**[Variance Authority](README.md)** renders a UI state, compares it against
its approved baseline, and records what changed and why. Begin with one
stable UI state — a **subject** — in a test or harness you already trust: a
Playwright spec, a Storybook story, a served route. Keep its navigation,
fixtures, authentication, and readiness with that existing host. Variance
Authority can retain a document for later rendering or take the caller's
already-painted image; either way it produces a **reading** — one capture of
that subject — for you to review. Accept the reading once, and the same
subject returns `unchanged` on every **run** — one execution of
`variance run` — after.

This is enough to learn the complete review loop before deciding whether more
of the suite belongs in it.

## The result you are building

A complete first loop has four visible states.

| Event | What it establishes |
| --- | --- |
| The host reaches the intended UI state | Navigation, fixtures, authentication, and readiness remain with their existing owner. |
| The first reading reports `new` | The run observes the subject, but no approved baseline exists. |
| A reviewer accepts that candidate | The store promotes exactly the candidate under review. |
| The same subject reports `unchanged` | The current evidence and approved baseline are comparable and no difference remains. |

This loop proves the integration for that subject. It does not turn one stable
reading into a claim about every state in the suite.

## Choose who already owns the state

Choose the integration from the place where the UI is already ready. Do not
rebuild navigation or fixtures in a second harness.

| Existing state owner | Integration path | What remains with the host |
| --- | --- | --- |
| A Playwright test | [Start with `@variance-authority/playwright-test`](start-playwright.md) | Test runner, page, fixtures, navigation, authentication, readiness, and assertions |
| A built or served Storybook | [Start with `@variance-authority/storybook-collector`](start-storybook.md) | Story catalog, decorators, play functions, build, and story readiness |
| A served application, sitemap, or static build | [Start with `@variance-authority/route-collector`](start-routes.md) | Server, routes, application state, and application-owned readiness markers |
| Jest or Vitest with a mounted jsdom tree | [Start with `@variance-authority/unit-test`](start-unit.md) | Unit runner and mount lifecycle; a later CLI process renders the captured document |
| Another harness or material already in hand | [Connect a custom collector or `@variance-authority/observe`](start-custom.md) | State lifecycle and the adapter that emits a document or raster |
| A **collector** (the host-specific code that discovers and captures subjects) that already owns acquisition | [Run its review loop with `@variance-authority/cli`](start-cli.md) | Subject planning, acquisition, and readiness |

The host choice does not choose where pixels are made. Playwright can retain a
document for deferred rendering or capture its caller-owned locator in place;
collector documents can be rendered locally or by an operator-owned renderer.
[Choose from the state you already have](cases.md) separates those decisions.

These paths share observation and reporting contracts, not identical signals.
For example, browser accessibility evidence requires a browser reading,
`file:line` [attribution](attribution.md) requires source [provenance](attribution.md), and portable remote painting
requires resource-closed capture. When a path does not supply a signal, the
result omits it.

## Bound the first subject

Give the state an id that survives a test-title or route-name change, such as
`cart/empty`. Select the smallest root that contains the behavior under review,
such as the cart, not the whole application page. Shared chrome and
unrelated updates then stay outside this subject by construction.

Keep the first state deliberately ordinary:

- its inputs are controlled by the existing host;
- its ready condition is explicit;
- its resources and fonts are available to the chosen renderer;
- its root is present when acquisition begins.

A missing root or an unmet ready condition is a collection failure, not an
empty observation and not an unchanged result.

## Run the first review loop

Follow the chosen integration recipe through its first observation. With
durable retention, the expected result is `new`; accepting an unseen baseline
automatically would turn missing review into green output.

For a Playwright-owned loop, the observation lives inside the existing test.
Its first unchanged assertion fails with `new`; Playwright's explicit snapshot
update flag promotes the candidate produced by that run, and the promoted
observation returns `unchanged`.

For Storybook, route, unit-capture, and custom collectors, the CLI owns the
loop. `doctor` checks the environment selected by the config. The first
successful durable run exits `1`; inspect its **report** (what the run writes
at the end), accept the intended subject id, and run it again. An unchanged run exits `0`. The selected recipe
contains the config and commands because acquisition details belong to that
host.

## Read what came back

| Observation | Next action |
| --- | --- |
| `new` | Review the candidate and accept this subject explicitly if it is the intended state. |
| `unchanged` | The subject completed the loop; add another state or follow a deeper evidence question. |
| `changed` | Open the report at the highest band and attributed root; [trace the region to source](attribution.md) or [compose evidence across subjects](composition.md). |
| `incomparable` | Read the reason and reconcile renderer or evidence identity; do not replace a refused comparison with zero difference. See [baseline placement](placement.md) and [stabilization](stabilization.md). |
| Not observed | Fix the named collection boundary. A subject the run could not read has no observation verdict. |

The observation words describe whether material could be compared. Policy then
turns a changed observation into a verdict such as `authorized`,
`needs-review`, `violation`, or `unexplained`; [composition](composition.md)
defines that fold.

## Choose the next question

Once one subject completes the loop, add only the evidence needed by the next
decision:

- resolve a changed region to a component and `file:line` with
  [attribution](attribution.md);
- distinguish an authored change from unstable execution with
  [parting](parting.md) and [flakiness](flakiness.md);
- select the subjects a source edit can reach with
  [source reach](source.md) and [test selection](selecting.md);
- choose ephemeral, directory, Git LFS, or remote retention with
  [baseline placement](placement.md);
- read presentation or runtime behavior without a durable baseline with
  [presentation intelligence](presentation.md) and
  [runtime scenarios](scenarios.md).

The [documentation overview](README.md) resumes from any of those results.
