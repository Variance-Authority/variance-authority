# ADR-0082 — the tech stack is what the code builds on and builds with, read from the code

**Status:** proposed
**Date:** 2026-09-28
**Relates to:** ADR-0002 (absent is not empty),
[ADR-0057](0057-the-run-writes-every-name-it-saw.md) (order is orientation,
never evidence), [ADR-0069](0069-every-answer-has-an-owner.md) (every answer
has an owner),
[spec 0041](../../specs/0041-orientation-is-the-first-five-minutes.md)
(orientation is the first five minutes),
[spec 0081](../../specs/0081-the-tech-stack-is-read-from-the-code.md) (what is
not built),
[`packages/sense/src/code-map.ts`](../../../packages/sense/src/code-map.ts),
[`packages/sense/native/src/dependency_lexicon.rs`](../../../packages/sense/native/src/dependency_lexicon.rs),
[`packages/help/src/tools/search-answer.ts`](../../../packages/help/src/tools/search-answer.ts)

## Context

An agent that knows where the code is still has to learn what the code is made
of before it writes any: the packages this project builds on top of and builds
with. Without that it adds a second state library, calls the date package
directly where the project wraps it, or writes a button beside the design
system's. Each is a change that looks right in the file and is wrong in the
project.

The pieces of an answer are on main. The code map folds the package graph into
areas and dependency layers. `orient --files` names the external packages the
local imports request, with sites. `variance index` publishes
`dependency-lexicon.json`, the installed API of every declared package,
resolved from the manifest that declares it. None of them answers *what is this
project's tech stack*, and the manifests cannot. A manifest lists what was
installed, which is more than what is used. It says nothing of a package the
code reaches only through a local wrapper. And it cannot say that a workspace
package is a design system and not an application.

## Terms

These are the words the answers, the CLI output and the public pages use. Each
has one meaning.

- **Tech stack.** The packages a project builds on top of or builds with. It
  has three kinds of member:
  - **third-party packages the code uses**, imported by the project's own
    files;
  - **shadowed packages**, third-party packages the code uses through a local
    abstraction, listed with that abstraction;
  - **foundation areas**, first-party areas the rest of the project builds on,
    such as a design system, which are not application.

  A package that is declared and imported by nothing is not in the stack. It is
  installed, and listed as *declared, not used*.
- **Built on and built with.** The two halves of the stack. *Built on* is what
  the shipped code imports: runtime packages and foundation areas. *Built with*
  is what builds, tests and types it: packages only test files, configuration
  and build scripts import, and types-only packages. The half is read from the
  kind of file that imports the package and from the declaration kind. There is
  no list of package categories.
- **Used.** The source index records a request for the package from a
  first-party file. Use is counted in files and import sites, and one site is
  shown.
- **Local abstraction.** A first-party module that imports a third-party
  package and is imported by other first-party code in its place. For example,
  `ui/Button` wraps a component library's button, or `lib/http` wraps a fetch
  client.
- **Shadowed.** A third-party package is shadowed for some code when that code
  reaches it only by importing a local abstraction. It is still in the stack.
  The answer names the abstraction, because the abstraction is what that code
  imports. Shadowing is relative to the code that asks: the abstraction's own
  area uses the package directly.
- **Area.** An area of the code map: a group of workspace packages folded by
  directory, name and imports.
- **Foundation area.** An area other areas import from, sitting in a lower
  dependency layer than they do. It is in the tech stack of each area that
  imports it. Its name is what its own packages are called, so a design system
  is found because its packages are named for one, not because a rule knows
  the words.
- **Application area.** An area no other area imports. It is where the stack is
  used, and it is not part of anybody's stack.
- **House solution.** For a job the stack does more than once, the member most
  files use. It is a count, and it is shown as a count.
- **Stack at a location.** The members of the tech stack that the code at a
  path uses, directly or through a local abstraction, plus the foundation areas
  it imports.
- **Owning manifest.** The `package.json` nearest above a path, which the
  catalogue's `owner_for` already chooses. A declaration whose range points at
  the root (`root:*`) is answered by the root manifest's declaration.
