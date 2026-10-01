# What is written about a name, and where else

Why a name exists and what it connects to is written in a README further up, a
docs folder, an architecture chart, a decision record or a wiki, when it is
written at all. `symbol` reads none of them, and `grep` searches only the source
files along the imports. When that is your question, search them yourself with
`git grep` or `rg`, over whatever formats the repository writes documents in.

## The queries, in order

1. **The file's path, then each parent directory, one at a time.** A document
   about a folder is written to the folder, not to each file in it, so the
   file's own path is usually the emptiest query:

   ```
   git grep -l -F <path of the declaring file> -- '*.md' '*.mdx' '*.rst' '*.adoc'
   git grep -l -F <its directory> -- '*.md' '*.mdx' '*.rst' '*.adoc'
   ```

   Stop at the first directory whose matches include a chart or a decision
   record, and never widen above the package root. A docs page or a README
   among the matches does not stop the walk: it may be one paragraph about the
   whole package.
2. **The name in backticks, and the specifier `symbol` printed.** These search
   the whole repository, so a common name floods. When it does, narrow to the
   directories the path walk found documents in.
3. **Any address the file names** in its header comment or in an `@see`: a
   link, a chart coordinate, a ticket. Open it; somebody wrote it because they
   knew where the explanation is.
4. **A wiki outside the checkout**, only through a tool your session already
   has, such as its own MCP server or an export. Ask it the same queries.

## Telling the documents apart

A chart or a decision record is what stops the walk. Recognise one by its place
or its name: `ARCHITECTURE.md`, a directory named `adr/`, `decisions/` or
`architecture/`, a chart root the repository's agent instructions declare, or
a numbered file such as `0042-a-decision.md` among others like it. Read those
first, then a docs page, then a README. A task tracker's notes describe work
in flight rather than the design; read them last.

Say which places you searched. A place you could not open is unknown, not
silent, and a name nothing explains is still a gap after you have looked.
