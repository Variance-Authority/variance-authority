---
'@variance-authority/sense': patch
---

A test that mocks a module is no longer selected when that module changes

`vi.mock` and `jest.mock` without a factory still evaluate the real module so
the runner can shape the automock. The recording saw that evaluation, so an
edit to a mocked module selected every test that had replaced it. Now, when the
file graph carries the taints' shadows, a test is not selected for a module it
mocks, or for anything it reaches only through the mock, whatever the record
shows it crossing there: the test ran against the mock, and a mock whose shape
drifted from the real module is a type error. `coveringChange` takes the graph
as `relations` and drops those cases the same way. `auditTaints` reports
`shadowed-but-entered` only when the test called into the real module, which is
a mock that did not take; loading it to shape the automock is the mock working.
