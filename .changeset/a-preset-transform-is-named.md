---
'@variance-authority/sense': patch
---

`withTestSelection` and `withJourneyCoverage` wrap the `transform` of a Jest
preset such as `ts-jest` when the object you wrap names none. The wrap's own
pattern used to match first, so the preset's transformer never ran and the first
run failed on syntax. A `transform` in the object, and a preset with none, work
as before.
