# Orient a coding agent in a codebase

An agent dropped into an unfamiliar codebase guesses names, re-implements
packages that are already installed, imports across the layering the code has,
and reviews a diff without knowing which lines any test watches. This path gives
it the readings that replace each guess, in the order it needs them: how to ask,
where to start, what it may build on, how the code is layered, and what the
change did.

[Variance Authority](README.md) answers from your checkout, its installed
packages and the record of the last run. This page orders the steps and links
the page that owns each one.

## 1. Give the agent a way to ask

Install the CLI as a devDependency and the agent asks with `variance ask`;
an agent that speaks MCP gets a second package. With no question, `ask` lists
every question it can answer and works before anything has run. Questions about
the source answer from the checkout alone; questions about what the tests did
need [a first run](start.md) to read.

[Choose an agent workflow](agent-workflows.md)

## 2. Find where to start

Orientation turns a question about the codebase into an address the agent can
read: a source name, a file, an import neighbourhood or a captured UI subject.
It says where to read next, not that the code there is right.

[Find where to start](orientation.md)

## 3. Build on what is already installed

Before it writes code against a library, the agent asks which packages the file
can already import, which installed one does the job, and the signature at the
version in `node_modules`.

[Use the packages your project already installed](tech-stack.md)

## 4. Respect the layers the imports build

Every package gets a layer number from the longest chain of imports beneath
it, derived rather than declared. Before the agent adds an import, it reads
which way the layers run; `variance layers` in a pull request lists which
packages changed number.

[See the structure your imports build](boundaries.md)

## 5. Review the change against what the code did

A diff cannot show whether the changed lines are watched. The
[execution record](execution-record.md) can: it names the cases that covered
each changed region, so the agent knows what a passing suite actually checked
before it forms an opinion.

[Review a change against what the code did](agent-code-review.md), and
[Review a pull request](path-code-review.md) for the whole review in order.
