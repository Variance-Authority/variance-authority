# Compass

## Roots

| Root | What it is | The orientation it gives |
|---|---|---|
| [variance-authority](./variance-authority/) | A set of composable evidence tools for software that changes | Where a claim about a change is made, and what evidence stands behind it |

## External systems

| Name | Owner | Scope boundary | Shared domain terms | Their chart |
|---|---|---|---|---|
| [system-under-test](externals/system-under-test.md) | The adopter | The application whose interface is being observed | subject, component, route, story | — |
| [test-host](externals/test-host.md) | The adopter | The runner and harness that already knows how to reach a state | subject, test, fixture | — |
| [version-control](externals/version-control.md) | The adopter | The repository, its index, its history and its diffs | commit, content digest, changed file | — |
| [code-forge](externals/code-forge.md) | The adopter | Where the change is proposed and the conversation about it happens | pull request, run, comment | — |
| [edge-platform](externals/edge-platform.md) | The operator | The account that holds the review deployment's rows, images and identities | build, decision, reviewer | — |
| [agent-client](externals/agent-client.md) | The adopter | The client an agent runs inside, which speaks Model Context Protocol | tool, evidence | — |

## Named dependencies that are not external systems

| Name | Used by | Why it is not one |
|---|---|---|
| Chromium | `variance-authority.materialization` | The engine that paints; the pixels are ours |
| React | `variance-authority.normalization` | A library inside the adopter's application, read as data rather than talked to; the application is what they possess |
| SQLite | `variance-authority.retention` | An engine for a file the operator possesses; the record outlives it and could be kept anywhere |
| pixelmatch, pngjs, sharp | `variance-authority.adjudication` | Codecs and comparators; replacing one changes the speed of an answer and not the answer |
| oxc | `variance-authority.reach` | A parser for source the adopter already owns |
| nx, turbo | `variance-authority.reach` | Build tools that contribute seeds to a selection and never a selection; the system works with neither installed |
