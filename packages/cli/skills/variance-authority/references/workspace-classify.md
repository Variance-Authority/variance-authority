# `classify --query <words>`

Use it for task words without a code name. For a product label plus a version
or state value, start with the
[two text questions](code-orientation.md#combine-text-clues). It says which of
the request's words are, whole, a package's name or that name without its scope, an
entrypoint's specifier (both matched without case), or a published exported
name (matched as spelled). A word shaped as an identifier — a capital past its
first letter, an underscore, or a digit after a letter — that is none of those
is then looked up as spelled among the lines `symbol --name` names as
declaring it — leaving out a line it calls `[binding]`, which only takes the
name from another file — and the tracked files whose name before its first dot it is:
in Node.js, `ModuleLoader` is declared in the ESM loader's file, at its line,
and `child_process` is the file of that name under `lib/`. Ordinary source comes before
tests and stories, then the file more files import; three of each are shown and
the rest counted. Each is placed in the package on the code map nearest at or
above it, or `in no package`, so a checkout with no manifest still gets them. A
plain lowercase word is never looked up so: `loader` names no file. A word that
is only part of a name is not one: `check` names nothing beside `checkoutPath`,
and `Check` does not match `check`. Each entity is listed with what it names, a
package first, then its entrypoints, then the specifiers that export it, then
declarations, then files, and each with its package's area and dependency layer
as `orient` numbers them. The words that name nothing follow on one line, and
the answer asks a `symbol` question per exported or declared name, an
`entrypoint` question per published package or entrypoint, and an `orient
--area` question per package that publishes nothing, or none when the map
placed that package in no area. A source file is asked nothing further: it is
already the answer, unless `--from` or `--to` is given, which the file may lie
outside. The answer ends with the source files the request names —
each source file a word names, an exported name included, else the first
source file that declares it,
else the tests and stories it names — each with
up to eight functions and classes it declares at its top level,
exported first, from its parse in the source index. They sit under a line saying
they are the answer — to the words that name them alone, when other words are
left — and that a file beside them joins it only when it declares a name the
request uses, never for sharing their folder. Under `--from` or `--to` only the
files the start point reaches are named. A file with nothing to list still gets
its row, saying why: the index holds no parse of it, or it declares no function
or class — among the declarations read, when more lie past the budget; a word naming more tracked files than are shown gets a row counting
the rest across the checkout, reached from the start point or not. A word the
request spells another way — a plural, two words for a hyphenated name, a
domain word no name carries — is not an entity.

When every word is recognized and no `--from` or `--to` is supplied, the
answer contains only those entities, their direct questions and the named
files. Otherwise it
also ranks the areas of the tree the request's words point to, ten at most,
best first: a directory of at most 500 tracked files, a larger one read
as its children. An area's words are its path's, its files' names and the
top-level names its files declare, exported or not, compared by stem, and a word counts for more
the fewer areas hold it. An area's length counts every word its declared names
hold, exported or not and asked or not, each name once per file, so changing
a name's export visibility alone does not move an area. Each area is listed with its file count, the
request's words it holds, the one weighing most there first, and the package
on the code map nearest at or above it, with that package's area and layer on
the code map. The best one
is asked `search --from` for its two weightiest words. A request that names
nothing still points somewhere: `Fix task manager claiming tasks twice` ranks
the task manager plugin first in Kibana. In a monorepo of many products, pass
`--from` with the product's folder: only the files it reaches along the imports
are ranked, its own and the shared code it imports, and a word rare inside the
product counts for more there. `--to` ranks the files that import a path. The
answer then opens with the start point's line, as `grep`'s does. It reads the
code map `variance index` folds, and without one it says so and classifies
nothing; a map folded with no package says that too, and still names
declarations and files.
