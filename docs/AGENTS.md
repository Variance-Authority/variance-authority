# Working on documentation

## What this file governs, and how to check it

Public pages are the top-level `docs/*.md`, excluding this file and
`docs/visual-guidelines.md`. Publication is decided by explicit import in
`site/app/content/product-docs.ts`: every other top-level `docs/*.md` is
imported there, those two are not. Everything in a subdirectory of `docs/` is
internal — repository history and specification notes — and is never published
and never linked from a public page. Package `README.md` files are public and
may be linked.

Run the rules from the repository root: `yarn check` runs all of them,
`yarn check tools/docs-entrypoints.check.ts tools/docs-links.check.ts` runs the
two that read the rules below. A failure names the file and the line:

```
 ❯ tools/docs-entrypoints.check.ts (71 tests | 1 failed) 19ms
   × every public page introduces project vocabulary through its owner > docs/metrics.md 3ms
     → docs/metrics.md:320 → Distill should link to docs/distill.md
```

## Every page is an entry point

Link every concept at its first introduction on a page to the public explanation
or reference that owns it. Readers may land directly on any page; never assume
they have read earlier pages or know the project's vocabulary. Use specific
section links when they answer the immediate question.

The owner of a concept is one named page, not a judgement call. The `CONCEPTS`
registry in `tools/docs-entrypoints.check.ts` holds the owner of every name this
project defined — read it before linking, and extend it when you introduce a
name. Names outside that registry stay under the same human rule: spelling alone
cannot tell whether a sentence means the product concept or the ordinary
engineering word, so link the first mention that means the product concept.

Link owners by relative path, and let the path be the one the checker resolves:

- a page beside this one — `[the comparison](comparison.md)`, with a section
  anchor where it answers the question: `[test order](flakiness.md#test-order-and-shared-state)`
- a package README — `[Sense](../packages/sense)`, which resolves to that
  directory's `README.md`, or `../packages/sense/README.md` written out

An absolute `/docs/<slug>` target fails, because the rule resolves it on disk
and there is no such file. A `https://variance-authority.dev/...` URL fails
differently and more quietly: the entry-point rule ignores http targets
entirely, so the concept reads as never linked. Neither is a substitute for the
relative path.

Public pages must not link to internal ADRs, repository history notes,
specification notes or other context documents. This never collides with the
rule above: every owner in the registry is a public page or a package README, so
the owner is always linkable. When a concept's only written explanation is
internal, the move is to write that explanation into the public page that should
own it — and add it to the registry — or to cite the package README that owns
the detail. Never link inward instead.

## Foreground the difference

A reader recognizes familiar machinery quickly and may stop before reaching the
capability that changes the decision. When a page depends on a distinction the
incumbent does not make — the screenshot-diff tool the reader already runs,
which reports that pixels changed and not what drew them — state that
distinction in the lead or in the first sentence of the section that owns it,
before explaining the mechanism.

Name the difference in the reader's terms first: changed lines, the reviewed
candidate, response bytes, the test that reached the code. Introduce blocks,
graphs, the Eyes journal and other internal representations after the
consequence is clear. That journal is a product representation and is written
about freely; it is unrelated to the internal context documents above, which are
never linked. Use bold sparingly to mark the decisive phrase. Do not manufacture
novelty; a reference remains a reference, and a page whose opening already
carries its uncommon claim needs no slogan added to it.

## Visual support

Use visual form deliberately. Lists and tables help only when their structure
makes a relationship easier to scan. A diagram or illustration carries one
claim: a simple mental model of the page's structure, tradeoff or movement,
given before the prose develops it. If the figure asserts nothing the prose does
not already state plainly, it is decoration — cut it.

Reserve figures for those conceptual hinges. Say less and let the visual render
more of the thought. Use the fewest objects and labels that can carry the idea.
Follow [the visual guidelines](visual-guidelines.md) for the mark, palette,
geometry and figure conventions every page shares.

## `docs/` is not a work log

A `docs/` page describes the product as it stands at the end of the cycle. It is
read by someone who does not know this repository, has no interest in how it got
here, and will not open the git history.

It **must not**:

- **Mention a date.** Dates belong to the journal, the ADRs and the checkpoint.
  The exceptions are measurement provenance for an external fact (a competitor's
  published behaviour, a version number) and dates inside example data.
- **Narrate an absence.** No "nothing read this until…", "nobody had written
  this down", "said out loud for the first time", "this work did not make",
  "the first implementation reported eleven". A limitation is stated as a
  present-tense boundary of the product — *the sweep reads every subject in plan
  order* — not as a story about what was tried.
