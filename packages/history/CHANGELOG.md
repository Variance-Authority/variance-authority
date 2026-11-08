# @variance-authority/history

## 0.28.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.27.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.26.0

### Minor Changes

- 6b21cfe: A tribunal says who it recognizes, and one command deploys one

  `INGEST_CREDENTIALS` and `REVIEW_CREDENTIALS` declare who a deployment recognizes, and every deployment runs that one policy. Reviewers sign in with GitHub, those who can write to `GITHUB_REPOSITORY` decide, and a decision carries the login that signed in; a body naming somebody else is refused. Workflows in `GITHUB_ACTIONS_REPOSITORIES` push with the token the runner issues, which `baselines.token` asks for with `{ "github-actions": { "audience": … } }`, so CI stores no secret. `VIEW=public` opens reading to an anonymous visitor and nothing else. `access` remains for Cloudflare Access and any SSO behind it. `REVIEW_TOKEN` is gone, and a script no longer decides: move a deployment to `github` or `access` before upgrading. `createTribunal` takes a `policy` in place of its two tokens, and `createTribunalRoutes` and `serveTribunal` take no `authorize`, `tokens` or `reviewer`: the policy replaces them. `Capability`, `authorizeFor` and `REVIEW_TOKEN_VARIABLE` are gone with them.

  `GITHUB_ACTIONS_BASELINE_REF` is required with `github-actions`: it names the one ref whose workflows move a baseline, and every other ref still pushes builds and reads the render cache, and writes neither a baseline nor the cache. The packaged Worker sweeps on a schedule; add `triggers.crons` to a `wrangler.jsonc` that predates it. The Node service takes `VARIANCE_TRIBUNAL_ORIGIN` behind a proxy.

  `variance-authority-tribunal-provision` now takes a repository to a serving deployment: it writes `wrangler.jsonc` when there is none, registers the GitHub App from a manifest, so you confirm one page and install it, and deploys. A run refuses a repository the deployment does not already name, and `--rotate` is how a token goes to a repository that holds none. `--repository` and `--mount` place it, and `--skip-deploy` leaves publishing to a deployment with its own build. The review bundle and fonts are laid out in `dist/public`, so a Worker's `assets` directory points into the package, and the packaged Worker serves the review page. The `token` of a history or remote client may be a function, asked on each use. `./testing` adds `bearerPolicy`, `signer` and `Signer`.

## 0.25.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.24.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.24.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.23.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.22.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.21.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.20.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.19.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.18.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.17.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.16.0

### Patch Changes

- 8d1bcc1: A link in a doc comment opens from `node_modules`

  Doc comments linked to documentation by repository paths such as
  `../../../../docs/flakiness.md`, which resolve to nothing in an installed
  package. They now link to the page on variance-authority.dev, or to the file on
  GitHub when the site does not publish it, so the link works on hover in your
  editor and in what `variance ask symbol` prints.

  The MCP server's instructions and its observability answer linked to
  `/start-cli` and `/presentation`, which the site does not serve. They now link
  to `/start/cli` and `/docs/presentation`, and the `@variance-authority/cli`,
  `@variance-authority/help`, `@variance-authority/mcp` and
  `@variance-authority/vitest-browser` READMEs link to the guides where the site
  publishes them.

  `variancePrecondition`, `wiringOf`, `tapCommits` and `provenanceOf` carry an
  `@see` link to the section of the guide that documents them.

## 0.15.0

### Patch Changes

- ef496ad: READMEs name what the program does

  The package READMEs, and the `@variance-authority/vantage` and
  `@variance-authority/playwright-test` descriptions, no longer write a test, a
  record or a run as something that says, asks or knows. Each sentence names what
  the program does: a command prints, a record holds a field, a test runs or
  covers. Where a value is filled in from configuration or a default rather than
  recorded, the README says so. Four renamed headings change their anchors:
  `help`'s "Where the declaration is undocumented", `playwright`'s "Where a
  component is declared, read from the engine", `storybook`'s "What a pass sends
  the preview" and `sense`'s "Correct what a file's text declares it imports".

## 0.14.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.13.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.12.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.11.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.10.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.9.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.8.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.7.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.6.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.10

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.9

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.8

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.7

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.6

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.5

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.4

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.3

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.2

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.5.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.4.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.3.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.2.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.1

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.1.0

First release.
