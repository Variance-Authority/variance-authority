---
"@variance-authority/sense": minor
"@variance-authority/distill": minor
"@variance-authority/cli": minor
---

`variance distill --file` says, under an import a used file writes, where that
file references what it imports, and what to change: delete an import it never
references; move a reference that runs when it loads, such as a map of
components, into the function that needs it; move the functions no case of the
test file ran out of the file, or import lazily inside them, with how many of
the test files that load the file run one; make lazy a reference a case ran
without calling into the module. A re-exported import is left to the file's
importers. A reference on a line the record keeps no region for, or a file with
a `require` or `import()` no name traces, reads as unmeasured.

`@variance-authority/sense/test-selection` exports `importReferences`, which
lists each reference a file makes to what it imports by the repository file the
import resolves to, and `innermostAt`. `distillFile` takes an optional
`references` lookup beside `imports`, and an import cause carries `charge`.
