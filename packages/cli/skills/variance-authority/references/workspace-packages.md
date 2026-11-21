# `packages`

Ask it when you have no exact specifier. A published specifier is each subpath a
`package.json` `exports` field opens, or, with no `exports`, the bare name its
`types` or `main` opens. It takes no argument and counts, one row per specifier:
the names it opens, how many anything imports, how many are documented. A
package that declares no entry gets an indented row with how many of its names
and files other packages import by path, and imports past a declared entry, deep
imports, are counted per package; a package's imports of itself are not. An
import by path names a file of a package that declares no entry, so there is no
entry for it to be past. A package whose declared entry this reading could not
follow to a source file, such as a build output the checkout does not hold,
opens nothing: it is counted apart, with the imports that name that entry, and
only an import past every entry it declares is deep. It lists no import site:
pass a specifier row whole to `entrypoint --package` for the names it opens,
and an indented row's package name to `entrypoint --package` for its count per
file. The answer ends with an `entrypoint` question for each of the
most-imported specifier, the package that declares no entry with the most names
imported by path, the package with the most imports past its entry, and, of the
packages whose entry this reading could not follow, the one with the most
imports past it, those the repository has. Asked by the name of a package whose
`exports` opens only subpaths, `entrypoint` lists the specifiers it opens in
place of the names of a main entry.

`packages` and `entrypoint` answer for the JavaScript half of a mixed
repository. The other verbs read the source and answer for every language: ask
`search` or `symbol` for a Python, Rust, Java, Kotlin or Swift name.
