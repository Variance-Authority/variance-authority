# On dependencies

An import looks like one line of syntax. Added up, the imports of a repository
are its "uses" relation, and the shape of that relation decides which parts of
the system can be built, tested and understood without the rest. Software design
has argued for a direction in that relation for fifty years, and
dependency-analysis tools have long extracted it from code. [Variance
Authority](README.md) uses that derived structure as a review signal: it shows
when an ordinary import changes the dependency hierarchy before anyone has to
declare what that hierarchy should be.

This page follows that line of work and says where the product stops.
[Layers, restrictions and ceilings](boundaries.md) is the page that says how to
use the commands.

## Dependency is structure, not syntax

David Parnas's [Designing Software for Ease of Extension and
Contraction](https://experts.mcmaster.ca/scholarly-works/2169069) treats the
"uses" relation as the structure to design. A program A uses B when A's
correctness depends on B being present and correct. The design of that relation
decides which subsets of a system are useful on their own, and which extensions
can be added without touching what exists.

Nothing in that argument depends on what the relation was drawn on. It depends
on what the code does. An architecture diagram states the relation someone
intended, and the imports state the one that exists. Variance reads the second
from the [source index](source-index.md), so nothing has to be described twice.

## A hierarchy gives you an order

Dijkstra's account of the [THE
multiprogramming system](https://www.cs.utexas.edu/~EWD/transcriptions/EWD01xx/EWD196.html)
arranges the system in levels, where each level uses only the levels below it.
He describes testing it in that order: the system was tested from level 0, and
the next level was added only after the previous one had been tested thoroughly.
Once the lower levels were trusted, a test of a higher level could ignore how
they were built, which kept the number of relevant states small enough to test.

The narrow claim is this: when dependencies have no cycle, there is an order in
which lower pieces can be understood and tested before the pieces that use
them. The graph has a down. A layer number is that order, written as a
number for every package.

## A level is derived, not assigned

John Lakos's *Large-Scale C++ Software Design* takes the same idea to physical
dependencies between components. Its chapters cover acyclic physical
dependencies, level numbers and levelization, and the argument is that systems
with an acyclic physical hierarchy are cheaper to maintain, test and reuse.
Levelization there is a technique for making the dependencies acyclic, and level
numbers follow from the dependencies that result.

This is close to what `variance layers` reports. You do not write "this is a
layer 3 package" anywhere. The dependencies of the package make it layer 3, and
adding a dependency can leave the graph acyclic and still change the derived
level numbers. The event worth a line in review is therefore not that someone
broke a label. It is that an import changed where a package sits, and Variance
makes that change a first-class observation of the pull request.

The semantics differ in one place. Lakos levelizes a graph that is acyclic, and
treats a cycle as something to remove first. Variance takes packages in a cycle
as one strongly connected unit, then assigns a layer to the acyclic graph of
those units.

## Cycles have no order

Inside a cycle, no member is below another, so the order above does not exist
for them. Variance counts the members of a cycle as one step for that reason.

Cycles are also the part of this line of work with empirical support. Oyetoyan,
Cruzes and Conradi studied [defects and cyclic
dependencies](https://www.sciencedirect.com/science/article/abs/pii/S0164121213001878)
in six applications, open source Java and C# systems among them, and found that
most defects and most defective components were concentrated in components that
depended on a cycle, directly or indirectly. That is an association in the
systems they studied. It does not show that removing a cycle removes defects,
and Variance does not claim it.

## Observation comes before policy

Tools that enforce dependency direction start from a decision. Someone states
that the frontend must not use the backend, or that a target may be used only
from these places, and the tool fails when the code disagrees. This is the
practice usually called an architectural fitness function: a mechanism that
gives an objective check of some architectural characteristic, run as the system
changes. Thomas Much's [Fitness Functions for Your
Architecture](https://www.infoq.com/articles/fitness-functions-architecture/)
uses downward-only dependencies in a layered system as its example.

The product has four parts, and they are different kinds of statement:

- **`variance layers` is an observation.** It prints what structure the imports
  produced, and which packages changed layer in this pull request.
- **`variance restrictions` states a relationship** that must not exist.
- **`maxLayer` states a limit over a derived fact:** how deep a package may become.
- **`maxTier` states the same kind of limit over size:** how much code a
  package may pull in.

You do not need to know your target architecture before you can see that the
architecture changed. A team can read `3 → 5` in a review, decide it is fine,
and later write a ceiling because that number now matters. The ceiling is the
point where a measurement becomes a fitness function, and the person who
chooses the number is the one who makes it binding.

## A number is not a verdict

A layer is evidence about dependency structure. It is not a quality score. Layer
8 is not worse than layer 4, and a pull request that changes a package from 4 to
8 is not wrong for that reason. The claims that hold up are narrower:

- Hierarchical dependency structures have a long design history, from the
  sources above.
- Cycles have some empirical association with defects, within the limits of the
  study.
- A dependency chain gets longer when an import lengthens it, and you can see
  which import did.

No study this page relies on says that each extra layer costs a measurable
amount. That is why Variance reports the change and leaves the judgement to the
reviewer.

## Choose the next question

- [Read layers, restrictions and ceilings](boundaries.md) to see the depth of a
  package, write a rule, or set a `maxLayer`.
- [Select the tests that matter](selecting.md) when the question is which tests
  a change affects. That uses recorded runs and not the package graph, so a
  taller graph does not make it run more tests.
- [Orient in the code map](orientation.md) to see the layers next to the rest of
  what the source index holds.
