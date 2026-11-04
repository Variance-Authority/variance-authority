---
'@variance-authority/sense': patch
'@variance-authority/playwright-test': patch
'@variance-authority/cli': patch
---

A selection that keeps none of the files the runner found now says what that
means: `selected none of 340, so none of them runs`. Exit codes do not change. A
script that matches the whole line matches its new end; the start of the line is
as it was.
