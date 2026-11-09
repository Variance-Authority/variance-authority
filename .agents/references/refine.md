# Refine the task

Phase 1 of [`AGENTS.md`](../../AGENTS.md). Before any code, settle what the task
is, whether it should be done at all, and what would make it done.

## Look around

**What problem we solve.** For a `feat`, `fix` or `perf`, one question, read
five ways, before anything else here. Each word becomes something a reader can open, and a problem where one of
them cannot be named is not ours to chase, however well the rest reads.

- **What** becomes a sighting, and worth solving here: a quoted ask, a run or a
  transcript line in the Evidence, and the Impact it carries.
- **Which** becomes the particular way we pick. A problem comes in variants and
  each has several answers: the Change names the one it takes, why that one, and
  what already answers part of it, here or in a neighbour.
- **Problem** becomes an issue: one behavioural problem to one issue, with
  somebody better off once it is closed: the title and the Situation.
- **We** becomes a package: the package, and its `.compass/` block, that owns
  the answer, named in Affected. The project is one problem at depth
  ([what comes first](#what-comes-first)). When no package of ours is for it —
  the "Not ours" table of `.compass/COMPASS.md`, a [position](positions.md) or
  an [escape](escapes.md) names another owner — the issue is closed, naming
  that owner.
- **Solve** becomes a test: each Done when item is a test or a check that fails
  today where the Evidence saw the harm — an adopter's project, a CI run, a
  stranger's first command, not only this repository — and passes once the harm
  is gone. A Change that only eases the harm says why the rest is not worth
  solving.

The pattern is Anton Korzunov's
[What Problem We Solve](https://dev.to/thekashey/what-problem-we-solve-21no),
after The API Book's chapter on an application's field.

**The ask.** Restate it as one sentence that somebody else could check: what is
true when the task is done, and which gate says so — a test, a check, a
measurement, a CI comment. If you cannot write that sentence, the task is not
refined yet.

**The issue.** Search the GitHub issues, closed ones included, before filing
one, with the commands under "Tasks are GitHub issues" in `AGENTS.md`. An issue
that already holds the task gives its checklist, its parent and what blocks it;
the pull request that finishes it closes it.

**The chart.** For non-local work — crossing a boundary, changing a rule or an
invariant, adding a party, asking whether something belongs here, or building
any capability — search the architecture chart first (below). For a one-file
fix, a rename, or a bug with a stack trace pointing at the line, read the code.

**The paper trail.** Search what the project already decided and tried on the
subject before proposing anything:

| Place | What it holds |
|---|---|
| `docs/specs/` | What is not built. One vacancy per file. |
| `docs/context/adr/` | One decision, its alternatives, and its cost. |
| `docs/context/journal/` | What one attempt cost and what it taught. |
| `docs/context/checkpoint.md` | Current state of the whole. |
| [`docs/context/prior-art.md`](../../docs/context/prior-art.md) | Who else measured this, and what they found. |

A proposal that contradicts an ADR or repeats a journal's failed attempt is not
a proposal yet. Name the ADR and argue with it, or pick another route.

**The field.** Ask what this is called elsewhere, who measured it, and how it
failed for them. A metric the project coins needs its observation class —
observed, co-occurrence or inferred — and a base rate before anyone reads it as
evidence.

A research conclusion or a comparison with another tool is read by a reviewer
with no other context before it is reported or published. Its author cannot see
their own strawmen or overreach. Try the direct algorithm before a trained
one ([prior art](../../docs/context/prior-art.md#where-the-field-contradicts-us)),
and read a model's manual and a tool already working with it before the first
experiment.

**What already does this?** Before the task is a plan, it is a question about
the code that exists: which command, function or rule already answers it, or
answers most of it, and how the feature is reached from there — a call, an
extension, a route from one caller to another. Search for the behaviour, not
only the name: `yarn variance ask search --query <words>`, then the commands
`yarn variance --help` lists, then the ADRs that name the subject. When the task
names a mechanism — a journey, a divergence, sense — the project usually
implements it already, and the industry's term for something similar answers a
different question. New code is the exception, and the pull request proves it is
the only way: it names what exists, and says why none of it could carry the
change.

A second implementation of a shipped behaviour is a defect that drifts:
`summarizeObservation` was exported, documented, called by nothing, and
drifting from the private copy `playwright-test` had grown for the same job.
The fallback to relations for a suite with no record was started as a new import
walk in `sense`, with its own tests, before anyone noticed that test selection
already selects by relations — the graph `affectedBy` in `core/relate` walks. What that
feature needed was a route from the record that could not answer to the
selection that already could, and the new walk was a second copy of it.

## The idea loop

No code is written for an idea that has not passed review. The idea is
reviewed harder than the code will be: a defect in code costs a fix, and a
change that should not exist costs its whole build, its review, and the
reviews after it that measure everything else against it. Of the pull
requests closed unmerged before this loop, seven were ideas that should not
have been built; none was closed for broken code. A `docs`, `chore`, `ci`,
`test`, `refactor` or `revert` change has no idea to get wrong: it skips the
loop, and the kind's own row in the pull request reference is its gate.

**The brief is the issue.** Every change to what the product does — a
`feat`, `fix` or `perf` — starts as a GitHub issue, found or filed as "Tasks
are GitHub issues" in `AGENTS.md` says. Its body holds, in this order, one
section to a heading:

- **Situation**: `Given` the state and `When` the one thing somebody does, in
  Gherkin lines, apart from any fix. Scenarios that establish one contract share
  a brief, each with its own `Given`, `When` and `Then`.
- **Perceived**: what they get today, as the output reads, what they do
  instead, and what already answers part of it.
- **Expected**: `Then` what they should get, in Gherkin lines. A `Then` is
  something a reader can observe, never the mechanism that produces it.
- **Evidence**: who has the problem, each item something a reader can open —
  the owner's ask quoted, an issue, a failing run, a measurement, a spec in
  `docs/specs/`. At least one item shows somebody hitting the Perceived: their
  ask quoted, a failing run, or a transcript's path and line. A code line shows
  the mechanism, not the harm, and belongs in Root cause; an agent's report of
  its own trouble is a claim, checked against its transcript before it is cited.
  "Users may want", "for completeness" and "it was easy" are not evidence.
- **Root cause**: why the Perceived happens, and why that does, one link to a
  line, down to the root. Each link is something a reader can open, as Evidence
  is, or says it is a guess.
- **Affected**: the commands, packages, runners and `.compass/` blocks the
  scenario crosses, and the one package that owns the answer.
- **Impact**: who is hurt, how often, what it costs them, and what happens if
  this is never done, and why each RICE label holds.
- **Change**: the smallest change that answers it at the root, in the project's
  concepts, and the way it picks among the answers, with why. A Change that
  acts above the root says why it stops there.
- **Done when**: a checklist, each item a test or a check that fails on today's
  code where the Evidence saw the harm. Each `Then` is one of them.

**The whys come before the Change.** A problem is often the output of something
that should not stand, and a fix to it keeps that thing alive. Start at the
Perceived and ask why, one cause to a link. Five is a habit, not a count: the
root is where the next answer lies outside the project, or is a position that
still holds. A capability nobody built has a short chain: its root is that
absence. Two independent causes are two chains. Every link answers two
questions: would removing this cause remove the link above it, and should what
it names exist at all? When it should not, that is the real problem: the issue
is about removing it, as "Code is evidence, not a decision" in `AGENTS.md` says,
and the Perceived goes with it. A link with nothing to open is a guess: the
chain stops there and says so.

The written chain belongs to the brief, so to a `feat`, `fix` or `perf`. A kind
that skips this loop writes none: the look-around in `AGENTS.md` asks it the same
question. `occam` asks the whys of every kind in its diff mode, from the task
sentence and the repository, after the code exists, and a root other than the
brief's stands only on links that open.

**Review.** A brief goes to review with every section written. The `occam`
agent reviews the issue alone, in its idea mode: the issue number, and nothing
of your reasons. It opens every piece of evidence, asks the whys itself before
it reads yours, weighs the case for nothing against the change, checks the change
against [`escapes`](escapes.md), and gives one verdict:

- **incomplete** — a section is missing, out of order or holds only a
  placeholder, or a Change above the root does not say why. Nothing is decided:
  complete the brief and ask again. It is not a review, and it does not count
  toward the three below.
- **build** — put `idea: build` on the issue. Code may start. An edit to the
  issue's body after that needs the review again, and CI enforces it.
- **yes, but** — a part should not happen. Cut it from the issue. A cut taken
  whole is **build**: it only shrinks the change, and shrinking is what the
  review is for. Answering the rejection with evidence instead, or changing
  the Change, is reviewed again.
- **no, because** — close the issue as not planned, with the reason by its
  name in the closing comment. Closed issues are where a declined idea is
  found next time.

Three reviews that end without **build** close the issue. Nobody else is asked:
the loop decides, and a tie goes to the smaller change. A closed issue is
reopened when new evidence arrives, and the review starts over; the owner may
reopen one at any time.

**A verdict is a comment.** Whoever runs the review posts the verdict on the
issue, with its reason, ending in `<!-- idea-verdict: <name> -->`, where the name
is `incomplete`, `build`, `yes-but` or `no-because`. Whoever picks an issue up
for review posts `none` instead when it changes nothing the product does, so has
no idea to review. Only a comment from the owner, a member or a collaborator
counts, as the repository is public, and `build` still needs its label: the
label is what CI reads.

**A session that files an issue and does not build it owes the loop nothing
more.** `node tools/idea.mjs queue` lists what the loop still owes: every open
issue without `idea: build`, since the loop exits only on the label or a close,
and every labelled issue CI would refuse. A `none` says the issue was never in
the loop, and keeps it off the list until it is edited or reopened. An epic is a list, not a change, and an outsider's
issue is a report, so neither is listed. Issues holding a brief come first, since
they wait only for the review; the rest follow "What comes first", by score within
each rank. An `incomplete` nothing has changed since goes last, because another
review would say the same. A scheduled task on the owner's machine takes the top
of that list: it writes the brief an issue lacks, runs the review, posts the
verdict and follows it through. A `build` on an issue already labelled takes the
label off and puts it back, since CI reads when it went on. For the three reviews
above it counts the verdicts since the last reopen, leaving out `incomplete`.

**The loop learns.** A change that passed this loop and was later shown not to
belong — closed unmerged, reverted, or rejected by any reviewer, a person or a
model, on a reason the idea review could have seen — is an escape. Add it to
[`escapes`](escapes.md) as the question that would have caught it, in the same
change that closes it.

## What comes first

v1 is something a stranger adopts from npm and the public pages, on their own
project; #942 lists its gaps. Rank that first, then `structural`, then
`architecture`, then the rest. A wrong key, such as a name where a declaration
belongs, outranks any missing feature, because every feature built on the wrong
model inherits it. The idea loop's queue puts briefs ahead of this
order, as [the loop](#the-idea-loop) says.

The project is one problem at depth: keep fine-grained evidence of what code
did, at hundreds of thousands of files and tests, so a question is asked of the
record instead of re-running everything. It is parts and principles a team
arranges, not a complete product, and a source's own diff tool owns that
source's diff. Two standing goals rank within that. Visual review gates in
order: replace Percy, then Argos without its web interface, then Chromatic; the
cross-browser grid of spec 0020 is parked, and flake prevention, detection and
resolution come first. Test understanding has three pillars: every test knows
what it tests, a catalogue can be generated from any angle, and names are
maintained. What cannot be placed is flagged, and each pillar gates on a count.

Prove an idea in throwaway JavaScript first: Rust is for a measured hot spot,
since a contract settled in a rewrite costs a rewrite to change. Connect the
crudest form of every layer end to end before deepening any one, because a gap
between layers shows only when they join, and do not score orientation with
questions you wrote yourself: real cycles judge it.

An exploratory task gets one drafting pass and at most one bounded review pass.
Its open findings are listed in the deliverable, and every step ends in
something visible: a filed issue, a pushed commit. Loop-until-clean review
belongs to code that ships.

A design follows the world the product meets, not the fixtures that exist:
absence from this repository is no reason to defer an integration, and a missing
fixture is work to add.

## Decide, don't ask

A rule that reads like accidental cruft against the goal — widening on absence,
refusing on a guess, duplicating an owner's answer — is fixed and reported, not
asked about. A finding the task neither needs nor wrote is fixed in its own
change, on its own branch, as [change](change.md) draws the line. When two
readings are both defensible, take the one the evidence supports; when it
supports neither, take the smaller change and name the choice in the pull
request's Assumptions. No task waits on the owner.

Between options, pick the one that saves adopters the most time, not the one
cheapest to build: zero-config beats an annotation, a precise selection beats a
cheap one. Rank by what an adopter does and waits for.

A third-party tool that fails outside our code while its siblings work is
confirmed twice and then suppressed, not bisected: the cost of proving why
somebody else's build fails is unbounded. Run it once again when a version bump
lands.

When the repository's own loop falls short, the fix changes `AGENTS.md`,
`.agents/references/` and the published `variance-testing` skill in the same pull
request, so the improvement reaches every user.

A limitation is a bug or a position, never an apology. Classify it before
writing "we cannot".

## The architecture chart

The Compass chart root is `.compass/`. It charts the logical system, not the
repository: its blocks are cut by the question each one answers and deliberately
do not line up with `packages/`. The `compass` skill, installed at
`~/.agents/skills/compass`, owns how the chart is read and how it changes.

```bash
python3 ~/.agents/skills/compass/scripts/compass_search.py --chart-root .compass "<task terms>"
```

It prints the matched sections with their heading, file and line range, and says
which of your terms the chart names:

```
Found 10 section(s): 1 direct, 9 BM25-related. BM25 is a lexical ranking signal, not confidence or semantic proof.
Named by a chart heading, slug, or identifier: flake. Named nowhere in the chart: detection.
[1] variance-authority/GLOSSARY.md:562-572
    kind=glossary signal=exact term='flake' bm25=8.1512
    heading=Glossary — variance-authority > Flake
```

Consult the matched owning sections, then follow the skill's Consume route
through every chart level present. BM25-related results are leads, not semantic
proof.

The skill's two routes are exclusive. **Consume** reads an existing chart and
applies it to work done elsewhere. **Create** establishes or changes chart-owned
state — a chart file, a coordinate, a boundary, and this section. Consume never authorizes a chart
edit, and a Consume task that finds the chart missing, stale or disputed records
the finding and stops there.

Without the skill installed, the chart is still readable and the work is
Consume-only: [`.compass/COMPASS.md`](../../.compass/COMPASS.md) is the registry,
[`.compass/README.md`](../../.compass/README.md) states the scope, and every
architectural directory's own `README.md` is its identity document. Replace the
search with `grep -ril "<task terms>" .compass`.
