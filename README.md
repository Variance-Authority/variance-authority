<p align="center">
  <a href="docs/visual-guidelines.md">
    <img src="assets/brand/variance-authority-logo.svg" alt="Variance Authority logo" width="800">
  </a>
</p>

# Variance Authority

**Find what varied, what caused it, and what it reached.**

Variance Authority is a set of composable evidence tools for software that
changes. Some compare rendered UI. Others inspect one live interface, record
runtime paths, trace an edit through source and tests, read a workspace's public
API, or carry evidence to a person or coding agent. Visual regression is one
composition, not the product boundary.

The tools share the same discipline: record the conditions behind an answer,
keep missing evidence distinct from an empty result, and return a cause or a
boundary instead of a confident guess. There is no mandatory pipeline; use the
part that answers your question.

## Start with the question

| What do you need to know? | Start here |
| --- | --- |
| Did rendered UI change, and which component or source line caused it? | The [`@variance-authority/cli`](packages/cli) or one of the host integrations below. |
| How is information grouped, aligned, repeated, and emphasized in one live interface? | [`@variance-authority/presentation`](packages/presentation) senses presentation relationships without a baseline or design score. |
| At which authored action did two runtime paths stop agreeing? | [`@variance-authority/scenario`](packages/scenario) records witnessed Arrange–Act–Assert paths as a state machine. |
| Which components and tests could—or did—a source change reach? | [`@variance-authority/sense`](packages/sense) joins static source reach with recorded execution. |
| What public API does a workspace expose, and who consumes it? | [`@variance-authority/package`](packages/package) reads package surfaces; [`@variance-authority/help`](packages/help) answers about their names and consumers over MCP. |
| What did a running system decide, and where did one execution go? | [`@variance-authority/event`](packages/event) announces decisions, [`@variance-authority/wire`](packages/wire) carries one execution identity across realms, and [`@variance-authority/vantage`](packages/vantage) exposes the run while it is still running. |
| How often has a cause recurred, drifted, or proved unstable? | [`@variance-authority/history`](packages/history) defines the answers; [`@variance-authority/server`](packages/server) is the service an operator can run to retain them. |
| How does a person or agent inspect and decide on the evidence? | [`@variance-authority/mcp`](packages/mcp) exposes retained evidence to an agent; [`@variance-authority/tribunal`](packages/tribunal) is the self-hosted review and approval service. |

## Add UI observation where the state already lives

Visual and semantic observation is one family of tools. Start with the host that
already knows how to reach the UI state:

| Your UI is already ready in | Integration recipe |
| --- | --- |
| A Playwright test | [`@variance-authority/playwright-test`: add an observation](packages/playwright-test/README.md#add-an-observation-to-a-test) |
| A Jest or Vitest jsdom test | [`@variance-authority/unit-test`: capture now, render later](packages/unit-test/README.md) |
| A Vitest browser-mode component test | [`@variance-authority/vitest-browser`: observe without leaving the test body](packages/vitest-browser/README.md#register-the-command) |
| A built or served Storybook | [`@variance-authority/storybook-collector`: integrate a Storybook](packages/storybook-collector/README.md#integrate-a-storybook) |
| A running application or static build | [`@variance-authority/route-collector`: integrate a route list](packages/route-collector/README.md#integrate-an-explicit-route-list) |
| A custom renderer, store, or pipeline | [`@variance-authority/observe`: choose the entrypoint](packages/observe/README.md#choose-the-entrypoint) |

These packages add observation to the environment you already own. They do not
replace its test runner, fixtures, routing, or mounting.

## One visual result

This example changes only the `background-color` of one `Button`:

| Before | After | Diff |
| --- | --- | --- |
| ![A blue Variance button before the change.](examples/readme-case/artifacts/before.png) | ![The same Variance button in purple after the change.](examples/readme-case/artifacts/after.png) | ![The generated image diff, highlighting the repainted button in red.](examples/readme-case/artifacts/diff.png) |

The report names the cause and the source location:

```text
1 root(s): 0 authorized, 1 to review, 0 violation(s).
  [needs-review] Button — Button
      undeclared component change: `Button` (token/paint) reached 1 subject(s)
      examples/readme-case/src/Button.js:9
```

[`examples/readme-case`](examples/readme-case) generates the images and report.
Other examples cover [source selection](examples/selection-reuse),
[structural changes](examples/structural-change), and
[flake diagnosis](examples/dynamic-route-flake). The
[external cases](cases/README.md) exercise the packages against real hosts and
runners.

## Why there are many packages

A package is cut around what its consumer must supply. A browser, a live DOM, a
filesystem, a socket, and a readable checkout are different requirements, so
they do not arrive as one mandatory dependency graph.

The reader-facing packages above compose public building blocks:
`@variance-authority/core`, `@variance-authority/dom`,
`@variance-authority/react`, `@variance-authority/jsx-source`,
`@variance-authority/raster`, `@variance-authority/png`,
`@variance-authority/png-sharp`, `@variance-authority/session`,
`@variance-authority/playwright`, `@variance-authority/storybook`,
`@variance-authority/store`, `@variance-authority/report`, and
`@variance-authority/remote`. They are public seams, not private stages: a
custom integration can acquire a document without rendering it, compare
existing rasters without a browser, or consume a report without reopening the
system under test.

The [architecture package map](docs/architecture.md#packages) names what every
package requires and what contract it owns. The
[information map](docs/information.md) shows how visual, source, runtime,
scenario, presentation, history, and review evidence remain separate and meet
only on identities their producers emitted.

## Scope and non-goals

Variance Authority ships libraries, command-line tools, agent surfaces, and
services that run in infrastructure you control. It is not a hosted product:
compute, storage, browser capacity, credentials, and deployment remain yours.

For visual-review adoption, the [adoption gates](docs/gates.md) state where the
tool fits Playwright, Storybook, Jest, and Vitest — under jsdom and in
browser mode. The
[product comparison](docs/comparison.md) states what Percy, Chromatic, Argos,
and Applitools provide that this project does not.

## Documentation

The [documentation index](docs/README.md) routes by question rather than by
package. Use it to find the contract, measurement, or limitation behind any of
the paths above.

## Licence

MIT — see [LICENSE](LICENSE). Copyright (c) 2026
[Machine Garden](https://machine-garden.com/). [GitHub](https://github.com/Machine-Garden).
