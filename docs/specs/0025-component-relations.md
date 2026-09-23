# Spec 0025 — what a component rests on, not just what a file does

**Missing:** component-to-component edges. The graph holds `component` as a node
kind and one edge kind reaching it — `declared-in`, from a component to the file
that declares it — so *what does a change reach* is answered through files and
`Card → Button` is not a fact this structure holds.
**Built on:** [ADR-0038](../context/adr/0038-a-change-reaches-a-component-through-files.md)
(the graph and its direction convention),
[ADR-0018](../context/adr/0018-a-component-hash-covers-its-own-nodes.md) (what a
baseline already records about composition), and
[`composition.md`](../composition.md) — which asks these questions of a *run* and
would rather ask them of the source.

## Purpose

The file graph answers a routing question: a change to `tokens.css` reaches
`Button`, because a chain of imports says so. It cannot answer a structural one.

Three questions are asked constantly and none of them has a file-shaped answer:

- *Where does `Button` appear?* — the suite answers this today by comparing itself
  against itself, from what a hundred runs painted. The source knows it without
  running anything.
- *What does `Card` render?* — a review question. A `Card` that gained a `Badge`
  is a different `Card`, and today that is discovered by looking at a picture.
- *Which components would newly render `Button`?* — the one case
  [`selecting.md`](../selecting.md) admits it cannot reach, because selection is
  over what the last run painted and a branch nothing has taken has no baseline
  to record it.

A file-level answer over-approximates all three in the same direction: a barrel
file makes every component in a directory reach every other, and `index.ts` in a
design system makes everything reach everything. That is safe for selection and
useless for explanation — "this change reaches 340 components" is a sentence
nobody can act on.

## What would discharge it

**A `renders` edge kind, produced by the scan, consumed by the same traversals.**

The structure already takes it. `NODE_KINDS` has `component`; `EDGE_KINDS` is a
closed list an entry is added to; `relationsOfFiles` folds `declares` into
`declared-in` edges and would fold a new field the same way. Nothing about
`affectedBy`, `dependentsOf` or `closureOf` changes: they walk kinds they are given.

Four decisions it forces, and each one is why this is a spec and not a
refactoring:

**1. What counts as *renders*.** `<Button />` in JSX is the easy case. A component
passed as a prop (`icon={<Star />}`), rendered from a variable
(`const C = big ? Card : Row`), produced by a factory, or reached through a map of
components is the real case, and a scan that only reads JSX elements silently
under-reads exactly the indirection a design system is built out of. The rule this
project already applies must apply here too: what cannot be read is *named as
unread*, and a component whose renders could not be enumerated is treated as
rendering anything its file imports.

**2. Where the name comes from.** `indexSource` attributes a component to a file
by declaration. A JSX element's name is a local binding, so `<Btn />` after
`import { Button as Btn }` has to resolve through the import to the declaring
file, or the graph gains a node for a name nobody exports. This is the half that
needs the resolver, not the parser, and it is why the scan produces it rather than
`core`.

**3. Whether an instance is a node or an edge.** A `Button` inside `Card` and a
`Button` inside `Toolbar` are the same component and two occurrences. The graph is
about *what rests on what*, so they are one edge each into one node — and the
consequence is that this cannot answer "which of the four Buttons in `Card`", which
is a question `composition.md` answers from a run and should keep answering there.

**4. What it does to selection.** Adding edges to a graph a selector walks can only
widen what a change reaches, which is safe, and the widening is not free: if
`renders` edges land on top of `imports` edges with no way to walk one without the
other, every answer gets larger for no gain. The edge-kind filter that already
exists (`through`, on the closure) is the mechanism; using it is a decision about
which question each caller is asking.

**Acceptance:** a fixture where `Card` renders `Badge` through an aliased import
and a barrel, and where one component is rendered from a variable. The first
produces a `Card → Badge` edge and no edge to anything else in the barrel. The
second produces a component marked unread, and every consumer treats it as
rendering everything its file imports — asserted, not assumed.

## What it is not

**Not a replacement for what a baseline records.** ADR-0018 stands: the components
a document *actually rendered* is a fact from a run, and the source can only say
what is possible. This makes the possible side sharp enough to explain with; it
does not make it the truth.

**Not a route to the unreachable case.** Knowing statically that `Checkout` could
render `Button` still does not tell a selector that today's change makes it, for
the first time, actually do so. Closing that needs the subject side too, and the
subject side is a run.
