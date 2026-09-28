# Spec 0081 — the tech stack is read from the code

**Missing:** the stack itself. The code map, the imports along a file and the
catalogue of installed APIs are published. No answer says what this project
builds on and builds with. Nothing tells a package the code uses from one that
is only declared. Nothing follows a local abstraction to the package it wraps.
Nothing calls a first-party area such as a design system a foundation rather
than an application. Graph-scoped `search` offers what any imported workspace
declares. A hit names no manifest, kind or local use. No package is found by
the job it does, `symbol` takes no location, and nothing is timed beyond this
repository.
**Built on:** [ADR-0082](../context/adr/0082-the-tech-stack-is-what-the-code-builds-on-and-with.md)
(the terms, and the rule each item below implements),
[spec 0041](0041-orientation-is-the-first-five-minutes.md) (orientation is held
to measured numbers), ADR-0002 (absent is not empty),
[ADR-0069](../context/adr/0069-every-answer-has-an-owner.md) (every answer has
an owner).

## Purpose

Orientation answers *where is the code*. Before an agent writes any, it needs
*what is the code made of*: the third-party packages the project uses, the
local abstractions it uses them through, and the first-party foundations it
builds on. That is the **tech stack**, defined in ADR-0082. It is the second
half of the first five minutes.

The answer turns three frequent agent defects into lookups:

- **A second dependency for a job the stack already does.**
- **A direct import past the project's own wrapper.**
- **A component written beside the design system's.**

## What would discharge it

Each item is one backlog task under TASK-21 and closes when its test runs.

**1. The project's stack, with no words** (TASK-21.11). A words-free question
(its CLI name is open until the command table is written) lists the stack in
its two halves, *built on* and *built with*:

- third-party members with their importing files, one site and their installed
  identities;
- shadowed members under the local abstraction they are used through, with how
  many files import the abstraction;
- foundation areas from the code map, with the areas that import them;
- *declared, not used* on its own line.

It pages in code-unit order like the code map and says how many entries remain.
This repository is the checked case. `oxc-parser` is used directly by
`sense` and shadowed for `help`, which imports it through `sense`. Areas that
other areas import are listed as foundations. Nothing is listed as used that
no file imports.

**2. The stack at a location** (TASK-21.11). With `--from <path>`, the same
answer is limited to what the code at the path uses, directly or through an
abstraction, plus the foundation areas it imports. A path that imports a
package directly while a local abstraction for it exists is reported at that
site.

**3. Usable here, by ownership** (TASK-21.9). Graph-scoped `search` lists a
third-party name as *usable here* only when the owning manifest of an asked
file declares it. A package declared only by a workspace the closure imports
is listed as *reached through*, with that workspace, or is not listed.
`--from packages/help/src/server.ts` in this repository offers none of Eyes'
test-only packages as usable. The FIXME in
[`search-answer.ts`](../../packages/help/src/tools/search-answer.ts) is
deleted by the change.

**4. Every entry shows its evidence** (TASK-21.10). Each third-party hit and
stack entry names its declaring manifest, declaration kind, installed runtime
and declaration provider with versions, and its importers with a count and one
site. Each part that could not be read is named. An empty answer gives its
scope. The catalogue records the declaration kind, which it reads today and
drops.

**5. A member found by its job** (TASK-21.12). The catalogue indexes each
installed package's `description`, `keywords`, README headings and JSDoc at
`variance index`. A foundation area is indexed by its packages' names,
descriptions and exported names. The measure is a committed set of at least
twenty described jobs, each with the member that should answer it, gated by a
`*.measure.ts` or `*.check.ts` on first hit and within three as integer counts.
The set includes jobs no member does, and their answer is empty with its scope.

**6. Symbol at a location** (TASK-21.13). `ask symbol --name <name> --from
<path>` resolves the package from the path's owning manifest. It prints the
signature and version installed there, whether the area uses it, and the local
abstraction it is used through. A name not usable at the path is answered with
the workspaces where it is usable.

**7. Under a second on the checkouts it is for** (TASK-21.14). Warm question
time for items 1, 2, 3 and 6 is under 1 s on Kibana and on the seven-copy MUI
corpus, recorded by a `*.measure.ts` with the machine it ran on. Cold and warm
catalogue refresh are recorded beside it. An index run over an unchanged
install reuses every catalogue entry and says so.

## When it leaves

When all seven are on main: the public [orientation page](../orientation.md)
documents the stack, the concepts registry in
`tools/docs-entrypoints.check.ts` gets an owner for *tech stack*, ADR-0082
becomes `accepted`, the checkpoint is updated, and this file is deleted.
