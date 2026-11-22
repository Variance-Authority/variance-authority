---
'@variance-authority/sense': patch
'@variance-authority/help': patch
'@variance-authority/cli': patch
---

`ask classify` names the file that defines a declared word, not a file that only destructures it from another: `symbol` reports such a top-level name with kind `[binding]`, and classify's named-file block leaves those lines out. A word only bound, and defined nowhere, gets no declared file. A parse read back from a kept index no longer drops a JavaScript file that declares a top-level `let`, `var`, `using` or binding.
