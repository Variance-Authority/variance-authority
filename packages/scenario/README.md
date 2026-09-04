<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/scenario

> Record runtime scenarios as AAA state machines and assess variance across witnessed transitions.

Use this package when a host can arrange a named UI state, perform meaningful
acts, and attempt a semantic snapshot after each one. A scenario is AAA
(Arrange-Act-Assert) as a state machine: Arrange is the initial state
observation, each Act labels a transition, and assessment compares the
variance across those transitions.

The host remains responsible for producing `page-loading`, `page-error`,
`page-one-article`, or any other precondition. If the host already resolved
this precondition's parent subject, pass that parent's id and whether it was
declared or named as `preconditionLink`; this package only records that
evidence and never tries to infer fixtures, mocks, cookies, routes, or flags.

The snapshots come from the host as well. A `SemanticSnapshot` is the normalized
capture of a rendered subject that `@variance-authority/core` produces from a
collector's raw capture; nothing here produces one. The optional archive writes
to a directory you give it.

```bash
npm install --save-dev @variance-authority/scenario
```

## Record and assess two paths

Each `SemanticSnapshot` below is a `declare const` stand-in: a real one comes
from a collector capturing a rendered subject and `@variance-authority/core`
normalizing it, not from this package.

```ts
import type { SemanticSnapshot } from '@variance-authority/core';
import {
  assessScenarios,
  defineScenario,
  recordAct,
  startScenario,
} from '@variance-authority/scenario';

declare const oneArticleBefore: SemanticSnapshot;
declare const oneArticleAfter: SemanticSnapshot;
declare const twoArticlesBefore: SemanticSnapshot;
declare const twoArticlesAfter: SemanticSnapshot;

const definition = defineScenario('delete-an-article', [{ key: 'delete-first' }]);

const oneArticle = recordAct(
  startScenario(
    definition,
    {
      id: 'run-1/one-article',
      precondition: oneArticleBefore.subject,
      profile: oneArticleBefore.profile.id,
    },
    oneArticleBefore,
  ),
  'delete-first',
  oneArticleAfter,
);

const twoArticles = recordAct(
  startScenario(
    definition,
    {
      id: 'run-1/two-articles',
      precondition: twoArticlesBefore.subject,
      profile: twoArticlesBefore.profile.id,
    },
    twoArticlesBefore,
  ),
  'delete-first',
  twoArticlesAfter,
);

const assessment = assessScenarios(oneArticle, twoArticles);
console.log(assessment.arrange, assessment.firstDivergence);
```

Each `startScenario` or `recordAct` call above appends one frame to the
execution — Arrange's own outcome, or one Act's — pairing that frame's render
hash (the exact content digest of what rendered) with its semantic snapshot.

`arrange` compares the initial observations. Each transition then carries the
left effect, the right effect, and whether the two agree. An **effect digest**
is the digest of the classified semantic variance between an Act's before and
after snapshot — not the frame's own render hash.

That distinction is the point. A shared token edit changes every frame's render
hash, which is its exact, absolute state, yet leaves the effect digest stable:
the edit is already present in an Act's before and after frame alike. Changing
the handler does move the digest at that Act, because that is exactly the
comparison the delta is taken from.

Acts align by `(key, occurrence)` along their common ordered prefix. An inserted,
missing, or repeated Act is reported in `unmatched` with its side; later ordinals are not
shifted into a plausible pair. A failed observation is created with
`unobserved(...)`, terminates the reachable prefix, and makes
`firstDivergence` unresolved rather than clean.

`startScenario` takes:

| option | required state | what it decides |
| --- | --- | --- |
| `id` | required, non-empty | the execution identity within its run |
| `precondition` | required | a `SubjectRef` — the host's stable subject id and kind — in the role of Arrange |
| `profile` | required | the observation profile every frame must match |
| `preconditionLink` | absent | the resolved parent and its declared or named evidence; omission means no link was supplied |

## Fold executions into the machine

`foldScenarios` groups frames by render hash and adds witnessed transitions under
their Act keys. Paths reaching one hash converge on one node. If one state and
Act reach two destination hashes, both transitions remain and the machine reports
the divergence. An unobserved Act appears under `unknown`; an edge no execution
witnessed does not exist in the value and is never called impossible.

This does not replay anything: folding only turns already-recorded frames into
a graph of witnessed states and edges.

## Retain semantic evidence explicitly

The root entrypoint is ephemeral and performs no I/O. Import
`createScenarioArchive` from `@variance-authority/scenario/archive` only when the
semantic evidence must survive the process.

The archive requires an address covering project, run, scenario, execution,
precondition, profile, and attempt — a caller-assigned label, such as a retry
count, that the archive never derives from the run itself. Its policy declares
expiry, access, deletion, and an admission function — a check that can refuse
to retain a given snapshot — for every semantic snapshot. Equal snapshots are
stored once by content digest. Expired or missing evidence reads as
`unobserved`; garbage collection removes expired manifests and semantic objects
no retained manifest references.

Only canonical `SemanticSnapshot` text and a versioned manifest enter the
archive — this does not store screenshots or make pass/fail decisions. Semantic
snapshots can still contain document text, accessible names, attributes, URLs,
and source evidence, so an admission policy that cannot retain those values
must refuse the snapshot instead of redacting it after hashing.

`createScenarioArchive` takes `root`, the writable archive directory, and an
optional `now` clock for deterministic expiry decisions. The system clock is the
default. Neither option enables archival by itself; only calling `put` writes.
