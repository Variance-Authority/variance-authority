<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/scenario

> Record runtime scenarios as AAA state machines and assess variance across witnessed transitions.

Part of [Variance Authority](https://variance-authority.dev), a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source.

## What this is for

A snapshot test tells you that one UI state looks the way it did. It cannot tell
you that clicking Delete does the same thing on a page with one article as on a
page with two.

This package records that: a named starting state, a fixed sequence of acts, and
what the UI looked like after each one — then compares two such recordings and
names the first act where they stopped agreeing. Arrange–Act–Assert, kept as
data rather than as control flow.

It records and compares. It drives nothing: it opens no browser, fires no click,
and renders nothing. Your test harness performs the acts and hands this package
the observations. It writes no baseline, no verdict, and no exit code.

Two terms this project uses throughout:

- A **subject** is one named UI state you asked for and can ask for again —
  `page-one-article`, `page-error`. Here a subject is the *precondition* a
  recording starts from, and arranging it is your harness's job.
- An **observation profile** is what the capture surface was able to see at all,
  independent of what it found: `jsdom` resolves roles, accessible names and
  author-declared style but has no layout engine, while `chromium` adds the
  resolved cascade, real geometry and pixels. Every frame in one recording must
  share one profile, so a dimension is never reported `unchanged` because
  neither side could see it.

## Requirements

Node 22 or newer, and an ESM project — this package ships ESM only and has no
CommonJS build. It has no framework, runner or browser peer: it never touches
the DOM.

Its one dependency is `@variance-authority/core`, which supplies the
`SemanticSnapshot` type and the comparison. The example below imports from it
directly, so install both.

## Record two paths and compare them

```bash
npm install --save-dev @variance-authority/scenario @variance-authority/core
```

The file below is complete — save it as `scenario-demo.ts` and run it. The
`snapshot` helper stands in for your collector: in a real suite each
`SemanticSnapshot` is a normalized capture of a rendered subject that a collector
takes and `@variance-authority/core` normalizes. This package never produces one.

```ts
// scenario-demo.ts
import {
  CHROMIUM_PROFILE,
  digestValue,
  environmentKey,
  type SemanticSnapshot,
} from '@variance-authority/core/format';
import {
  assessScenarios,
  defineScenario,
  recordAct,
  startScenario,
} from '@variance-authority/scenario';

const environment = environmentKey({
  profile: CHROMIUM_PROFILE.id,
  engine: 'chromium@1',
  ruleset: 'rules@1',
  allowlist: 'allowlist@1',
  viewport: { width: 800, height: 600, deviceScaleFactor: 1, colorScheme: 'light' },
  fonts: [],
  conditions: {},
  assets: {},
});

// Stands in for a collector capture. Yours arrives already shaped like this.
function snapshot(subjectId: string, text: string): SemanticSnapshot {
  return {
    formatVersion: 1,
    subject: { id: subjectId, kind: 'fixture' },
    profile: CHROMIUM_PROFILE,
    environment,
    renderHash: digestValue({ subjectId, text }),
    structureHash: digestValue({ tag: 'button', text }),
    styleHash: digestValue({ color: 'black' }),
    root: {
      path: '0',
      tag: 'button',
      attributes: {},
      style: { color: 'black' },
      rect: { x: 0, y: 0, width: 100, height: 40 },
      text,
      children: [],
    },
    styleProvenance: [],
    diagnostics: [],
  };
}

const definition = defineScenario('delete-an-article', [{ key: 'delete-first' }]);

function record(
  executionId: string,
  before: SemanticSnapshot,
  after: SemanticSnapshot,
) {
  return recordAct(
    startScenario(
      definition,
      { id: executionId, precondition: before.subject, profile: before.profile.id },
      before,
    ),
    'delete-first',
    after,
  );
}

const oneArticle = record(
  'run-1/one-article',
  snapshot('page-one-article', 'Article A'),
  snapshot('page-one-article', 'No articles'),
);

const twoArticles = record(
  'run-1/two-articles',
  snapshot('page-two-articles', 'Article A, Article B'),
  snapshot('page-two-articles', 'Article B'),
);

console.log(JSON.stringify(assessScenarios(oneArticle, twoArticles), null, 2));
```

### What you get

The printed assessment, abridged — both recordings performed `delete-first`, and
its effect was not the same on the two preconditions:

```json
{
  "arrange": {
    "kind": "measured",
    "variance": {
      "digest": "v1:0b1f7fa959977b2c06b80e4a959d8811",
      "identical": false,
      "bands": ["content"],
      "components": [],
      "unobserved": [],
      "blindSides": [],
      "parting": {
        "slice": "unread",
        "lines": [
          "unread — the page changed and what would explain it was not read",
          "  no framework boundary was read, so nothing can be said about why"
        ]
      }
    }
  },
  "transitions": [
    {
      "act": { "key": "delete-first", "occurrence": 1 },
      "leftEffect": {
        "kind": "measured",
        "variance": { "digest": "v1:ae736247f8a3912d2f858781cd76f576", "bands": ["content"] }
      },
      "rightEffect": {
        "kind": "measured",
        "variance": { "digest": "v1:1d653ffac6b79a4f6c6cdd108fd8708a", "bands": ["content"] }
      },
      "divergence": {
        "kind": "measured",
        "identical": false,
        "left": "v1:ae736247f8a3912d2f858781cd76f576",
        "right": "v1:1d653ffac6b79a4f6c6cdd108fd8708a"
      }
    }
  ],
  "firstDivergence": { "kind": "found", "act": { "key": "delete-first", "occurrence": 1 } },
  "unmatched": []
}
```

Reading it:

- `arrange` compares the two starting observations. The two pages genuinely
  differ, so it is `identical: false`.
- Each entry in `transitions` carries the left recording's effect, the right
  one's, and whether they agree. `firstDivergence` names the earliest act where
  they did not.
- `bands` names the dimension that moved, from `a11y`, `geometry`, `token`,
  `content`, `texture`. `blindSides` lists bands the profile on a side could not
  decide at all, so a blind side is never reported as agreement.
- `parting` says which input separated the two readings — a component's own
  retained state, something it received, or neither — and `slice: "unread"` means
  no framework boundary was read, so it declines to name one rather than
  guessing. `lines` is that reading as sentences.

An **effect digest** is the digest of the classified variance between an act's
before and after snapshot, not the frame's own **render hash** — the exact
content digest of what rendered. The two answer different questions. Editing a
shared token changes every frame's render hash, yet leaves the effect digest
stable, because the edit is present in an act's before and after frame alike.
Changing the delete handler does move the effect digest at that act, because
that is the comparison the delta is taken from.

Acts align by `(key, occurrence)` along their common ordered prefix. An inserted,
missing or repeated act is reported in `unmatched` with its side; later ordinals
are not shifted into a plausible pair. A failed observation is recorded with
`unobserved(diagnostic)`; it ends the reachable prefix and leaves
`firstDivergence` as `unresolved` rather than `none`.

`startScenario` takes:

| option | required | what it decides |
| --- | --- | --- |
| `id` | yes, non-empty | the recording's identity within its run |
| `precondition` | yes | a `SubjectRef` — the subject id and kind your harness arranged — in the role of Arrange |
| `profile` | yes | the observation profile every frame must match |
| `preconditionLink` | no | the already-resolved parent subject and whether it was `declared` or `named`; omitted means no link was supplied |

`preconditionLink` is carried, not computed. If your harness already resolved
that `page-error` derives from `page`, pass that result through; this package
records it and infers nothing about fixtures, mocks, cookies, routes or flags.

## Fold recordings into a state machine

`foldScenarios(runs)` groups frames by render hash and adds the transitions those
recordings witnessed under their act keys. Paths that reach one hash converge on
one node. If one state and act reach two destination hashes, both transitions
survive and the result reports the divergence. An act that was never observed
appears under `unknown`. Continuing `scenario-demo.ts`:

```ts
import { foldScenarios } from '@variance-authority/scenario';

const machine = foldScenarios([oneArticle, twoArticles]);
console.log(machine.nodes.length, machine.transitions.length, machine.divergences);
```

The value holds `nodes`, `transitions`, `unknown` and `divergences`. An edge no
recording witnessed is simply absent from it. Folding replays nothing — it turns
frames you already recorded into a graph.

## Retain semantic evidence explicitly

The root entrypoint holds everything in memory and performs no I/O, so dropping
the value drops the recording. Import `createScenarioArchive` from
`@variance-authority/scenario/archive` when the evidence has to survive the
process. Continuing `scenario-demo.ts` again:

```ts
import { createScenarioArchive } from '@variance-authority/scenario/archive';

const archive = createScenarioArchive({ root: '.variance/scenarios' });

await archive.put(
  {
    project: 'storefront',
    run: 'run-1',
    scenario: 'delete-an-article',
    execution: 'run-1/one-article',
    precondition: 'page-one-article',
    profile: 'chromium',
    attempt: '1',
  },
  oneArticle,
  {
    retainUntil: '2030-01-01T00:00:00.000Z',
    access: 'the storefront team',
    deletion: 'removed by collectExpired after retainUntil',
    admit: () => ({ kind: 'admitted' }),
  },
);
```

The address covers project, run, scenario, execution, precondition, profile and
attempt. `attempt` is a label you assign, such as a retry count; the archive
never derives it. The policy declares expiry, access and deletion, plus `admit`,
which can refuse a given snapshot. Equal snapshots are stored once by content
digest. `read` returns `unobserved` for expired or missing evidence, and
`collectExpired` removes expired manifests and any semantic objects no retained
manifest references.

Only canonical `SemanticSnapshot` text and a versioned manifest go into the
archive; no screenshots. That text can still contain document text, accessible
names, attributes, URLs and source evidence — so if a value must not be retained,
`admit` has to refuse the snapshot, because nothing redacts it after hashing.

`createScenarioArchive` takes `root`, the writable directory the archive lives
in, and an optional `now` clock for deterministic expiry decisions; the system
clock is the default. Neither option writes anything by itself — only `put`
does.

---

**[@variance-authority/scenario](https://variance-authority.dev/reference/packages/scenario)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
