---
"@variance-authority/help": minor
"@variance-authority/cli": minor
"@variance-authority/package": minor
"@variance-authority/sense": minor
---

`variance ask packages` (`docs_packages`) counts and lists no import site: one
row per published specifier, one per package that declares no entry with how
many of its names and files other packages import by path, under the heading
"N packages that declare no entry are imported by path", and per package the
number of imports from other packages that reach past a published entrypoint.
It ends with the `variance ask entrypoint --package <name>` questions behind
those counts.

`variance ask entrypoint --package <name>` (`docs_entrypoint`) asked by a
package's name now also counts the imports that reach past its entry, or, for a
package that declares no entry, the imports of its files by path, one row per
file: its specifier, how many names are taken from it and how many files import
it, the most imported first. Asked by one of those specifiers, it counts the
imports written as it per name, each name with how many files import it, where
it listed every import with the importer's file and line, and names `uses` on
the first name for its sites. Under a package that
declares no entry, a specifier's count is of distinct names taken in distinct
files, where every import of a name was counted again: fifty files importing
one name read "50 names" and now read "1 name". Asked by the name of a package
whose `exports` opens only subpaths, it lists the specifiers the package opens
where it used to refuse with "does not open `.`". `--subpath .` answers exactly
as the package name alone, where it left out the imports past the entry, or
refused for a package that opens only subpaths.

An import into a published package whose declared entry leads to no source
file, such as a `main` naming a build output the checkout does not hold, is
kept, where every one was dropped and `variance ask entrypoint` said no other
package imports it. An import that names a declared entry is counted as an
import of an entry this reading could not follow to a source file, not as one
reaching past the entry; only an import past every declared entry reaches past
it. `variance ask packages` counts those packages and their imports,
`variance ask entrypoint` counts them, and `uses` and `symbol` answer for the
names taken from them. `landing` says where one import between packages
lands: opened by an entry, at a declared entry the reading could not follow,
past every declared entry, or by path into a package that declares none.
`Help` and `Usage` carry the imports of an entry the reading could not follow as
`unfollowed`, and `gatheringUsage` is the one place a `Usage` is gathered.

`variance ask entrypoint` on a package that declares no entry says it has "no
`exports`, `main`, `types` or `typings`", where it left out `typings`, the
fourth key read for an entry, and says so of one no other package imports too,
where it said that package "opens no entry". A manifest that writes
`"exports": null` is read as one that writes no `exports`, as Node reads it: its
`main` opens the bare name, and without a `main`, `types` or `typings` it
declares no entry. `Offering` and `Documented` carry whether a
manifest declares an entry as `entry`, read from the whole manifest whichever
keys `declared` records.

On a repository whose packages declare no entry, `variance ask packages` went
from 200,330 lines in 29.9 to 45.9 seconds to 1,339 lines in half a second,
`variance ask entrypoint --package @kbn/core` went from 23,463 lines to 13, and
`variance ask entrypoint --package @kbn/core/server` answers in 241 lines, one
per name.

Breaking:

- `variance ask entrypoint --package <name>` (`docs_entrypoint`) counts the
  imports past a package's entry, or of its files by path, one row per file, and
  asked by one of those specifiers counts its imports per name. It printed
  every import with the importer's file and line; `variance ask uses --name
  <name> --package <specifier>` lists those for one name.
- `readUnentered` and `publishes` are removed from
  `@variance-authority/package/help`. `readImportTargets` reads the published
  packages, the ones that declare no entry and the specifiers each published
  manifest declares, in one pass.
- `readHelp` from `@variance-authority/sense` takes those three as its third
  argument, `{ published, unentered, declared }`, where it took the packages
  that declare no entry; the native `read_help` it calls takes `published` and
  `declared` as two more arguments.
- `Offering` and `Documented` carry `entry`, and `Help` and `Usage` carry
  `unfollowed`: a value built by hand adds them.