- **Usable here.** A third-party package the owning manifest of a path declares
  and the resolver finds from that manifest's directory. This is the only
  condition under which an answer says a new import of a package is allowed at
  a path. It is narrower than the stack. A package can be in the project's
  stack and not usable in a workspace that does not declare it.
- **Installed identity.** What the resolver finds from the owning manifest's
  directory: the runtime package and version, and the declaration provider
  (`@types/*`) when it is a different package.
- **Installed API.** The public names of a package's entrypoints, with their
  signatures and JSDoc, as the installed files state them.
- **Orienting in the tech stack.** Four questions, in this order:
  1. What does this project build on and with?
  2. What does the code at this path use, and through which local abstraction?
  3. Which member does a job, found by the words the package itself publishes?
  4. What does the installed API of a name say, and is it usable here?

## Decision

**The tech stack is read from what the code imports, not from what the
manifests declare. The source index and the code map decide membership. The
manifests and the resolver decide what is usable and installed.**

1. **Membership is use.** A third-party package is in the stack when a
   first-party file imports it. A first-party area is in the stack of the areas
   that import it. A declaration alone puts nothing in the stack.
2. **An abstraction does not hide a package.** Walking the recorded imports,
   the stack keeps every package a local abstraction wraps. For code that
   imports the abstraction, it names the abstraction as the entrance. Code that
   imports the package directly while an abstraction for it exists is reported
   at the site, beside the abstraction's own importers.
3. **Foundation and application come from the code map's edges.** Which area
   imports which, and the layers, decide it. No name, directory or list of
   known packages decides it. An area that both imports from and is imported by
   others is a foundation for the areas above it.
4. **Every owner answers its own part** (ADR-0069). The source index answers
   use. The code map answers areas and layers. The manifest answers what is
   declared, with its kind. The resolver, run from the owning directory,
   answers which copy is installed. The installed package answers what its API
   says. Nothing here computes a version from a lockfile, guesses a hoisted
   copy, or reads a declaration off an import.
5. **Usable here is ownership, not reach.** A graph-scoped question says
   *usable here* only for the owning manifests of the files it asked about. A
   package declared by a workspace the code imports is named as *reached
   through* that workspace, or not at all.
6. **Every entry shows its evidence.** A member is shown with its importers
   (count and one site), the abstraction that shadows it where one does, its
   declaring manifests and declaration kind, and its installed identity.
   Evidence that could not be read is named as unread (ADR-0002). An empty
   answer names its scope.
7. **A job is found by the package's own words.** The manifest's `description`
   and `keywords`, README headings and JSDoc, read when `variance index`
   refreshes the catalogue. For a foundation area, its packages' names,
   descriptions and exported names are used. Nothing is embedded, and no
   synonym list is kept.
8. **Question time reads published artifacts only.** The source index, the
   code map and the catalogue. No manifest, installed file or source text is
   opened to answer.
9. **The answer names, it does not advise.** Order is orientation (ADR-0057).
   The answer lists what is used, how and where, with counts. It does not rank
   packages by quality or suggest one the project does not use.

## What this forecloses

- **The stack as the manifest's dependency list.** Declared and unused packages
  are listed apart, and they are not part of the stack.
- **Availability by graph closure.** This is the rule `search` uses today, and
  the FIXME in `search-answer.ts` marks it.
- **Only third-party packages.** A design system in the same repository is a
  member, found by the same edges that find a third-party one.
- **A curated taxonomy.** No table says a package is a state library or an area
  is a design system. The halves come from importers and declaration kinds. A
  job comes from the package's own words.
- **Semantic search over the stack.** A job described in words no member uses
  finds nothing, and the empty answer names its scope.
- **Reading the installed tree or the source at question time.** The cost moves
  to `variance index`.

## Cost

- A package imported only by a file the source index did not read is missing
  from the stack. The index names the unread file, and the stack answer says it
  is incomplete.
- A foundation area the application imports through dynamic requests with
  computed specifiers has no edge, so it looks like an application area.
- In a repository with one package there are no areas, so there are no
  foundation areas. The stack is third-party only, and it says so.
- Shadowing is counted per importing area, so one package can appear as used
  directly in one area and shadowed in another. That is two facts, and the
  answer shows both.
- A package whose authors wrote no description, keywords or JSDoc cannot be
  found by a job, only by its name.
