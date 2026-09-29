# Spec 0086 — a README is searched

**Missing:** a way to find a name by what a README says about it. `ask symbol`
reads the nearest README for a workspace name that was already found by its
declaration, and for a dependency that ships no declarations it names the README
and the passage. `ask search` reads no README, local or third-party. A name a
README explains and no declaration carries — `screen` in a testing library's
guides, a recipe the package wrote in prose — is found by neither.
**Built on:** ADR-0002 (absent is not empty),
[ADR-0069](../context/adr/0069-every-answer-has-an-owner.md) (every answer has
an owner: the lexicon records where the README is, the addon reads it), and the
README fallback for a workspace name with no doc comment.

## Purpose

A README exists because its author had something to say that a declaration
cannot carry. An agent asking what does this job, or where is `screen`, is told
nothing when the only answer is in prose. The README is a source, not a
fallback, and a package with declarations still has one.

## What would discharge it

**1. Every entry carries its README.** The lexicon records the `README.md` beside
the runtime manifest for every entry, not only an `unavailable` one: its path
from the checkout root and its line count. A package with no README carries no
field. Only packages the workspace imports are recorded, and the path comes from
the resolver's answer, not from a walk over `node_modules`. The reading happens
in the Rust addon that builds the lexicon.

**2. `ask search` has a README section.** A query is also asked of the recorded
READMEs, workspace and dependency alike, at query time in Rust and in process;
no system search tool is invoked. A hit is a passage with its `file:line`,
chosen the way a mention is (whole word, prose before code, backticked before
bare), and it is printed under its own heading. It never joins the declared
matches, never counts as documentation and never changes what `undocumented`
lists.

**3. A declaration with no doc shows the passage.** `ask symbol` for a
dependency name that has declarations and no doc comment prints the README
passage naming it, labelled as the README, as it already does for a workspace
name.

**4. Absence is stated.** A lexicon written before READMEs were recorded says
that search did not read READMEs, rather than printing an empty section. A
README that could not be read is named as unreadable. A query no README names
says so.

## When it leaves

When all four are on main: the lexicon version moves with the field, the public
page that owns the dependency lexicon states the boundary in the present tense,
and this file is deleted.
