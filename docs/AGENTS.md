# Working on documentation

## Every page is an entry point

Link every concept at its first introduction on a page to the public explanation
or reference that owns it. Readers may land directly on any page; never assume
they have read earlier pages or know the project's vocabulary. Use specific
section links when they answer the immediate question. Public pages must not
link to internal ADRs, journals or other context documents.

## Foreground the difference

A reader recognizes familiar machinery quickly and may stop before reaching the
capability that changes the decision. When a page depends on a distinction the
usual tool does not make, state that distinction in the lead or in the first
sentence of the section that owns it, before explaining the mechanism.

Name the difference in the reader's terms first: changed lines, the reviewed
candidate, response bytes, the test that reached the code. Introduce blocks,
graphs, journals and other internal representations after the consequence is
clear. Use bold sparingly to mark the decisive phrase. Do not manufacture
novelty; a reference remains a reference, and a page whose opening already
carries its uncommon claim needs no slogan added to it.

## Visual support

Use visual form deliberately. Lists and tables help only when their structure
makes a relationship easier to scan. A diagram or illustration is a bearer of
intent: a simple mental model of the page's structure, tradeoff or movement
before the prose develops it.

Reserve figures for those conceptual hinges. Say less and let the visual render
more of the thought. Use the fewest objects and labels that can carry the idea.
Follow [the visual guidelines](visual-guidelines.md) for the shared grammar.
