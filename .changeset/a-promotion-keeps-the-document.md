---
'@variance-authority/cli': patch
'@variance-authority/tribunal': patch
---

An approved candidate becomes a baseline a later run can find

Every baseline lookup keys on the identity of the document that was painted —
`identityAtScale`, which folds in the viewport's `deviceScaleFactor`. A build
row carries the identity of the machine instead, whose own source says nothing
may key a store on it: a run painting 1x and 2x viewports reports the scale
there as 1. Promotion used that one. On any suite above 1x the approval was
recorded, the page said so, and the next run looked under a digest nothing had
ever been filed under — so the subject came back `new`, forever, and no amount
of approving it helped.

So `push` now sends the candidate's own sidecar identity, the service keeps it,
and a promotion files under it. A push that predates the field still promotes
under the build identity, which is what this did for every build and is correct
at 1x.

`components` and `findingMarks` travelled the same way and did not survive: the
sidecar carries them, the request dropped them, and a baseline promoted through
review came back without. Both describe the document that painted the image, so
nothing downstream can recover them from the bytes — without the hashes a later
run ranks causes by area, and without the marks it reports every standing defect
as one the change under review introduced. Absent and `[]` stay apart end to
end, because nobody having looked is not the same fact as having looked and
found nothing.

For the same reason `push` no longer defaults a missing `missingFonts` to `[]`.
A sidecar that never said which fonts were missing now withholds the candidate
with a sentence naming the file, rather than promoting a baseline that claims a
font check it never ran.
