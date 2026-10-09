---
'@variance-authority/playwright-test': patch
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

A page or story case reads the same way. When a module evaluates inside the
case's own drain, or in an earlier drain of the same case, the case keeps the
calls it made into the module afterwards. Joining a case's drains keeps a region
that one drain entered while the module evaluated and another entered plainly.

A case that ran and crossed nothing is now named in the case index, with how it
settled, instead of being left out.
