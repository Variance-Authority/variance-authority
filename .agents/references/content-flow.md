# Content flow

What decides the structure of a top-layer page: the root `README.md`, a
`docs/*.md` page, a page on the site. Read it before you outline one, and before
you read the spec or the code it describes.
[`docs/AGENTS.md`](../../docs/AGENTS.md) governs links, publication and the
sentences. It is applied after the structure holds. A page with correct
sentences in the wrong order has still failed.

The failure this prevents is a correct page nobody finishes. That page is
written from the spec, every true fact gets a paragraph, and every review round
adds a qualification in the place it was asked for.

## The three layers

A fact has one owner, and the top layer is only one of three:

| Layer | Owns | Reader |
|---|---|---|
| Top: `README.md`, `docs/*.md`, the site | What a capability is, why it matters, how it connects to the rest. No detail of how it works. | Anyone deciding or understanding, including people who never install the CLI |
| Skill references: `packages/cli/skills/variance-authority/` | How to run it: one question per file, every flag and edge case | Agents, our main users. They ship with the CLI |
| API docs: JSDoc on exported symbols, package READMEs | What a symbol does, and how to use the package | Whoever calls it |

The layers are incomplete apart and complete together. A detail pushed up into
a page is how a concept page ends in eight reference subsections the skill
reference already holds. A package README follows the `context-docs` skill's
*Package README* role; when it grows long, material moves to `docs/` and the
README routes to it.

## 1. One page, one job

Pick the job before anything else. It decides the shape:

- **Why** — a concept or an argument. The reader leaves understanding a
  difference they did not see before.
- **How** — a guide. The reader leaves having done something to their own code.
- **What exactly** — a reference. The reader arrives with a precise question and
  leaves with the answer.

Most top-layer pages are *why*: a concept explained for a reader who may never
run it. A page may carry some of the other two, but one job controls the order.
A page that needs all three in full is two or three pages; propose the split to
the person who asked, do not make it. The three are Diátaxis's explanation,
how-to and reference.

## 2. The brief comes before the outline

The brief is the `context-docs` skill's story contract, kept to what controls a
page here. Write it before the first heading, in your worktree, and carry it
into the PR body's Behaviour section when the PR opens:

- **Reader**: what they already run and already believe.
- **Question**: what they arrive asking, in their words, not ours.
- **Difference**: one sentence, in the reader's terms, saying what they get that
  their current tools do not give them.
- **First example**: the smallest case that shows the difference, run once, with
  its real output.
- **Spine**: at most five steps, from the question to what the reader leaves
  with.
- **Expected readback**: what a cold reader should say the page gives them and
  what they would do first, after reading only the lead and the headings.
- **Off the spine**: every other fact you know, each with the file in the layer
  that owns it and whether that file already says it. "Nowhere" is an owner:
  the fact is left out on purpose, and the brief gives the reason in a clause.

Run the feature before you write the brief. Read the spec after. The spec lists
what is decided and what is open, and that list belongs to the skill reference
and the API docs, not to the outline. An outline whose headings match the
spec's was written from the spec.

## 3. The order

The job sets it:

- **Why**: the problem, the difference, one example that shows it with its
  result, the argument, what it changes for the reader, then where to go next.
- **How**: the problem, one working example and its result, doing it on your own
  code, the variations.
- **What exactly**: the order the reader looks things up in.

Either way, the first payoff comes before any edge case, any rule about
precedence and any list of exceptions. The first screen is readable without a
single word this project made up.

## 4. Where a fact goes

A fact does not earn a paragraph by being true. Each one goes to the layer that
owns it, and the page keeps one sentence on its consequence for the reader:

- How to run a command, a flag, an edge case of a call: the skill reference. A
  page names it as the `variance-authority` skill shipped with the CLI, not by a
  path in this repository.
- What a symbol accepts, returns or refuses: its JSDoc.
- Why the code is shaped the way it is: an ADR or a docstring.
- Another page's story: that page, by a link.

The `context-docs` skill's *prior and speciality admission* decides whether a
fact is written anywhere. A section whose purpose you do not know is kept until
you find it; a reviewer's cut is a candidate, not a decision.

## 5. A review changes the page, not the thread

Some review comments say the structure failed. Examples: *why do you need to say
this*, *an example maybe*, *who uses this*, a request to explain the concept
again, or a finding that adds a caveat to the first half of the page. Answer
those by going back to the brief: fix the spine, reorder, or move the fact to
its layer, then run the cold read again. A patch at the line the comment is
attached to leaves the page worse.

## 6. The cold read

The [content-flow reviewer](../agents/content-flow.md) reads without the spec,
the code or the history of the PR. It gets the reader and the question from the
brief, never the expected readback.

1. **Before drafting**, give it the lead and the heading spine only. Compare its
   readback with the expected one. Where they differ, fix the lead or the spine
   once and read again. A spine that still differs goes back to the brief.
2. **Before the PR opens**, give it the finished page once.

The reader reports what it understood; the brief decides whether that is right.
A stall on a prerequisite is not a failure when the page names it in one clause
and links the page that sets it up, and the brief's reader either has it or is
sent there: the reader cannot follow links, so it reports the gap either way.
Which layer owns a fact is not a reading question: the Fidelity reviewer in
[pull request](pull-request.md) checks the brief's off-spine list against the
files it names.
