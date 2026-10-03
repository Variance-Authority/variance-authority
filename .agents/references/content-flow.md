# Content flow

What decides the structure of a published page: the root `README.md`, a
`docs/*.md` page, a package or example `README.md`. Read it before you outline
one, and before you read the spec or the code it describes.
[`docs/AGENTS.md`](../../docs/AGENTS.md) governs links, publication and the
sentences. It is applied after the structure holds. A page with correct
sentences in the wrong order has still failed.

The failure this prevents is a correct page nobody finishes. That page is
written from the spec, every true fact gets a paragraph, and every review round
adds a qualification in the place it was asked for.

## 1. One page, one job

Pick the job before anything else. It decides the shape:

- **Why** — a concept or an argument. The reader leaves understanding a
  difference they did not see before.
- **How** — a guide. The reader leaves having done something to their own code.
- **What exactly** — a reference. The reader arrives with a precise question and
  leaves with the answer.

A page may carry some of the other two, but one job controls the order. A page
that needs all three in full is two or three pages.

## 2. The brief comes before the outline

Write these down, in the PR body, before the first heading:

- **Reader**: what they already run and already believe.
- **Question**: what they arrive asking, in their words, not ours.
- **Difference**: one sentence, in the reader's terms, saying what they get that
  their current tools do not give them.
- **First example**: the smallest case that works, run once, with its real
  output.
- **After the first screen**: what the reader knows if they stop there.
- **Spine**: at most six steps, from the question to the reader doing it on
  their own code.
- **Off the spine**: every other fact you know, each one with its destination:
  the reference section, another page, the skill reference, a docstring, or
  nowhere.

Run the feature before you write the brief. Read the spec after. The spec lists
what is decided and what is open, and that list belongs in the reference, not in
the outline. An outline whose headings match the spec's was written from the
spec.

## 3. The order

Problem, difference, one working example, its result, how to do it on your own
code, the variations, then the reference. The first payoff is the example's
result, and it comes before any edge case, any rule about precedence and any
list of exceptions. The first screen is readable without a single word this
project made up.

## 4. Where a fact goes

Every section is one of four kinds:

- **Understand** — the reader needs it to see what the feature is for.
- **Operate** — the reader needs it to use the feature.
- **Look up** — true and needed sometimes, by somebody. It goes in the reference
  section at the end, or on the page or skill reference that owns it.
- **Elsewhere** — another page's story, the history of the code, a defence that
  runs once. It is linked or cut.

A fact does not earn a paragraph by being true. When the skill reference already
holds the exact semantics, the page links to it and does not repeat it.

## 5. A review changes the page, not the thread

Some review comments say the structure failed. Examples: *why do you need to say
this*, *an example maybe*, *who uses this*, a request to explain the concept
again, or a finding that adds a caveat to the first half of the page. Answer
those by going back to the brief: fix the spine, reorder or cut, then run the
flow review again. A patch at the line the comment is attached to leaves the
page worse.

A correctness finding is fixed where the fact lives. Often that means moving a
sentence into the reference section, or cutting it, rather than adding a
qualification where it stands.

## 6. The gate

The [content-flow reviewer](../agents/content-flow.md) reads the page alone. It
does not see the spec, the code or the history of the PR. The page passes when
that reader:

- states, from the first fifth of the page, what the feature gives them and the
  first thing they would do;
- writes the page's argument in five bullets or fewer;
- finds no section that should be somewhere else.

Run it on the current page before you change anything; it should fail the way
you think it fails. Run it again before the PR opens, and again after any
change to the outline. It goes first, before any review of facts or sentences.
