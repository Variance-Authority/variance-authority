# `entrypoint`

`--package` takes the specifier as `packages` prints it, or the package name
with `--subpath` set to a key of its `exports` map; `--subpath .` is the package
name alone. Asked by the package name alone, the answer lists the names its main
entry opens, then counts the imports that reach past its entry, one row per
file: its specifier, how many names are taken from it and how many files import
it, the most imported first. A package that declares no entry opens nothing, and
the answer counts what other packages import from it by path the same way.
Asked by one of those specifiers, it counts the imports written as that
specifier per name, each name with how many files import it, the most imported
first; an import that takes no name, for its side effect or the module whole,
is counted on a row of its own. The answer ends with the narrower questions it
has, if any: asked by a package, the first row's specifier and `uses` on the
name the most files take through it; asked by a specifier, `uses` on its first
name, which lists that name's import sites.

## Trace an executable command

A CI shell command can select an implementation through package scripts, a
binary and framework registration. The imports counted by `entrypoint` do not
establish those links. Search the invoking workflow and registration metadata
with `rg` or `git grep` alongside the source questions.

Start from whichever end the task supplies:

- From a workflow command, read its working directory and arguments, resolve
  the actual package script or `bin` entry, then read the framework registration
  that selects the implementation.
- From an implementation, find its recorded command ID or registration key,
  then search that exact value in package scripts and workflows. A filename
  resembling a command is a clue, not its registration.

When a framework manifest records command IDs and implementation paths, use
that mapping to find the source file. Otherwise read the framework’s
registration source. Do not derive the command ID from a filename.

Read the selected source's bindings with `symbol`, `uses` or `discover` after
that metadata identifies it. Keep the command-to-source link explicit in the
answer, and name any unresolved script, dynamic registration or working
directory instead of treating an empty import walk as proof the command is
unused. Configuration describes an invocation; it does not prove that CI ran.
