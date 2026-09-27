# @variance-authority/editors

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
