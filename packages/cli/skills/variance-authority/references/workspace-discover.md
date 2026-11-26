# `discover`

Use it when the answer is where two or more facts about a file meet: *a file
the nav reaches that makes a context with `theme` in its name*, or *the
declaration of `selectBalance` this component can actually reach*. Each operand
is a set of files, read whole with no cap, and the answer is the files in all
of them:

- `--from <path>[,...]`: what each path reaches along the imports; `--to`, what
  reaches each path. Two paths are two sets, crossed, not joined. Every import
  kind is walked, type-only ones included.
- `--to <file#name>`: what rests on one name out of a repo-relative file. The
  walk starts at the files that import that name, as `uses` lists them, through
  every barrel that passes it on, so a file importing another name through the
  same barrel is not reached; past them it walks by file.
- `--imports <module#name>[,...]`: who imports that name from that module, by
  the name the module publishes, so an aliased import still counts. The module
  is the specifier as written, where a package also covers its subpaths and a
  relative specifier only itself, or the repo-relative file it resolved to;
  `module` alone is any import of it. A name out of a repo-relative file is
  answered as `uses` answers it: an import through a barrel that passes the name
  on counts, and so does the barrel, and the header says how many passed it on.
  A name read off a module loaded with `require`, as `uses` lists it, counts too.
- `--declares <regex>`: who declares a matching name, case-insensitive. An
  export of an imported name, with `export … from` or without, is declared where
  it comes from, not in the barrel; `export default function make()` declares
  `make`.
- `--path <regex>`: a pattern over repo-relative paths.
- `--except-from`, `--except-to`, `--except-imports`, `--except-declares`,
  `--except-path`: the same sets, taken out.
- `--text <pattern>`: ripgrep over the files the other sets kept, not the whole
  checkout; a file with no matching line drops out. The sets come from the
  published generation, the text from each file as it is on disk now, so after
  an edit the two can disagree until `variance index` runs.

```bash
variance ask discover --from src/TopNav.tsx --imports react#createContext --declares 'theme|user|account'
variance ask discover --from src/Wallet.tsx --declares '^selectBalance$'
variance ask discover --to src/store/selectors.ts#selectBalance
```

The answer opens with how many files are in all of the sets, then one `- `
line per set with its count. One file is one row, nearest the `--from` or `--to`
paths first. A row that sits some imports from a `--from` or `--to` path starts
with that count, one per path, in the order the `each row:` line names them;
the lines that put the file in a set follow the row, indented as
`  <line>: <text>`; `--path` puts a file in by its name, with no line. A file
two or more imports away from a `--to` path carries one shortest chain of
imports to it, a step that is not a plain import marked — `src/Page.ts →
src/Model.ts (type import) → src/store/selectors.ts` — and for `file#name` the
chain ends at the line that imports the name. The tail every chain shares is
said once, on a `chains end:` line, and each row ends its chain with `→ …`
there. The files the `--to` walk did not reach that import something the scan
could not resolve, since they may reach the path through it, follow on a
trailing `note:` line that names the set they may reach, and says when that set
is one taken out. An error ripgrep reported is a `note:` line too. When no file
is in all of them, the answer opens with `No file is in all of them:`, then the
sets and the notes. It shows 50, and the count is always of all of them;
when more remain, the answer ends with how many and the `--offset` that shows
the next page. A source file whose names the scan did not hand over is counted in the
`--imports` and `--declares` headers, since it is unknown rather than a file with no names; a README or a
manifest has none to read.
Over MCP, `docs_discover` supports the same operands, including `declares` and
`imports` of a module or name. Pass `imports` as an array of strings and
`declares` as a pattern; exclusion fields use camelCase, such as `exceptImports`.
