---
'@variance-authority/sense': patch
---

A comment, type or formatting edit no longer drops the tests recorded for the file

After an edit to a file that changes nothing that runs, such as a comment, a type or formatting, the record dropped every test that loaded the file, and `variance review` reported its regions as no longer run. Those tests are now kept. After an edit that changes only function bodies, the tests that loaded the file are kept at its top level, and the tests of the changed bodies are dropped as before.
