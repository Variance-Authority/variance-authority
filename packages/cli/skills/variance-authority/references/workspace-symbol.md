# `symbol --name <name>[,...] [--package <name>] [--from <path>] [--line <file>:<line>] [--limit <n>]`

The name is matched **exactly**. Several names, as `--name a,b,c`, are each
answered as one is, in the order given, a blank line apart; a name nothing
declares is answered in its place, and the others still answer; each
flag below applies to each name. `--package` takes a package name or a
specifier, and only narrows: it answers from that package instead of from every
specifier that publishes the name.

`--line <file>:<line>` ranks the name's declarations by the tests that ran that
line, reading the recording rather than the code. The rank is overlap of
recorded tests, not proof of which declaration the line called. Each declaration is scored by Ochiai:
the tests that both ran the line and entered it, over the geometric mean of the
two counts, so one every test enters does not outrank one only the line's tests
enter. The highest comes first and an equal score is marked `tied`. Declarations
none of the line's tests entered are listed under `Not run with it:`, those
written at a line no recorded function starts under `Not in the recording:`, and
those written since the recording ran under `Written since the recording ran:`.
A line no recorded test ran tells them apart by nothing, and a recording that
names no commit, or whose commit the lines cannot be placed at, is not scored:
the answer says so, then answers as without `--line`.

```
`useSessionId` at src/page.ts:3, by the 1 recorded test that ran the line:

src/session.ts:1  1.00  1 of the 1 test that entered it ran the line

Not run with it:
src/legacy.ts:1  none of the 1 test that entered it ran the line
```

A name nothing declares is answered on stdout, exit `0`: what was read and
declares nothing, and where else the name may be written. Over MCP it is the
same text, as a result rather than an error. It is answered from the generation
the question read, which `variance index` publishes, and its last line says
when that generation was made and that it may miss later changes:

```
`NotAThing` is not published by this workspace, and no published name contains it; ask `search` with a word from its documentation. No file in this workspace declares `NotAThing`, at its top level or as a member. No installed dependency publishes it either. A name written only as text, in a string or a comment, declares nothing: a text search such as `rg` finds it.
```

When the dependency lexicon is not published, the answer still says what the
workspace holds, and that the installed dependencies were not checked:
``Whether an installed dependency publishes it is not known: the dependency
lexicon is not published, and the `variance index` command publishes it.`` When the source
index did not read some files' declarations, the answer says no file *it read*
declares the name, and names those files last.

Members are read from JavaScript and TypeScript files only. When the source
index holds files of another language, the answer says what was read, names
those languages and sends you to their language server:

```
`scan_things` is not published by this workspace, and no published name contains it; ask `search` with a word from its documentation. No file in this workspace declares `scan_things` at its top level, and no JavaScript or TypeScript file declares it as a member. No installed dependency publishes it either. Members are read from JavaScript and TypeScript files only, and this workspace's Python and Rust files were not read for them: if `scan_things` is a member there, ask their language server's workspace symbols for it, then its find-references on the declaration. A name written only as text, in a string or a comment, declares nothing: a text search such as `rg` finds it.
```

`uses` answers such a name with the same sentences, less the one about
installed dependencies. A member answer of `symbol` or `uses` ends with the
sentence about other languages as well, saying the member may be declared
``there too``.

A name no entry publishes, but that another package imports by the path of its
file, is answered rather than refused: where it is declared, why nothing
publishes it, and each import of it. A name a file exports and no entry
publishes is answered too: the file and line that export it, the line as the
checkout holds it, and how many imports the source index resolved to that file,
within its package as well as across. Two files that export one name are told
apart, each with its own count, and an installed name it matches, which a file
that passes it on exports without declaring, is said after it. A name a file
declares and does not export, at its top level or inside a function, is answered
from the source index, as below, after any export of the same name in another
file; one inside a function is answered with the function that holds it. A
top-level name a file destructures out of a value, whatever the value is, or
sets to a whole module with `const x = require('m')`, is kind `[binding]`:
unless the file exports it, the file binds the name and does not declare it.
Each such file follows every declaration as `bound, not declared, at
<path>:<line>`, and is not counted as one. When nothing else answers the name —
no declaration, no installed package that publishes it and no import that
renames to it — the answer says that no file declares it and then lists the
files that bind it. A file that binds the name and declares it too, as a type,
is listed at its declaration alone. The answer does not say where the value
comes from. A name an import binds with `as` is answered with that import and
the original it names. A member of an interface, a type literal or a class is answered with its
container and the file and line that declare it, one block per declaration,
after every other declaration of the name. `Tree.has` asks for the member `has`
of `Tree` alone; when `Tree` is declared and no body read declares `has` on it,
the answer names `Tree`'s declaration and leaves what it inherits, and a
member of an enum, a namespace or an object literal, which the source index does
not read, to the go-to-definition of the language server for `Tree`'s language. `ask search` finds
a function inside a function by its name, under the function that holds it, and
a member by its name, by `container.member`, or by the doc above it. They print
below the other sections, and when something else answered, only a row that is
the question exactly. It also lists the recorded test cases whose full names hold
every word, as a stem or the start of a word, as `<name> [test] — <file>`: what
each suite's last run wrote, so a test added since is missing and one removed
since is still listed until a run of that suite records it, and the answer says
which suite's cases were not read.

`--package` with the path of one file in a package, such as
`@acme/lib/src/internal/math`, names the file an import of that specifier
resolved to. When nothing in the workspace imports the specifier, the file it
names is not known, and the answer says so.

An interface, a type alias or a class is followed by `Members:`, one row per
line that declares a member, as the checkout holds it. A member of a type
literal inside it belongs to the literal and is not listed, and a line the
signature already shows is not repeated. The rows read as `grep`'s do: a file
with one row is `path:line: text`, and a file with several is its path, then
each row indented as `line: text`. A local name whose declaration the answer
already gave is not answered twice: it says `Its declaration, at <file>:<line>,
is answered above.`

A name a file only passes on with `export … from`, renamed, type-only, through
`export *` or as an import it exports again, is followed to the file that
declares it: the answer says `It passes on <name>, declared at <file>:<line>:`,
shows that line, and lists its members. The name is resolved the way an import
resolves it: the file's own export of the name first, then a named `export …
from`, then its stars, and no star passes `default`. Files that only pass the
name to each other name no declaration, and neither do two stars that reach
different declarations, a namespace (`export * as`, `import * as`), or a file
the source index holds no export list of and that does not declare the name.

`--limit <n>` sets how many rows of each list are shown: 5 declarations a file
keeps to itself, 5 member declarations, 5 containers named when a member is
not found, and 100 installed declarations when not said. The rest are counted,
and the line that counts them names `--limit`. The files that import the name
under another name are a list in one sentence, cut at 12, which `--limit` does
not reach. Under `--line` the ranked list is
never cut; `--limit` reaches the answer given without the line.

`symbol` prints what a name is and how to call it. For why it exists and what it
connects to, read [what is written about a name](written-about-a-name.md).
