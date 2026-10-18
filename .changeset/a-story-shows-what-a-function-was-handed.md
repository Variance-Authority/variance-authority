---
'@variance-authority/sense': minor
'@variance-authority/cli': minor
---

A story shows what each function was handed

Every function step of a story now lists the values its parameters were bound
to, as `» handed cents=500, quantity=1`, and every case that went through a
module opens with what its top level declared when it loaded, as `» holds
Theme=ref1 react.context, Panel=ref2 function Panel`. A primitive is shown as it is, a string in quotes
on one line and cut to 40 characters. An object is a ref and its kind —
`Object`, `Array(3)`, `function Panel`, `class Till`, `react.memo` — read
without calling any of its getters, and never its contents. One ref is one
object for the whole run, so an object handed down from one component to
another carries the same ref at both. `--compare` compares a handed line as it
compares a printed one, with each ref's number left out, since a run numbers
objects in the order it meets them. These lines have a budget of their own and
never crowd out what the code printed.

The instrumenter emits one dormant call per function entry and one per module:
`__vaL&&__vaL(region,"a,b",a,b)`. Only the story tap answers it; on any other
run it is a read of a module variable and a branch not taken. Generators are
left alone, and return values are not captured. Function directives such as
`"use strict"` stay ahead of the call. Recordings are unchanged: blocks keep
their identity, so the instrumentation id stays, and the probe recipe digest
moves with the emitted code.
