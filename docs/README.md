# Documentation

Variance Authority connects a changed region to the component that caused it and
the `file:line` where that component lives, in infrastructure you control. These
pages are the reference behind that. Each one answers a question rather than
covering a feature; start from the question you actually have.

The [root README](../README.md) is the shortest path into a suite. The
[package READMEs](../packages) are the API surface.

## The words these pages use

A handful of nouns carry the whole model, and every page below assumes them.

| Word | What it means |
| --- | --- |
| **subject** | One UI state a run addresses — a story, a route, a fixture, or a value — identified by an id that survives a rename. |
| **band** | Which kind of difference a delta is: `a11y`, `geometry`, `token`, `content`, `texture`, loudest first. The band decides how loudly it is reported. |
| **digest** | One hashed dimension of a component instance — `structure`, `semantics`, `text`, `style`, `geometry`, `wiring`. Two equal digests are a match, never a resemblance. |
| **root** | The cause a change is attributed to, such as `component:Button` or `token:--va-color-accent`. Stable across subjects and builds, which is what lets an approval keep applying. |
| **cluster** | Regions that share a semantic fingerprint — the kind of root, the shapes of the deltas, and the component responsible — so one decision covers all of them and reaches nothing else. |
| **docket** | What a run leaves for a decision: the roots nobody declared, ranked by cause rather than by area. |
| **verdict** | The one word a subject ends in — `unchanged`, `inherited`, `authorized`, `needs-review`, `violation`, or `unexplained`. A band a profile could not observe reports `unobserved`, which is not a verdict and never collapses into one. |

## Deciding whether it fits

| Page | Reader question |
| --- | --- |
| [`surface.md`](surface.md) | What are the independent choices a suite composes to connect? |
| [`flows.md`](flows.md) | How much does an operator have to stand up, and can I stop at the first rung? |
| [`cases.md`](cases.md) | Who owns the state, what material do I keep, and where do pixels get made? |
| [`replacing.md`](replacing.md) | I already have a screenshot suite. What does each replacement trade? |
| [`gates.md`](gates.md) | Can this replace what I am paying for? |
| [`comparison.md`](comparison.md) | What do Percy, Chromatic, Argos, and Applitools each do better? |

## What a run decides

| Page | Reader question |
| --- | --- |
| [`attribution.md`](attribution.md) | How does a changed pixel become a component and a line of source? |
| [`ignores.md`](ignores.md) | Part of this page is not my subject. How do I say so without losing the rest? |
| [`variations.md`](variations.md) | A flag's second arm, a dark scheme, a narrow viewport — how are those addressed? |
| [`composition.md`](composition.md) | Many subjects, one revision: what do they say about each other? |
| [`changelog.md`](changelog.md) | A baseline is a PNG. Where does the reason it was approved live? |
| [`placement.md`](placement.md) | Where do baselines live, and what makes two of them comparable? |
| [`history.md`](history.md) | Eleven approved 2px changes are twenty-two. What sees that? |

## Telling a flake from a change

| Page | Reader question |
| --- | --- |
| [`stabilization.md`](stabilization.md) | What is already held still before my subject is read? |
| [`flakiness.md`](flakiness.md) | Which causes of variance get absorbed, and what does each one cost me? |
| [`framework.md`](framework.md) | The artefact is a render in the past tense. What does the framework know that it cannot? |
| [`parting.md`](parting.md) | Two readings differ. Which input moved, and is this a variation, a flake, or a refactor? |

## Running less of the suite

| Page | Reader question |
| --- | --- |
| [`source.md`](source.md) | What could this change have reached, known before anything renders? |
| [`selecting.md`](selecting.md) | One component moved. Why am I paying for 300 collections? |
| [`source-index.md`](source-index.md) | What does the source scan persist, and what makes a generation reusable? |

## Evidence that needs no baseline

| Page | Reader question |
| --- | --- |
| [`presentation.md`](presentation.md) | How is information grouped, separated, aligned, and emphasized in this one interface? |
| [`scenarios.md`](scenarios.md) | Arrange, Act, Assert as a state machine: at which Act did two runs stop agreeing? |

## How it is built, and what it claims

| Page | Reader question |
| --- | --- |
| [`architecture.md`](architecture.md) | Why is this a set of tools rather than a pipeline, and how are the packages cut? |
| [`information.md`](information.md) | What is retained, where does it cross a boundary, and what may be merged or deleted? |
| [`instruments.md`](instruments.md) | Which instrument answers which question, and where is each claim measured? |
| [`metrics.md`](metrics.md) | What is the evidence, and what is its denominator? |
| [`visual-guidelines.md`](visual-guidelines.md) | What is the mark, the palette, and the illustration grammar? |