- **Tell another page's story.** Single responsibility. A page about composition
  says what composition is; the flake question belongs to `flakiness.md` and is
  reached by a link, not absorbed.
- **Compare itself to a previous version of itself.** Eleven→zero, first cut,
  used to be, now does. The reader is meeting this for the first time; there is
  no *before* in their world.

It **may**: state what the thing is, how it is measured, what a number is, what
the product refuses to conclude, and what it cannot reach — all in the present.

The journal is where "we tried X, it cost Y, we changed to Z" goes. It is
written for us, and it is the only place that shape is welcome.

## Who the reader is, and what they already know

**Read `docs/context/` before writing anything** — in this order, and stop where
it says to stop. A page written without it re-derives a settled decision,
re-argues one, or contradicts it; a page written after sweeping the whole
directory is a page nobody wrote.

1. [`docs/context/checkpoint.md`](context/checkpoint.md) — where the
   project stands. One read. It states its own budget: verdicts only, no
   deliberation.
2. [`docs/context/README.md`](context/README.md) — what the three
   directories hold, and the rules they are written under. One read.
3. Then only the entries your task names or your terms match. There are dozens
   of ADRs and dozens of journal entries, numbered in the order they were
   written and in no reading order at all, so search them rather than sweep
   them:

   ```bash
   grep -ril "<task terms>" context/adr context/journal
   ```

   Read matching ADRs before matching journal entries: an ADR constrains the
   code and a journal entry records one attempt at it. Stop when a match stops
   changing what you were about to write.

**Write from a senior engineer's baseline.** The reader has shipped software, has
opinions about build tools, and has been bitten by most of what this project is
defending against. So:

- **Nothing foundational is explained.** Not what a git blob is, not what a
  symlink does, not why a stringified closure loses its scope, not how
  case-insensitive filesystems behave. Name it and move on; the reader fills it
  in faster than the sentence takes to read.
- **A defence is not a story.** State what the code refuses and why it matters
  *here*. The failure mode it prevents is a clause, not a section — and if it
  needs a section, it is an ADR.
- **Every paragraph earns its place in one story.** A page has a spine. Anything
  true but off-spine goes in an ADR, a docstring, or nowhere. Interesting is not
  a reason to include something.

The failure this rules out is a correct page nobody finishes: three levels of
detail on a defence that runs once, in front of the mechanism the reader opened
the page for.

### Editorial direction

Write with substance and character, in language that does not require belonging
to the project.

- Respect what the page is doing. An argument persuades, an explanation develops
  understanding, and a reference answers precisely. Each needs its own shape.
- Assume engineering experience, not shared vocabulary. Readers know software;
  they do not know the project's private shorthand or the conversations behind it.
- Make the thought easy to follow. Clear relationships between ideas matter more
  than short sentences or fewer words.
- Preserve the author's intent and voice. Improve how the idea reaches the reader
  without replacing it with a generic documentation pattern.
- Keep the depth. Translate difficult wording while retaining distinctions,
  reasoning, and technical detail that earn their place.
- Let detail serve the purpose. Its placement and prominence depend on what the
  reader came for.
- Keep internal rationale internal. Public documentation does not link to
  `docs/context/`, name an ADR or journal entry, or depend on private project
  history. State any reasoning the reader needs in the public page itself.

**Public documentation** is an enforced set, not a judgment call:
`tools/docs-links.check.ts` holds the root `README.md`, every `docs/*.md`, and
the `README.md` of every package, example and case to the rule above. It refuses
a link that resolves inside `docs/context/` or `docs/specs/`, and it refuses the
strings `ADR-0000`, `journal 0000`, `spec 0000` and any bare `docs/context/…`
path anywhere in one of those files.

Everything else is outside that set and may cite whatever it needs: this file,
`CONTRIBUTING.md`, `docs/context/**` itself, and `docs/specs/**`. That is why
the rules below name a journal entry by number and a `docs/` page may not.

Welcome the reader from the system and constraints they already have. Seek to
understand those choices before presenting another one. Build shared ground,
state tradeoffs fairly, and show how existing tools can remain in place. A strong
position should clarify a decision, not manufacture an opponent. Readability is
better expression of the ideas, not simplification of them.

Apart from the scoping rule above, nothing in this section is checked. It is
held by review, which is why it reads as direction rather than as rules.

### The register

Every published sentence is written for one reader: an engineer who has shipped
software, does not know this codebase, and for whom English is often a second
language. That last part is not a small adjustment. It decides the words.

**A sentence is in register when all five of these hold.**

1. **Who speaks — the engineer who built the thing, now.** Not a story about how
   it got here, not the project as a company, not the software talking about
   itself. This keeps the tense present, and it keeps out the passive that hides
   who acts.
