# Spec 0030 — a diff moves the index, it does not merely explain it

**Missing:** the mapping from changed lines to blocks, and the ladder that
widens when a block has no trustworthy history. Nothing turns a diff into a set
of tests.
**Built on:** [0029](0029-what-a-run-remembers.md) (the rows this reads),
[`selecting.md`](../selecting.md) (the static selector this narrows within, and
its refusals, inherited unchanged),
[ADR-0039](../context/adr/0039-the-digest-is-the-proof-the-trail-is-the-explanation.md)
(every way a `base...HEAD` diff fails, and why this one does not have those
inputs).

## Purpose

`git` is the source of truth for what changed — not a content hash, and not a
static call graph. But the diff is not consulted only to *explain* the
selection. It **transforms the index**: it moves blocks that merely shifted,
retires blocks whose structure moved, and decides how far outward the change
must burn.

The diff is taken between **what the index recorded and what is on disk**, not
between a branch and a merge base. That is the whole reason this is safe where
`--since` is not. No ref is consulted, so a rebase, a squash, a branch switch
and a shallow clone change nothing, and a revert lands on rows already held.
Every failure
[ADR-0039](../context/adr/0039-the-digest-is-the-proof-the-trail-is-the-explanation.md)
enumerates is a property of inputs this diff does not have.

## What would discharge it

**1. Hunks with no context.** `git diff -U0` per changed file, so a hunk is
exactly the changed lines. Three lines of context would silently widen every
mapping across region edges. A diff `git` could not compute stops the run, as it
already does — an empty diff read as *nothing changed* narrows to nothing and
reports success.

**2. Re-cut rather than shift.** A block's lines are read out of the text on
disk, not slid by an accumulated delta: a module whose digest moved is parsed
again, and each fresh region takes the record of the region at its address.
Adding an import above a function re-keys nothing and moves no record. Delta
arithmetic would reach the same answer on the easy edits and the wrong one on
every edit that spans a region edge, and the parse is paid once per changed
module.

**3. An overlapped block keeps its record.** A hunk that lands inside a region
changes nothing about that region's identity, and the region is charged for the
change by steps 4 and 5 instead. A region the text no longer has takes nothing
down with it: arrival nests, so every test that entered it also entered every
region above it, and those rows still hold them. Only a region at an address the
previous table never held is minted, and a minted block has no history — which
is what makes minting the widening, with no separate "widen on ambiguity" rule
to forget.

**4. Burn inward.** A changed range selects the deepest block *containing* it
**and every block contained *in* it**. The second half is not optional. Swapping
two sibling closures in an object literal moves no line outside the object, so
without containment the run selects only whatever entered the enclosing
function — and if identity ever mis-binds those two closures, the run that
caused the mis-binding is also the run that fails to correct it.

**5. Back burn outward.** From each changed block, walk **up** the containment
chain and select every enclosing block. A change inside a block can alter
control flow *out of* it — an added `return`, `throw` or `break`, or a condition
that now throws — so an enclosing region's behaviour is no longer implied by its
own bytes.

**This step repairs a real hole rather than padding for safety.** The obvious
rule for a changed condition is *union the decision's outgoing probes*, and it
is unsound. A test where `x` is `undefined` throws inside `if (x.y)`: it entered
neither branch, so it is in neither probe's row. Rewrite to `if (x && x.y)` —
the most ordinary defensive edit there is — and that test's behaviour changes
while the union does not contain it. The enclosing region **was** entered, before
the condition was evaluated, so selecting it contains the test. Back burn costs
zero probes and replaces an enumeration with one lookup.

**6. The ladder, and every rung is printed.**

| The change resolves to | Selected |
|---|---|
| a block with a current, complete history | its recorded test files |
| a block minted this run | the nearest surviving ancestor scope's recorded test files |
| no surviving ancestor | the module — **the union over its blocks**, not the test files of its init probe |
| a module with no history at all | the static graph: `movedBy`, as it ships today |
| no graph either | the whole suite |

The module rung has one trap worth naming. `tests(module)` must be the union
over that module's blocks, because a module's top level evaluates once per
registry — so its init probe fires under whichever test first imported it, while
every other test in the worker executes its functions with no init crossing of
its own. Defining the rung as the union makes it a superset by construction.

**A rung climbed is a fact in the report, not a silent default.** `selecting.md`
already holds this: a run that quietly declined to narrow and a selector that
decided nothing was affected look identical and are opposite facts.

**Acceptance, as scenarios rather than units:** a file where an import is added
above an untouched function, where no block is re-keyed and only the module is
selected. A commit that reverts an earlier one, selecting nothing, from a
shallow clone with no merge base. A condition rewritten from `x.y` to `x && x.y`
where a test that previously threw inside it is selected — and is *not* selected
under the union rule, which is what makes the case worth keeping.

## What it forecloses

**It cannot select a test that would newly reach the change.** If the edit adds
a call that did not exist, no test has ever crossed it, and no execution index
can know. That gap belongs to the static graph, which is why the graph stays and
why this narrows within it rather than replacing it.

**A module-scope edit degrades to the module.** A file of top-level constants
has one initialization block, so editing any of them selects every test that
loaded the file — which is close to what the static selector already answers.
That stratum must be reported as a near-tie rather than folded into a headline.

**A `git mv` costs the file's history.** The path is part of a block's identity,
so a moved file's blocks retire and their recorded test files run once. Carrying
identity through `git`'s rename detection is refused: rename similarity is a
heuristic over line similarity, so a partially-rewritten "rename" would transfer
a test set onto code whose body changed — the false-match failure with a `git`
flag standing in front of it.
