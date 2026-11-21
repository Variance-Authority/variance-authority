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