2. **Who is spoken to — one engineer deciding whether to use this.** One person,
   not an audience. They know software. They do not know our words, our history,
   or the arguments behind either.
3. **What makes it true — the thing itself.** Code, output, a measurement, a
   recorded run. **No sentence is true because of another sentence in the
   document.** A page is not an argument. Every paragraph stands on the product
   directly. This is why *it does not follow that*, *hence*, *therefore*, *it
   holds that* and *it suffices to* are out: each one says this sentence comes
   out of the last one, and none of them do.
4. **Words mean what they say.** A term of art passes — `import`, `closure`,
   `graph`, `hydration` mean exactly what they mean, and there is no limit on
   how many a page uses. A figure of speech does not: it is a word used for some
   sense other than its own, and there are none. That one line removes *it does
   not follow* (nothing follows anything), *seamless* (there is no seam),
   *powerful* (there is no power), *simply* (a claim about how the reader feels,
   not about the software), and the pretty inverted title whose shape carries
   what its words do not.

   **Move is the worked example.** To move is to change position. A button can
   move. A box, a line of text, a token, a pixel, a file going to a new path —
   each has a place, so each can move, and this product exists to report exactly
   that. Nothing else in a running system does. State changes. A value changes.
   A hash, a prop, a key, a name, a ratio, a digest, a verdict: all change, none
   move. *State tells you what moved inside the running system* is wrong, and
   the fix is *changed*. A change does not move code either — it changes it.
   Keep the word for the thing on screen that is one place today and another
   place tomorrow, because that is the finding the reader came for, and a page
   that spends *moved* on abstractions has no word left for it.

   **Reach is the second one.** To reach is to arrive somewhere along an edge
   somebody wrote: an import, a dependency, a render, a call. A change reaches a
   file, a file reaches a package, a diff reaches a subject, a test reaches a
   line. That walk is what `variance reach` answers and it is the finding the
   reader came for; nothing else in a page reaches anything. A run does not
   *reach a verdict*, it **decides** one. A harness does not *reach a state*, it
   **gets the app into** one. A test does not *reach into* a module, it
   **reads** what the module did not export. A writer does not *reach for* a
   word, they **use** it. A comparison does not *reach a person*, it **is shown
   to** one. A value does not *reach a digest*, it **is written into** one. A
   capability is not *reached for*, it is **chosen**.

   Density is the other half of this one. Even used correctly, the word makes
   one specific claim, and a paragraph that states it four times is not stating it
   any more. Say it once, then name the edge — *imports*, *depends on*,
   *renders*, *calls* — because the reader is counting how far the change went,
   and every extra *reaches* is one more thing to count.

   **The test behind all three: how much can the word mean?** A word with one
   meaning is safe to write as often as the subject needs it — `import` is an
   import, `hydration` is hydration, and nobody reading either has to work out
   which sense was intended. A word that means a dozen things is not safe once,
   because the reader has to pick, and the sentence is shorter than the pick.
   *Move*, *reach* and *follow* are all this: flexible enough to fit any
   sentence, which is exactly why they say nothing about the one they are in.
   The boundary is not the word's length or its register, it is how far it can
   stretch. Stretchy words get spent on the one thing they literally describe
   and nothing else; the rest of the time you write the verb that can only mean
   what happened.

   **Carry and hold are the third.** They are said about a thousand times across
   the published pages, which is nearly nine a page, and almost none of it is
   about carrying or holding. English has the exact verb for every one of these
   and it is usually the shorter one. A record does not *carry* a reason, it
   **gives** one. A document does not *carry* its hashes, it **lists** them. A
   report does not *hold* two totals, it **counts** them. A fixture does not
   *carry* both, it **is** both. A field does not *hold* a value, its value
   **is** that. A request **takes** a header, a log **records** a line, a
   baseline **stores** a pixel, a lockfile **pins** a version, a page **names**
   its subject, a run **keeps** what it will need again. Keep *carry* for a
   value that really travels — down a wire, through a process, along a chain —
   and *hold* for a thing really kept still, a lock or a frozen clock. Writing
   one of them because no other word came to mind is the caveman version of a
   language that has the right word for every case.
