---
'@variance-authority/sense': patch
---

A case that evaluates a module through an inline require keeps what it entered afterwards

Under Jest's inline requires a module evaluates inside the first case that reads
one of its bindings. That case lost every region it entered both while the
module evaluated and after it, such as the function a higher-order component
returned, so a change there selected only the cases after it. The record of a
run with inline requires is now the record of the same run without them: what
ran while the module evaluated is flagged as loaded, and the case keeps its own
crossings.

A case that ran and crossed nothing is now named in the case index, with how it
settled, instead of being left out.
