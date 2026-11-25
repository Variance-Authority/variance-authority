---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

The last line of an `ask` answer that was read without looking at the files now says what that means for the answer. It was "Snapshot <time>, not compared with the checkout: run `variance index` if files changed since." and is "Snapshot <time> may miss later changes: run `variance index`.", with the reason in parentheses where the files were to be looked at and could not be.
