<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/editors

> The Variance Authority plugins for VS Code and JetBrains IDEs, built and ready to install: which test cases went through each line, in the gutter.

Part of [Variance Authority](https://variance-authority.dev).

## What this is for

Install this when you want to see, while you edit a file, which test cases went
through each of its lines, and which cases stopped before a line they would
have reached. The gutter shows it after any run the
[CLI](https://variance-authority.dev/reference/packages/cli) recorded. The
plugins ask that CLI for everything they paint, so the project needs the CLI and
one recorded run first.

The package holds two files and a command that prints where they are. It does
not install either plugin. Your editor's extension list is yours, so you run
the install step yourself.

## Install

Nothing has to be added to your project. `npx` fetches the package and prints
each plugin's path with the step that installs it:

```bash
npx @variance-authority/editors
```

For VS Code, Cursor, Windsurf or VSCodium, name the editor and pass the path to
its install command:

```bash
code --install-extension "$(npx @variance-authority/editors vscode)"
```

For WebStorm or any other JetBrains IDE from 2025.1 on, print the path:

```bash
npx @variance-authority/editors webstorm
```

Then open **Settings → Plugins → ⚙ → Install Plugin from Disk…**, choose that
file, and restart the IDE.

The command prints nothing else when you name an editor, so the output can go
straight into another command. It exits `2` for an editor it has no plugin for.

## What the plugins show

The [VS Code
plugin](https://github.com/Variance-Authority/variance-authority/tree/main/editors/vscode)
and the [WebStorm
plugin](https://github.com/Variance-Authority/variance-authority/tree/main/editors/webstorm)
each describe their marks, their hover and click behaviour, and how to build
them from source against the IDE you have.

Both plugins carry this package's version, so the version you install is the
version of the CLI release it shipped with.
