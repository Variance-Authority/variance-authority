---
'@variance-authority/sense': patch
---

Select the tests a changed file governs, not only the tests that entered it.

Selection asked coverage which module a changed file is and stopped when there
was none. A test file is never a module — nothing enters a test — so editing or
adding one selected nothing, and a CI job following the documented workflow ran
zero tests on a commit that was entirely new tests. A declared `preconditions`
entry is never a module either, so changing the runner configuration that governs
every test also selected nothing. Both were silent: an empty list and a green
run. A changed file with no module now selects every test whose recorded
preconditions name it.
