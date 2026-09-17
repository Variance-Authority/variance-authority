# ADR-0064 — public task pages change a decision

**Status:** accepted
**Date:** 2026-09-17

## Context

The public documentation grew from the evidence the implementation had earned.
Several pages therefore explain parsers, fibers, indexes, digests and report
shapes before establishing the situation in which an adopter would use them.
The material is accurate and valuable, but accuracy does not give it one reader
or one job.

A task label in navigation creates an entry contract. A reader following
"inspect presentation relationships" or "map what a source change can reach"
expects to recognise their situation, choose an action, observe a result and
know what to do next. An implementation account prepares a maintainer to defend
the mechanism instead. Combining both paths makes the task page depend on
context the entering reader has not received, while making exact technical facts
harder to retrieve.

Classifying pages as tutorials, explanations, how-to guides or references does
not settle that conflict. One page can contain any of those forms and still
serve the wrong reader. The distinction that changes placement is whether the
reader controls a product decision or action, or needs the technical contract
behind it.

## Decision

**A public task page must prepare its entering reader to make one supported
decision or complete one supported action. Technical mechanisms, formats and
implementation rationale have a separate reference owner.**

Every task page begins from context available at that URL. It establishes the
situation, affected outcome, applicability boundary, first verified action,
observable result and completion route before mechanism. It retains only
technical facts that change that path or prevent a wrong conclusion.

Reference pages keep exact contracts, evidence foundations, scalability
arguments, algorithms, formats, failure boundaries and implementation
rationale. A reference may be public: separation is about the reader's job, not
about hiding how the system works. User-facing pages route to it at the point a
reader needs to verify or extend the mechanism.

Navigation keeps those two paths distinct. A page that promises an adopter task
does not lead with internal decomposition. A technical page is named and placed
as reference even when its subject supports an important product capability.

When no task page owns a shipped capability, one is written from the supported
contract. When another task page already owns the outcome, the technical page
moves to reference rather than acquiring a second user-facing summary.

## Consequences

Presentation and framework evidence keep concise task pages and separate
technical references. Source scanning remains a technical reference; selection
owns the adopter's decision to run less work and carries the few scan boundaries
that change that decision.

Architecture, storage formats, indexes, performance evidence and package
contracts remain available without occupying the primary task path. Public
documentation may repeat a short consequence at an encounter point, but the
complete mechanism has one owner.

This costs editorial maintenance at each boundary: a new technical fact must be
tested for whether it changes the adopter's action, and links between the two
surfaces must remain valid. The alternative is cheaper to write and more
expensive to consume: every reader must reconstruct which parts of an
implementation account apply to them.

This decision does not require one documentation taxonomy or a fixed section
shape. It requires one reader impact per task page and a distinct owner for the
technical truth behind it.
