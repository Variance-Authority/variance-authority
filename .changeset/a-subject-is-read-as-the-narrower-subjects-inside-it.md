---
"@variance-authority/sense": minor
"@variance-authority/help": minor
"@variance-authority/core": minor
"@variance-authority/report": minor
"@variance-authority/cli": minor
"@variance-authority/mcp": minor
---

Ask what one test, or one story, checks that the narrower ones inside it do
not.

- `variance ask test-composition --file <test> --name <words>`, and
  `docs_test_composition`, read one recorded test as the smaller tests whose
  regions sit inside its own, the larger tests holding it, and the regions no
  smaller test entered: modules only it enters, and paths through a smaller
  test's module only it takes.
- `variance_composition {subject}` closes with the same reading for a story:
  the smaller stories inside it, the larger ones holding it, and what no
  smaller story renders — components only it mounts, and components a smaller
  story renders another way. The run carries it per subject in the report's
  structure section; `piecesOf` in `@variance-authority/core/attribute`
  computes it.
- A component mounted by more than half the suite's subjects is structure. A
  subject that mounts a component many times now counts once, where every
  mount used to count: a chip story is an example of the chip again when the
  pages around it mount chips many times over.
