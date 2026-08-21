# Spec 0031 — a published interface is a subject, and direction decides who breaks

**Missing:** any subject that is not a rendered document. `SubjectRef.kind` is
`story`, `route` or `fixture`; `CaptureMaterial` is a document or a raster; every
band in `BANDS` is a fact about markup, boxes or pixels. An OpenAPI description, a
GraphQL schema, a route table or a JSON response body has nowhere to enter, and
the comparison that would decide what such a change *means* does not exist.
**Built on:** [ADR-0044](../context/adr/0044-capture-material-and-rendering-placement-are-independent.md)
(material and placement are independent, which is what makes a third material a
seam rather than a fork), [ADR-0015](../context/adr/0015-a-rule-is-what-a-stored-snapshot-can-decide.md)
(a rule belongs here only if a stored snapshot can decide it),
[ADR-0002](../context/adr/0002-observation-profiles.md) and
[ADR-0012](../context/adr/0012-observability-and-the-damage-boundary.md) (what a
reading could not reach is said, not defaulted),
[ADR-0041](../context/adr/0041-a-request-is-the-edge-a-binding-is-the-name.md)
(a name resolves to the file that declares it, through the re-export chain), and
[ADR-0011](../context/adr/0011-durable-and-ephemeral-retention.md) (what may
accumulate).

## Purpose

A team publishes two things that must not change silently. One is the UI. The
other is the interface other people's code is written against, and it fails
harder: a padding token that moved costs a review, and a response field that
vanished costs everyone who read it, in production, without a screenshot.

