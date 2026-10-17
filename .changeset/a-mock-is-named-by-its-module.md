---
'@variance-authority/distill': minor
'@variance-authority/cli': patch
---

A proposed mock names the module, not a runner's call

`distill` spelled its mock proposals in one runner's API: a file reading
proposed `jest.mock('../src/editor', () => ({ edit: jest.fn() }))` for a test
file Vitest runs, and a case reading proposed `vi.mock(...)` with a note that
`jest.mock` and `sb.mock` said the same. Both now name the module and why, and
leave the call to the test file's runner. A file reading reads
`Or mock src/editor.ts in this file, so src/dialog.ts does not load it: stand a
function in for each value it exports (edit, format); an automock loads the
module to read its shape.` A case reading reads `substitution to try: mock
src/heavy-chart.tsx in this test's file; loading it is all this test used of
it. Stand in for what it exports: an automock loads the module to read its
shape`. The module is the repository-relative path the rest of the reading uses,
not a specifier relative to the test file. A script that matched either line's
old text has the new wording to match.
