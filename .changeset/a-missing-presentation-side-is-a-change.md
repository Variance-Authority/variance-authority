---
'@variance-authority/report': minor
'@variance-authority/presentation': minor
'@variance-authority/mcp': patch
'@variance-authority/cli': patch
---

A presentation signal with one side missing is `changed`, not `incomparable`.

A side with no presentation reading, or a reading with no layout findings, now
gives `verdict: 'changed'` with a `because` that names that side and no effects.
This is the rule ADR-0090 already applies to one-sided accessibility evidence.
The signal still changes no subject's verdict.

`presentationSignal` returns `undefined` when neither side was measured, with
no reading or no layout findings on both sides, so the member stays absent
rather than holding a signal about nothing.
`PresentationSignalRecord` no longer has an `incomparable` variant: tell a
one-sided record from a compared one by `'because' in signal`. A run-report
file whose presentation signal says `incomparable` is refused when read.
