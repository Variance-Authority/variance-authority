# ADR-0097 — ESM is the supported module system; CommonJS is best effort

**Status:** accepted
**Date:** 2026-10-21

## Context

`variance ask uses` missed a call made through the object a CommonJS module
hands out: `export = { recorder }` in a `.cts`, or `module.exports = { … }`,
read by an importer as `preconditions.recorder(…)`. Closing it means teaching
the reader what a CommonJS module exports: which keys the assigned object
spells, what each key's value names, and when interop makes a default import
the same value as `module.exports`. Each of those is a rule about a runtime
object, not a declaration the module states, and every further CommonJS shape —
`exports.x =`, `Object.assign(module.exports, …)`, a reassigned
`module.exports`, a factory that returns the object — asks for one more rule.

## Decision

**ESM is the module system variance supports. CommonJS is read on a best-effort
basis: a CommonJS shape is read when the rule is simple and local, and never
modelled beyond that.**

1. **Simple shapes only.** A reader may take what a statement spells outright:
   the static keys of the object literal `export = { … }` or
   `module.exports = { … }` assigns at the top level are the module's exports.
   An object with a spread or a computed key with no literal name exports
   nothing. No reader
   follows `exports.x` assignments, `Object.assign`, or a reassigned or
   computed `module.exports`. A read off a default import is matched to a key
   only as "through `default`: may read it", never as a definite read: interop
   decides it at run time.
2. **An unread shape is a limitation; a wrong answer on a read one is a
   defect.** An answer that misses a use made through a CommonJS shape this
   ADR does not read is a limitation of this position. An answer that is wrong
   for a shape rule 1 reads is a defect, fixed like any other. The reader
   answers what it can and names what is not recorded; it never guesses.
3. **Our own code is ESM.** New code in this repository is written as ESM.
   A `.cjs` or `.cts` file is added only where a tool cannot load anything else.

## Alternatives

- **Model CommonJS as fully as ESM.** Rejected: every further shape, from
  `exports.x` to a reassigned `module.exports`, is another rule about a runtime
  object, and none of them is a statement the module makes about itself.
- **Read no CommonJS at all.** Rejected: a top-level object literal handed out
  whole spells its keys, and reading them takes no guess.

## Consequences

- Readers stay small: an ESM module states its exports, and the reader reads
  the statement.
- A project written in CommonJS gets coarser `ask uses` answers. That is the
  cost of this decision, and it is accepted.
