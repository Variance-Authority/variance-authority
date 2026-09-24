# Variance Authority for VS Code

See which test cases went through each line of the file you are editing,
without leaving it. After your suite runs with the recorder on, the gutter
beside every line it ran shows one of five marks, and hovering names the cases.

| Mark | State | What it tells you |
|---|---|---|
| green bar | walked | Several cases went through these lines. |
| amber bar | one case | One case went through, and it is the only one that fails if this breaks. |
| grey bar | loaded only | The lines ran while their module loaded; no case called into them. |
| red bar | hole | Nothing went through, and a case that could have stopped first. |
| red outline | unwalked | Nothing went through, and every case that could have finished. |

A hole is not the same as untested. A case that failed, or a flake your CI
suppressed, stopped before the end, so the record cannot tell whether it would
have reached these lines. The hover names the case that stopped.

The marks follow your edits. The extension sends the buffer you hold, saved or
not, and the CLI places every recorded range in it. Add lines above a function
and its marks move with it. If the file changed so much that the text the suite
ran over cannot be found, the status bar says the record is stale and nothing
is painted.

**Variance: Cases through this line** lists the cases for the line under the
cursor, and the cases that stopped before it. Choosing one opens its file.
**Variance: Read the recording again** repaints after a run. Coming back to the
window does the same.

## Install

The extension asks the `variance` CLI of your workspace, so install the CLI
and record a run first; the [CLI README](../../packages/cli/README.md) shows
both. Then package and install the extension from this directory:

```bash
npx @vscode/vsce package
```

```bash
code --install-extension variance-authority-0.8.1.vsix
```

`variance.command` names a different CLI when the workspace's own
`node_modules/.bin/variance` is not the one to ask.
