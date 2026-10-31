# @variance-authority/editors

## 0.22.0

### Patch Changes

- 2516ca2: The gutter paints again in a repository that declares suites

  Once a repository declares suites, `variance covering --format json` answers
  under `suites`, one entry per suite, and both plugins read only the top-level
  ranges, so the gutter stayed empty. The JSON answer now carries `marks` beside
  `suites`: each run of lines with the one state every suite that ran it makes
  together, and their names. Both plugins paint those marks. The hover in VS Code
  and the tooltip in WebStorm name every suite that ran the line, with its kind
  and its state, then every suite with no answer, with its reason. The cases list
  groups its cases under the suite that ran them.

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

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

## 0.15.0

Lockstep release — nothing in this package changed. Every `@variance-authority/*` package shares one version.

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

### Minor Changes

- fdf73cd: `@variance-authority/editors` carries the VS Code and JetBrains plugins, built

  `npx @variance-authority/editors vscode` prints the path of the `.vsix`, so
  `code --install-extension "$(npx @variance-authority/editors vscode)"` installs
  it without adding anything to your project; `webstorm` prints the `.jar` for
  **Install Plugin from Disk…**. Both plugins carry the release's version. The
  package installs nothing on its own.
