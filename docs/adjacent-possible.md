# Why Variance Authority does so many things

[Variance Authority](README.md) starts with visual regression and does not end
there. It also shows you where to start in an unfamiliar codebase, selects the
tests a change needs, names the tests that run a line, helps you shrink an
oversized test, and records what a Java service ran for each test. Visual
regression no longer defines it, the same way guitars do not define Yamaha. One
phrase explains the list: self-reinforcing adjacent possibilities. Solving one
problem builds a capability, and that capability makes the next problem cheap.

## Yamaha made pianos, then motorcycles

Yamaha began in 1887 making reed organs, then pianos. During the Second World
War it made aircraft propellers, first wooden and then metal. After the war that
machinery stood underused, and in the early 1950s Genichi Kawakami put it to
work making small motorcycles. Yamaha Motor was founded in 1955, and by
[its own account](https://global.yamaha-motor.com/design_technology/technology/spread/008/)
the casting it learned on piano frames went into the cylinder of its first
engine.

A piano and a motorcycle are not adjacent products. What connects them is what
the company had built up underneath: casting, woodworking, machine tools,
engineers who knew iron and steel. A capability built for one product changes
which other products are practical. The adjacency is between capabilities, not
between products. Today the Yamaha name is on pianos, guitars, audio equipment,
motorcycles and boat engines, and no one of them defines it.

## Single responsibility describes a module, not a project

Software projects are often judged by a stranger rule. The first problem a
project solves becomes its permanent identity: a visual regression tool compares
screenshots, a coverage tool reports coverage, a test runner runs tests. When
the project takes on a second problem, the answer is "scope creep" or "single
responsibility". Single responsibility is a property of a module. Applied to a
whole product, it becomes a limit.

The software you already use does not accept that limit, and it looks natural
when it does not. React began as a library for building user interfaces.
[React 19](https://react.dev/blog/2024/12/05/react-19) also submits forms,
renders the document's `<title>` and `<meta>`, orders stylesheets, preloads
resources, and runs Server Components on the server. [Next.js](https://nextjs.org/docs)
began as server rendering for React, and now also optimizes images and fonts,
runs middleware, caches data and ships its own bundler, Turbopack. Each addition
uses what was already built: a renderer that knows every component on the page
is the right place to decide which stylesheet and which font the page loads.

That limit is why this project exists. The visual regression tools before it did
one job: compare the screenshots you give them. Everything before the
comparison was yours: which states to capture, how to keep them stable, and
what a difference with no visible cause means. A tool that only compares cannot
help with any of that. At scale, running the capture phase took more time than
its results were worth, and teams stopped wanting those tools in their
pipeline.

Single responsibility still holds here, at the level of a module. Each package
answers one requirement, as [the architecture](architecture.md) shows. The
system around those packages is not limited to one problem, and it keeps finding
problems it is unusually well equipped to solve.

## Visual regression brings two harder problems

We started with visual regression because it was the problem in front of us.
It brings two harder problems at once.

The first is understanding what you are looking at. Without that, a screenshot
difference is an alarm: something changed, and finding what is your job.

The second is avoiding unnecessary work. Rendering every state to learn that
almost none of them could have changed costs a lot and teaches little. Past ten
thousand screenshots, visual regression is a mess. It is either a chore nobody
reads or a bill that grows with every run.

## Evidence kept for one problem answers another

To understand what we saw, a run keeps more than pixels: the page's structure,
its text, the accessibility tree, the layout, the styles, which component owns
each element, and where that component is declared. Once those exist, they are
useful without the screenshot that made us keep them.

To run less, we needed more than imports. Source relations tell you what a
change could affect. They cannot tell you which branch a particular test took.
So execution itself became evidence: which test ran which regions of the
source, in which run. That is the
[execution record](execution-record.md).

## The expensive part is already built

Once the execution record exists, the next questions are cheap. Read from a
change, it [selects the tests](selecting.md) that ran the changed code. Read
from a line, it names [the tests that run it](test-level-coverage.md). Read from
one test, it shows what that test does, and beside what the test loads and
interacts with, it finds what an oversized test can shed. That is
[Distill](distill.md). Selection makes test-level coverage cheap, and
test-level coverage makes Distill cheap. The products look different. The
capability under them is the same.

Source knowledge works the same way. The [source index](source-index.md) exists
to reason about changes. The same relations tell someone new to a codebase where
to begin, which is [source orientation](orientation.md).

So does execution identity. Each test execution has one id, and when a browser
test calls a backend service, the same id goes with the request, so what the
service ran becomes part of
[the same test's record](across-dimensions.md). Existing Java coverage agents
record one total with no test on it, so they cannot tell two concurrent tests
apart. So we wrote [our own Java agent](../jvm/README.md). Described as a
feature of a screenshot tool, that sounds absurd. Seen from the capabilities,
it is the obvious next step.

## None of them is the centre

A feature list gives the wrong impression. Visual review, source orientation,
test selection, test-level coverage, test reduction and cross-service
attribution are not stages of one workflow you must adopt whole, and none of
them is the centre the others depend on. They are separate readings of evidence
that shares names. Each works alone. Together, the source one tool reads is the
same source another reads, and an execution stays the same execution when it
crosses into another service.

## The name is older than the code

The domain and the GitHub repository were created in 2022. The note written
then already said the idea was not only visual regression: it was also what has
to happen before a screenshot is taken, and what useful information a run can
collect along the way. It named changed-file selection, and the dependency graph
it needs, as the first thing that would make a real difference. Then the idea
sat untouched for years. The code here is recent. What survived was the
suspicion that something more valuable was under the original problem.

## Self-reinforcing adjacent possibilities

Stuart Kauffman calls the set of things one step from what already exists
[the adjacent possible](https://edge.org/conversation/stuart_a_kauffman-the-adjacent-possible).
Self-reinforcing adjacent possibilities is our name for what happened when we
picked the idea up again. Solve one concrete problem, and you build a
capability. That capability changes the cost of another problem, sometimes one
that looks nothing like the first. Solve that one, and the set of capabilities
grows again. The boundary of the project changes because what it does unusually
well keeps changing, not because everything belongs here.

Sometimes building the next thing would mean inventing the universe because you
wanted an apple pie. That is too much. Sometimes, while baking the pie, you
built an unusually good oven. Selling the oven is not a loss of focus, and
neither is baking the next thing the oven makes possible.

The question is not whether it was in the original plan. It is what became
possible because of what you already built.