The tooling that watches the second one splits into two halves that do not meet.
A linter reads one revision and knows nothing about the last. A snapshot tool
compares two serializations:
[`argosSnapshot`](https://argos-ci.com/docs/quickstart/vitest-quickstart) takes
any value in a browserless Node test, serializes it, and renders the difference
according to the file extension it is handed. That produces a picture of a diff
for a person to read, and leaves the whole question open. Neither half answers
what a reviewer actually asks: **is this a change my callers survive, which of
them does it reach, and where is the code that did it.**

That is the same question this project already answers about a document, and the
same reason it can be answered: the artefact is parseable and the parse holds
facts the diff does not. A schema knows a *position*, and position is what
decides compatibility.

> Adding a member to an enum is safe in a request and breaking in a response.
> Making a field nullable is safe in a request and breaking in a response.
> Making a field required is breaking in a request and safe in a response.

Two assumptions hold that blockquote up and are stated rather than implied. The
repository **publishes** the interface, so *breaking* means breaking somebody
else's caller — a repository that merely consumes an interface reads the same
deltas with the directions swapped and has no use for `capability` at all. And a
widened output breaks a caller that handles its values exhaustively, which is the
common case in a typed client and not a universal one; the run reports the
widening and never counts the clients.

Each of those pairs is the *same edit to the same line of the same file*. A text
diff cannot separate them, cannot separate either from a reordered key, and
therefore has one setting: show a human everything and let them classify it. A
run that parsed the document classifies it, names the type that moved once
instead of once per operation that inlines it, and resolves that type to the
`file:line` that declares it.

## What would discharge it

**1. A third material, and a subject kind for it.** The acquisition boundary
already takes documents and rasters and routes both to one attribution path.

```ts
/** Proposed: the third arm of `CaptureMaterial`. */
interface ContractMaterial {
  readonly kind: 'contract';
  readonly contract: InterfaceDocument;
}

/** A parsed, normalized public interface. Dialect-specific readers produce it. */
interface InterfaceDocument {
  /** `openapi`, `graphql`, `route-table`, or `value` for the untyped case. */
  readonly dialect: string;
  /** What emitted it, and its version — the environment key for this material. */
  readonly generator?: { readonly name: string; readonly version: string };
  readonly operations: readonly InterfaceOperation[];
  /** Named types, once each, referenced by operations rather than inlined. */
  readonly types: Readonly<Record<string, InterfaceType>>;
  /** Names the reader could not resolve. Absent is not empty (ADR-0002). */
  readonly unread?: readonly string[];
}

interface InterfaceOperation {
  readonly id: string;
  /** Flattened. `total.amount` is a field of this operation, not of `Money`. */
  readonly request: readonly InterfaceField[];
  readonly response: readonly InterfaceField[];
}

interface InterfaceField {
  readonly path: string;
  readonly type: string;
  readonly required: boolean;
  readonly nullable: boolean;
}

interface InterfaceType {
  readonly shape: 'object' | 'enum' | 'union' | 'scalar' | 'list';
  readonly members: readonly string[];
  readonly digest: Digest;
}
```

Rendering placement stays independent of it, because there is nothing to render:
a contract subject is decided below the `jsdom` tier and never launches a
browser. That is not a special case being carved out; it is the existing rule —
ask each question at the cheapest representation that can answer it — reaching
its floor.

**2. A band family, in the same list, with the same ordering claim.** Change
frequency and change importance are inversely correlated here too, and the
existing bands are the proof that the axis works: a removal is rare and fatal, a
description edit is constant and harmless.

Every row is qualified by position, because an unqualified one is wrong half the
time. Direction is recorded on the delta, not encoded in a band of its own.

| Delta | Position | Band |
|---|---|---|
| operation removed; input field, enum member or accepted type removed; optional input made required; input type narrowed | request | `contract` |
| output field removed; output made nullable; output enum or union widened | response | `contract` |
| operation added; optional input field added; input enum member or accepted type added; input field made nullable; required input made optional | request | `capability` |
| output field added; output made non-nullable | response | `capability` |
| description, summary, example, `operationId` spelling, enum member order | either | `annotation` |

**A type reachable from both positions takes the loudest band across them, and
this is the common case, not the corner.** A GraphQL enum or scalar is shared
between argument and field position by construction; an OpenAPI component under
one request body and three responses is what `$ref` is for. So the band is not a
property of the delta alone — it is computed once per position that reaches the
type, and the loudest wins. A shared enum gaining a member is `contract`, because
one of its positions breaks, and the report names the positions, because *this
enum is read as well as sent* is the fact the fix depends on. Reachability per position falls
out of the model above because an operation's fields are **flattened**: a nested
`Money` under `total.amount` is a field of the operation that reaches it, named
by its full path, so the positions of a type are a scan of the operations rather
than a transitive walk that has to condense cycles. `types` then holds identity
and digest, and holds no second copy of the tree.

The decision this forces is whether these bands join `Band` or form a union of
their own — and this repository has already done it both ways.
`packages/history` deliberately keeps a `Band` of its own, on the argument that
its axis (*which hash*) is not `core`'s axis (*how loudly*) and that a compile
error beats a silent mix-up. **These join, and the reason is that the axis is the
same one.** `contract`/`capability`/`annotation` order by frequency against
importance exactly as `a11y` through `texture` do, `blocking: ['a11y']` is a
sentence an operator already writes, and every policy surface — sensitivity,
ignores, the docket, the report's grouping — is keyed on `Band` today.

Joining costs three things, and none of them is optional:

- **One ordering across two families that never co-occur in a subject.** Stated
  rather than inferred: `contract`, `capability`, `a11y`, `geometry`, `token`,
  `content`, `annotation`, `texture`.
- **Every profile must answer for the new bands.** `observableBands` returns a
  `Record<Band, Observability>` precisely so a new member is a compile error, and
  a Chromium profile's honest answer for `contract` is *none* — which is the
  permanent-yellow-line problem item 3 exists to solve. So items 2 and 3 are one
  change, not two.
- **Sensitivity must not absorb a breaking change.** `bandsOf('layout')` is
  `['a11y', 'geometry']` and everything else is absorbed and counted, so a
  `layout` rule would report a removed field as a number. Refusing such a rule is
  not the fix, because the rules that cause this name nothing: `appliesToSubject`
  treats an absent `subjects` as *every subject*, `*` matches every id, and a
  refusal broad enough to catch those turns every existing config into an error
  the moment an adopter adds a contract subject. **Contract bands are instead not
  absorbable**: `asIgnore` drops them from the absorbed set it builds, so a
  `layout` rule goes on absorbing `token`, `content` and `texture` exactly as it
  does today and cannot silence `contract`. The register keeps counting what it
  did absorb, so nothing goes dark either way.

  A defect in that path is adjacent and predates this: `SensitivityRule.tags` is
  documented as a scope and is copied into the translated ignore by nothing, so a
  rule scoped only by tags absorbs across every subject in the run. It is marked
  at the line that owns it and is not this spec's to fix.

**3. Applicability is not observability.** A profile that could not read a band
reports `unobserved` and must keep doing so. A band that *cannot apply* to this
subject kind — `geometry` on a schema — is neither observed nor unobserved, and
printing `unobserved` for it turns a category error into a permanent yellow line
in every report. So band applicability becomes a property of the subject kind,
intersected with `observableBands` rather than replacing it. The two failures
this separates: a swagger file that claims a layout regression is unmeasured, and
a Chromium run that quietly stops reporting `a11y`.

**4. The root is the type, not the operation.** A shared `Money` losing a field
reaches every operation that returns it, and a report that lists forty subjects
has recreated the forty-failing-screenshots problem in a new medium. The
shape for this exists and is the point of the project: one root, its band, the
subjects it reached, and the `file:line` where the thing is declared — resolved
through a binding, not a file, because a schema barrel republishes names exactly
the way a component barrel does (ADR-0041). Three closed unions open to admit it,
and the list is the work: `DeltaKind` gains the contract deltas, `RootKind` gains
`type`, and `Root.impact` becomes optional — it means reflow, paint or composite,
and a schema has none of the three. Attribution degrades in a
stated direction: a hand-written description file locates directly; a generated
one locates to its generator's input when the generator records one, and to the
declaration site of the exported symbol when it does not.

**5. Normalization is a ruleset, and it is versioned.** Serialization key order,
`$ref` inlining, server URLs, a version field the build stamps, and a generator's
own formatting all move without the interface moving. The order of an enum's
*members* is not one of them — it is a fact of the type, some clients index into
it, and it is reported at `annotation` rather than normalized out of existence. These are the cruft rules of
this medium, they belong in `rules/` beside the ones that already exist, and the
ruleset version is part of what a stored digest is stored under. A `$ref` that
cannot be resolved is `unread` and propagates — never silently inlined as an
empty object, which reads downstream as *a type with no fields*, which reads as a
removal.

**6. The wire, which the run is already on.** The network observer routes every
request the page makes and reads bodies only for images, fonts and media;
everything else is continued unread. Reading the JSON ones makes the API a
subject the UI run already visited, and joins two findings that are currently
found by two people: *this component changed* and *this endpoint's payload
changed shape*. This is the consumer-side case, so the directions invert: the
repository reads these responses rather than publishing them, and a field that
vanished from one breaks *this* code. The band is the same; who it is reported
to is not.

**Values are never stored, only shape** — the same rule that keeps `useState`'s
hook shape and refuses its value. A payload carries customer data, a stored
payload is a data-retention decision this project must not make on an adopter's
behalf, and a value that moves between two readings of an unchanged system is a
band that manufactures work.

**Acceptance:** four fixture pairs, each a two-revision run.

- One shared type loses one field. The report names one root, states `contract`,
  lists the operations reached, and points at the declaration — and states the
  count of reached operations rather than repeating the finding per operation.
- The same enum gains the same member in two schemas — one reached only through a
  request, one reached only through a response. The two revisions differ by one
  identical line in each; the verdicts differ. This is the case a text diff
  cannot have an opinion about, and it is the acceptance test for the whole spec.
- A third enum, reached from both positions, gains the same member again: one
  finding, banded `contract`, naming both positions. The exclusive fixtures above
  are the didactic case; this is the one real schemas produce.
- A JSON response body captured from the wire, with no schema available: a shape
  change is reported, no direction is claimed, and the band is not `contract`.

## The untyped case, and what it may conclude

Any value can be a subject — a config file, a generated manifest, a fixture, a
recorded response. Without a schema there is no request or response position, so
there is no direction, so **compatibility cannot be decided**. What remains is
real and smaller: a canonical form, a digest, a structural delta naming the paths
that appeared, vanished or changed type, and roots that group by path prefix.

An untyped subject may never be **inferred** into `authorized`: no compatibility
rule may promote it, and the ceiling policy alone can reach is `needs-review`.
Inferring one — *a key was added, additions are safe* — is precisely the guess
that lets a required field appear in a request body and pass. A *declared* intent
is a different producer and stays legitimate: an agent that says it regenerated
the manifest is answered against what it claimed, exactly as it is for a
component. ADR-0015's test settles it: a stored
snapshot can decide *this path changed type*; it cannot decide *your callers
survive it*.

## Where it lands

The comparison is arithmetic over a parsed document and belongs in `core`, which
carries no third-party dependency and is held to that by
`tools/boundaries.check.ts`. **A dialect reader therefore cannot live there** —
every one of them is a parser somebody else wrote — so each is its own package,
named for the format it serves, which ADR-0042 allows a name to come from.

`packages/graphql` is refused by that same check until somebody writes down which
of the two the name means, because a GraphQL reader depends on npm `graphql` and
the rule exists to stop a package being named after a library it imports. It is
the `playwright` situation exactly, and it is named here so the first implementer
meets it in this file rather than in a red check.

## What it is not

- **Not contract testing.** Nothing is executed against a provider, no
  consumer's expectations are recorded, and no mock is generated. This compares
  two descriptions; Pact-style tools compare a description to a running system.
- **Not a linter.** Style, naming and completeness rules belong to the tools that
  already do them well; every rule here needs two revisions.
- **Not runtime validation.** A response that violates its own schema is a defect
  in the service, found by asserting against the schema, and it is invisible to a
  comparison between two schemas.
- **Not a client-impact claim.** The system knows which of *this repository's*
  callers a change reaches. It knows nothing about the mobile app shipped six
  months ago, and an added response enum member is reported at its band rather
  than adjudicated against clients nobody enumerated.
