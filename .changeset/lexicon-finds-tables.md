---
'@variance-authority/sense': patch
'@variance-authority/cli': patch
---

`ask symbol` and `ask search` read only the installed packages that can answer the question. The dependency catalogue now carries lookup tables for names, the words in names and docs, and purpose stems, so a question decodes the entries that hold what it asks rather than every entry. A package that ships no declarations is returned for a name only when it has a README to answer from, or when the question names the package. On Kibana, `ask symbol --name Button` went from 470 ms to 353 ms and `ask search --query recalculation` from 415 ms to 372 ms, with the same answers to the questions measured. The native lexicon question no longer returns a package that ships no declarations and has no readable README for a name it was not asked about; the CLI already left those out, so its output does not change. The catalogue format moves to version 4, and the next index rewrites it.
