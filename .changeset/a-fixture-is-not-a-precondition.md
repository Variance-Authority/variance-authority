---
'@variance-authority/cli': patch
---

`variance select` names a file read without importing it as one for a `/// <depends>` in the module that reads it, where it used to send that file to `preconditions`. A `preconditions` entry is declared by every test the run records, so a change to a fixture listed there ran every test. The note on a file the suite's `ignore` matches now says what each declaration runs. The `variance-authority` skill's selection references say the same.
