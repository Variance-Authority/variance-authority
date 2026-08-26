<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/scenario

**Requires:** semantic snapshots produced by the host. The optional archive also
requires a writable directory.

Use this package when a host can arrange a named UI state, perform meaningful
acts, and attempt a semantic snapshot after each one. A scenario is AAA as a
state machine: Arrange is the initial state observation, each Act labels a
transition, and assessment compares the variance across those transitions.

The host remains responsible for producing `page-loading`, `page-error`,
`page-one-article`, or any other precondition. Pass the resolved parent link from
the existing planned-subject naming machinery; this package records that evidence
and never tries to infer fixtures, mocks, cookies, routes, or flags.

## Record and assess two paths

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

`arrange` compares the initial observations. Each transition then carries the
left effect, the right effect, and whether those two effect digests agree. A
shared token edit can move every absolute state while leaving the effect digest
stable; changing the handler moves the digest at that Act.

Acts align by `(key, occurrence)` along their common ordered prefix. An inserted,
missing, or repeated Act is reported in `unmatched` with its side; later ordinals are not
shifted into a plausible pair. A failed observation is created with
`unobserved(...)`, terminates the reachable prefix, and makes
`firstDivergence` unresolved rather than clean.

`startScenario` takes:

| option | required state | what it decides |
| --- | --- | --- |
| `id` | required, non-empty | the execution identity within its run |
| `precondition` | required | the existing `SubjectRef` in the role of Arrange |
| `profile` | required | the observation profile every frame must match |
| `preconditionLink` | absent | the resolved parent and its declared or named evidence; omission means no link was supplied |

## Fold executions into the machine

`foldScenarios` groups frames by render hash and adds witnessed transitions under
their Act keys. Paths reaching one hash converge on one node. If one state and
Act reach two destination hashes, both transitions remain and the machine reports
the divergence. An unobserved Act appears under `unknown`; an edge no execution
witnessed does not exist in the value and is never called impossible.

The fold is partial evidence, not replay. Scenario records contain no selectors,
callbacks, timing, request bodies, credentials, or typed event values.

## Retain semantic evidence explicitly

The root entrypoint is ephemeral and performs no I/O. Import
`createScenarioArchive` from `@variance-authority/scenario/archive` only when the
semantic evidence must survive the process.

The archive requires an address covering project, run, scenario, execution,
precondition, profile, and attempt. Its policy declares expiry, access, deletion,
and an admission function for every semantic snapshot. Equal snapshots are
stored once by content digest. Expired or missing evidence reads as
`unobserved`; garbage collection removes expired manifests and semantic objects
no retained manifest references.

Only canonical `SemanticSnapshot` text and a versioned manifest enter the
archive. There is no raster, resource-closed document, baseline promotion,
history row, approval, changelog, or exit-code API. Semantic snapshots can still
contain document text, accessible names, attributes, URLs, and source evidence,
so an admission policy that cannot retain those values must refuse the snapshot
instead of redacting it after hashing.

`createScenarioArchive` takes `root`, the writable archive directory, and an
optional `now` clock for deterministic expiry decisions. The system clock is the
default. Neither option enables archival by itself; only calling `put` writes.

See [Runtime scenarios](../../docs/scenarios.md) for the state-machine model,
the three assessment pairs, and what the graph refuses to synthesize.
