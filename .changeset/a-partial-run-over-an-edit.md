---
'@variance-authority/sense': patch
---

A run of a few test files over an edited module demotes the tests the edit
reached, and no others

A partial run lands over the record at the text it ran, so the next selection
reads no diff for the edited module. Whether a test the record carried from
before the edit runs again then depends only on whether the landing marked it
incomplete. Two things went wrong there.

- **A module the run did not load.** The landing re-cut its rows onto the new
  text and kept every test on them whole. If you edited a function body and
  then ran only some other test, the next selection skipped the tests on that
  function. These tests are now marked incomplete: tests on a region whose
  text moved, tests on a region the new text gained, and tests left with no
  region.
- **An edit that runs nothing differently.** A type annotation, a type-only
  import or a comment moves the digests of the regions around it. The landing
  marked every test on those regions, so one type change and a run of one test
  file sent hundreds of tests back to run. In this repository it was 261 tests.

Both landing paths, for a module the run loaded and for one it did not, now
read the edit the way selection reads a diff, from the two texts of the
module. An edit selection reads as running nothing differently marks no test.
An edit inside function bodies marks the tests on the regions it moved. An
edit to what the module does as it loads, such as a moved value or a changed
import, still marks every test that loaded the module. If either text cannot
be read, every test on a moved region is marked.

The selector prints `none (the record was taken over this text)` for a file
whose last run was recorded over its current text. The JSON reading is `none`
with `kept: true`. `none — the runtime text is equal` is printed only when the
parser compared both texts and found them equal.
