---
"@variance-authority/help": patch
"@variance-authority/cli": patch
---

`variance ask packages` (`docs_packages`) with no argument counts and lists no
import site: one row per published specifier, one per package that declares no
entry with how many of its names and files other packages import by path, and
per package the number of imports that reach past a published entrypoint. It
ends with the narrower questions to ask next. `--package` (`package`) takes a
package or a specifier from those rows and lists the import sites behind its
counts. On a repository whose packages declare no entry, the answer with no
argument went from 200,330 lines in about 30 seconds to 1,327 lines in under
half a second.
