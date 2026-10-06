---
"@variance-authority/sense": minor
"@variance-authority/distill": minor
"@variance-authority/cli": minor
---

`variance distill --file` holds the test file's mocks against the file graph,
whatever the record says. A mock of a module the file does not load, directly
or through anything it imports, is an error: delete it. A mock of a module more
than two imports away, past the subject's imports, is a warning naming the file
that imports it. A file reading carries them as `mocks`, each `unloaded` or
`beyond` with its `hops` and `importer`. `shadowReach` in
`@variance-authority/sense/taint` gives each module a file shadows its shortest
distance from the file along runtime edges, and `mayMock` says whether a file's
text may mock at all.
