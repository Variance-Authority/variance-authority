# Variance Authority for WebStorm

See which test cases went through each line of the file you are editing,
without leaving it. After your suite runs with the recorder on, the gutter
beside every line it ran shows one of five marks, and hovering the mark names
the test files that went through it. The marks and their meanings are the ones the
[VS Code client](../vscode/README.md) paints, and so are the colours on the
scrollbar.

Click a mark to list every case behind it. Each test file shows how many of its
cases went through the line out of how many it has, `reset.test.ts 9/20 · 1 hop`,
nearest file by imports first. Type to filter, choose a file to see its cases,
and choose a case to open the file at its title. The click asks the CLI for the
distances, so the list takes a moment on a large project, and the hover does not
wait for it.

A hole is not the same as untested. A case that failed, or a flake your CI
suppressed, stopped before the end, so the record cannot tell whether it would
have reached these lines. The tooltip names the case that stopped.

The marks follow your edits. The plugin sends the text you hold, saved or not,
and the CLI places every recorded range in it. If the file changed so much that
the text the suite ran over cannot be found, one warning mark on the first line
says the record is stale, and nothing else is painted. Coming back to the IDE
after a run in a terminal repaints every open editor.

The status bar says what the record made of the file in front of you: how many
holes it has, or that the record is stale. When nothing is painted, it says
`variance: not painted`, and its tooltip gives the reason, such as no recording
yet or no CLI to ask.

The plugin works in WebStorm and in every other JetBrains IDE from 2025.1 on.

## Install

The plugin asks the project's own `node_modules/.bin/variance`, or the
`variance` on your shell's `PATH`, so install the CLI and record a run first;
the [CLI README](../../packages/cli/README.md) shows both. Then build the
plugin against the IDE you have:

```bash
editors/webstorm/build.sh /Applications/WebStorm.app
```

The build uses that IDE's own compiler and libraries, so nothing is downloaded.
It writes `editors/webstorm/dist/variance-authority.jar`. Install that file from
**Settings → Plugins → ⚙ → Install Plugin from Disk…** and restart the IDE.
