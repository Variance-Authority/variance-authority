---
'@variance-authority/sense': minor
'@variance-authority/help': patch
---

`testCompositions` names the tests alike instead of counting them: `alike` is
now each other test that ran exactly the same regions, as a `JourneyCase`, in
recording order. `docs_test_composition` lists them under "Alike". Each region
`testsRan` returns now says how many other tests entered it (`others`) and the
smallest of those journeys (`smallest`). A region the test entered that no
other test entered is its alone, and a region it passed by that no other test
entered is one no test takes.
