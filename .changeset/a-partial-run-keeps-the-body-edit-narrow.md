---
'@variance-authority/sense': patch
---

A run of a few test files over an edited module no longer sends every test that
imported the module back to run

Each run lands its coverage over the record, at the text it ran. The next
selection then reads no diff for the edited module. A test the record carried
from before the edit runs again only if the landing marked it incomplete. The
landing marked every carried test on a region the edit changed, and every edit
changes the module's own region. So after you edited a function body and ran
one test file, every test that imported the module ran again. In this
repository, the next selection after such an edit went from 16 test files to
211.

The landing now reads the edit the way selection reads a diff, from the two
texts of the module. An edit inside function bodies marks the tests that
entered the edited functions. An edit that runs nothing differently, such as a
change to a type, marks none. An edit to what the module does as it loads still
marks every test that loaded it. An edit that moves a value, or adds or removes
an import, is still read as that load-time edit. If either text is unavailable,
every test on a changed region is marked, as before.
