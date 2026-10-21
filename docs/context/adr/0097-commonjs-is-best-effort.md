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
   No reader follows `exports.x` assignments, `Object.assign`, a reassigned or
   computed `module.exports`, or uses interop rules to decide that a read off a
   default import is a read off `module.exports`.
2. **A CommonJS gap is this position, not a defect.** An answer that misses a
   use made through a CommonJS object is classified against this ADR. The
   reader still answers what it can and names what is not recorded; it never
   guesses.
3. **Our own code is ESM.** New code in this repository is written as ESM.
   A `.cjs` or `.cts` file is added only where a tool cannot load anything else.

## Consequences

- Readers stay small: an ESM module states its exports, and the reader reads
  the statement.
- A project written in CommonJS gets coarser `ask uses` answers. That is the
  cost of this decision, and it is accepted.