5. **Plain words, plain sentences.** Outside terms of art, use the most common
   word that still means it, and the plainest sentence that still carries it.
   *Use*, not *utilise*. *Enough*, not *sufficient*. *So*, not *hence*. *But*,
   not *albeit*. *About*, not *regarding*. *For example*, not *e.g.* Subject,
   verb, object. One idea per clause. No clause nested in a dash inside another
   dash. No idiom, no irony, no understatement, no cultural reference — those
   are the hardest things to read in a second language, and they carry nothing a
   plain sentence cannot.

   The line is sharp: **a hard word is allowed when it is a name, not when it is
   style.** `hydration` is a name. It has a page that owns it, it is linked the
   first time it appears, and a reader learns it once and keeps it. *Sufficient*
   is style. There is nothing to learn — it is *enough* wearing a suit.

**Expectations.** These hold across a page rather than inside one sentence.

- **One word, one job — and never a second word for the same job.** Swapping in
  a synonym to avoid repeating yourself is a habit from literary English. To a
  reader translating as they go, a new word means a new thing.
- **Every claim is checkable.** The reader can reach the code, the output or the
  number, and a number carries the machine it was measured on.
- **A limitation is a present-tense boundary of the product**, never an absence
  and never the story of an attempt.
- **The reader is the subject of the sentence.** Second person, task first.
- **A name this project made up is introduced on the page that owns it**, before
  any other page uses it.

**Boundaries — what this does not govern.**

- **The subject.** Plain English is not a plain subject. There is no cap on
  terms of art, no ceiling on what one paragraph may work through, and no
  distinction is ever dropped to make a sentence shorter. The language is plain;
  the thinking is not. A page that gave up a distinction to read more easily has
  failed this, not passed it.
- **Length.** A sentence may be long when every part of it is plain and it
  carries one idea. Two short sentences are usually better, and neither is a
  reason to lose the idea.
- **Warmth.** Direct is not cold. Condition 1 puts a person in the prose and
  keeps them there.
- **Scope — the published surface, and nothing else.** All five apply to the
  root `README.md`, `docs/`, package and example `README.md` files, the site,
  CLI output and error messages. `docs/context/` and `docs/specs/` are not
  published and are exempt. Write them in whatever language a machine can read:
  cite themselves, prove things, compress, use every term of art they need. The
  reader there is the next agent, not an engineer meeting this project for the
  first time, and the cost the five conditions buy is not worth paying twice.

**Counting instead of noticing.** Both worked examples above started with
somebody reading a page and finding the same word three times. `node
tools/register-histogram.mjs` does that part by measuring: it reads the
published prose with its fences and inline code taken out, groups words into
families, and prints how often each is said, on how many pages, and whether the
program says it too. A family high in that list and absent from the source is
the next candidate — there is no page that owns it, so it is style rather than
vocabulary. `--word=<x>` prints one family with every sentence it appears in,
which is what the judgement is made on.

**Habits to cut.** Each of these falls out of the five conditions, and each one
is easy to miss while writing.

- **Over-compression.** Write whole sentences, with their articles and their
  verbs. Spell out arrows and abbreviations. `Parser rejects bad date → exit 2,
  no write` becomes *the parser rejects a bad date, exits with code 2, and
  writes nothing*. A reader translating as they go has to decode the first one
  before they can read it.
- **An adverb holding up a weak verb.** *Runs quickly* is *is fast*, or better,
  the number. *Significantly improves* is the measured difference. If the adverb
  is carrying the sentence, the verb is the wrong verb.
- **A fancy way to say is.** *Serves as*, *stands as*, *boasts*, *features*. Say
  **is** or **has**.
- **Filler.** *In order to* is *to*. *Due to the fact that* is *because*. *It is
  important to note that* is deleted. So is a trailing clause that adds nothing:
  *ensuring correctness*, *highlighting the difference*, *reflecting the change*.
- **Stacked hedges.** *Could potentially possibly be argued that it might* is
  *may*. One hedge, or none.
- **Forced structure.** Three items because three sounds right. *From X to Y*
  where X and Y are not on one scale. Use the real number and name the real
  things.
- **Not just X, but Y.** Say Y.
- **A bold label that restates its own line.** **Performance:** performance
  improved. A bold lead-in is right when it names the item and what follows is
  new.
- **An ending that could end any page.** *The future looks bright.* A specific
  fact, or nothing.
- **A sentence that would be true of some other project's docs.** It says
  nothing about this one. Cut it.

Two well-known rules of this kind are deliberately not ours. Em dashes stay;
they are part of how this project sounds. And no word is cut for sounding
abstract when it is a name this project owns: `vantage`, `surface` and
`harness` each have a page, and condition 5 already separates a name from
style. Do not raise either again.

**How to check a sentence.** Ask four things. Who says this. What makes it true.
Which word is not meant literally. Which word would a good non-native speaker
have to look up — and is that word a name, or is it style. Nothing here is
checked by a test, and it is unlikely that it can be.
