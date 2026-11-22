# `search`

**A list contains candidates, not every match.** Each list is capped and prints
how many rows it did not show: 20 published names, 20 installed ones, 10 of each
other kind, and 10 loose or described ones, unless `--limit <n>` sets one cap for every list; the
JSON caps its lists the same way. Once any name matches, looser matches and members
and functions inside a function that only contain your words are left out without
a count. `git grep -i <word>` prints every tracked line that writes the word, and
`discover --declares <regex> --limit <n>` lists every top-level name past a cap,
exported or not, by its name alone.

**A published line is `<specifier> · <name> [kind] …`, and the two halves go to
different arguments.** `symbol` takes the **name**, the word after the `·`. The
specifier before it is the import line you will write, and it goes to
`--package` when the same name is published from more than one place. So after
`@variance-authority/core/format · Viewport [interface] …` the next question is
`symbol --name Viewport`, not `symbol --name @variance-authority/core/format`. An
unpublished line has a `path:line` instead of a specifier, and the first paragraph
of its doc comment when it has one: open the file, or pass its name to
`symbol` and `uses`, which answer it from the source index.
A line under *declared … without being exported* is a name its file does not
export, matched by its name or its documentation: `symbol` gives its signature
and who can reach it, which is only that file in a JavaScript or TypeScript
module, its module in Rust, and any module that spells it in Python; `uses` says
the same in one line. CommonJS is read on a best-effort basis: the static keys
of an object literal that `export =` or `module.exports =` assigns at the top
level are the file's exports when every key is spelled, and a read off a
default import of it is marked "through `default`". A named function or class
handed out once that way is declared, and is the module's default export bound
to that name. A script or CommonJS file, a module that hands out any other value
with `export =` and a `macro_rules!` are said to have no recorded reach: their readers cannot tell how the file hands the name
out.
A file whose declarations were not read, such as one over the size a read
opens, is named under the answer, since the name may be declared there.

`variance index` also publishes a lexicon of the installed direct third-party
packages, and `search` reads it. When repository names match, installed-name and
describing-package sections stay compact: each lists up to five names by
default, or up to `--limit <n>`. The answer offers a larger limit only when
names remain; using it reveals those names without expanding their details.
With no repository matches, dependency-only answers list matching installed
names and packages that describe your words in detailed rows; if none match, a
line says which manifests were searched. Empty sections and suites whose
recorded cases were not read are omitted. An answer holding a row of this
repository ends with `Next:` and the question for its first declaration, a
recorded test case only when no declaration answered: `ask symbol --name
--package` for a published row, `ask orient --files` for the file of any other,
spelled as you asked, so over MCP it names the tool and its input. `symbol`
matches installed third-party declarations from the same lexicon, which is
`dependency-lexicon.bin` beside the source index. It is a binary file: ask
`search` and `symbol` for what it holds.

Nothing back means nothing matched, not that a ranking left it out. In a
checkout that publishes nothing, that is the final answer. Near matches follow
the answer, under a heading that opens `Near matches, not exact:`. They are
names and files holding most of your words by stem, the rarer words counting for
more, in any order, in the name or its doc, whether published, exported,
declared and not exported, or a file by its name and the doc it opens with. The
ones holding the most of your words come first, then the ones holding more of
them in the name, then the ones whose doc writes your phrase, and every word any
of them holds is held by a row shown. Each is labelled with the words it holds.
After a question of two words or more that matched as written, at most five of
them follow, leaving out what the answer shows, so you learn the repository's
own wording. After an empty answer they lead, and the names your words reach
loosely follow them, exported or not; that section takes a name holding less
than most of your words when it reaches it by every one. Both are suggestions,
printed before the installed packages: they never change the sections above
them, and they do not find a word the repository never writes. For that, expand the query as
`SKILL.md` describes under *Matching is lexical*.

**A start point removes names; it does not rank them down.** A path that
holds no source file is refused by name, so you are never answered about the
whole repository without knowing it. An empty answer under a start point is a
fact about that area; ask again without it for the whole workspace.

`--format json` returns the same answer as data: specifier, file, line and
counts.
