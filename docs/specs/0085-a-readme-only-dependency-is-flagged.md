# Spec 0085 — a README-only dependency is flagged

**Missing:** the answer for a dependency that ships no declarations. The
dependency lexicon records such a package as `unavailable` with a reason
("the project resolver found no declarations for `x`"), and `ask symbol` for a
name from it stops there. The package's own `README.md` is installed beside its
manifest, often the only prose it ships, and nothing says it exists or reads it.
The workspace's own packages already fall back to their README for a name with
no doc comment; a dependency does not.
**Built on:** ADR-0002 (absent is not empty),
[ADR-0069](../context/adr/0069-every-answer-has-an-owner.md) (every answer has
an owner: the resolver says where the package is, the addon reads it).

## Purpose

An agent asking about a name from a dependency with no `.d.ts` is told there is
nothing, and concludes there is nothing. There is a file. Say where it is, and
when the name is in it, say which line.

## What would discharge it

**1. The lexicon records the README.** When an entry is `unavailable` and the
runtime resolution names a package manifest, the entry carries the `README.md`
beside that manifest: its path from the checkout root and its line count. The
path comes from the resolver's answer for the specifier, not from a walk over
`node_modules`. A package with no README carries no field, not an empty one. Only
packages the workspace imports are recorded. The reading happens in the Rust
addon that builds the lexicon; no JavaScript copy of it exists.

**2. Help says it is there.** `ask symbol` and `docs_symbol` for a name whose
package is `unavailable` print the README path and line count after the
reason, so the reader is told where to look and that no declarations exist. A
fixture package with a README and no declarations shows both lines; one with
neither shows the reason alone.

**3. The passage is labelled, never a doc.** If the name appears in that README
as a whole word, the answer carries the passage and its `file:line`, chosen the
way the workspace README mention is (prose before code, backticked before bare),
labelled as the package's README and never placed in `doc`. It is read in
process from the one file; no system search tool is invoked, so the answer does
not depend on a binary the machine may not have.

**4. Absence is stated.** An unreadable README is named as unreadable, not
dropped and not reported as missing. A lexicon written before this field exists
answers as before and says nothing about READMEs.

## When it leaves

When all four are on main: the lexicon version moves with the new field, the
public page that owns the dependency lexicon states the boundary in the
present tense, and this file is deleted.
