<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/session

> Run many Variance Authority subjects in one standing DOM world, and detect cross-pollution rather than prevent it.

Part of [Variance Authority](https://variance-authority.dev).

## What this is for

A **subject** is one named UI state you asked for and can ask for again — a
story, a component instance, a page. Most runners give each subject a clean
world: a fresh jsdom per test file, a browser per story, a Storybook reload
between stories, the design system's stylesheet parsed again every time. That
setup is usually the largest cost in the run.

A session pays it once. One document, one container, every subject in turn, and
nothing torn down in between. What that buys back is real and so is what it
risks: one subject can leave state another one reads — a stylesheet, a class on
`<html>`, a stray body child. This package calls that **cross-pollution**, and
instead of preventing it, it **brackets** each subject's mount with a cheap
snapshot of shared state and tells you which subject polluted which, through
what key, and what to change.

You get a **finding** for each: a fixed record naming the victim, the culprit,
the shared key, the evidence and the fix — printable as text an agent can act on
without re-deriving the diagnosis.

## Requirements

Node 22 or newer. The package is ESM only, and it needs a live DOM: a `Document`
you supply, from jsdom, happy-dom, a browser tab, or a Playwright page's realm.
It knows about React only through the mount function you pass, so a session runs
whatever you can put on a page.

```bash
npm install --save-dev @variance-authority/session jsdom
```

`@variance-authority/core` and `@variance-authority/dom` are installed with it.
Install [`@variance-authority/react`](https://variance-authority.dev/reference/packages/react)
as well if you want findings to name the component that wrote a node rather than
the node.

## Run a session

This file runs as printed under `node run-session.mjs`. It builds a jsdom, runs
two stories, and lets the second one leak into the first.

```js
// run-session.mjs
import { JSDOM } from 'jsdom';
import { createSession } from '@variance-authority/session';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
const { document } = dom.window;

const session = createSession({
  document,
  viewport: { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' },
  engine: 'jsdom@30',
});

const card = (container) => {
  container.innerHTML = '<div class="card"><p class="card-body">Hello</p></div>';
};

// The leak: a rule scoped to nothing, matching a component this story does not own.
const toolbar = (container) => {
  const style = document.createElement('style');
  style.textContent = '.card { padding: 99px }';
  document.head.appendChild(style);
  container.innerHTML = '<button class="btn">Save</button>';
};

session.run({ id: 'story:card', kind: 'story' }, card);
session.run({ id: 'story:toolbar', kind: 'story' }, toolbar);

// Re-run `story:card` and compare its hash against its first run.
const confirmed = session.verify(
  (subject, container) => (subject.id === 'story:card' ? card(container) : toolbar(container)),
  ['story:card'],
);

console.log(session.report(confirmed));
console.log(session.report());
session.dispose();
```

### What you get

```
[confirmed] story:card
  cause:    story:toolbar
  via:      sheet:<style:0>
  evidence: re-running `story:card` in the same session produced a different render hash
            (v1:3297a6c6 → v1:974a8f81) with no code change; `story:toolbar` wrote
            `sheet:<style:0>`, which this subject matched `.card`
  fix:      make `story:toolbar` clean up `sheet:<style:0>`, or scope it so it cannot
            reach `story:card`

[suspected] story:card
  cause:    story:toolbar
  via:      sheet:<style:0>
  evidence: `story:toolbar` wrote `sheet:<style:0>`; `story:card` matched `.card`
  fix:      confirm with `verify()`. If the hash moves, scope `sheet:<style:0>` to
            `story:toolbar` or clean it up; if it does not, the coupling is real but
            currently harmless
```

A **render hash** is the content hash of the subject's normalized tree — its
structure and its resolved styles, under the session's identity. It is not a
pixel hash and not a hash of raw markup: ids have become structural aliases and
class attributes are gone by the time it is taken, so a hash that changed means
the rendering changed.

`sheet:<style:0>` is a shared-state key. `<style:N>` is this session's own
counter over stylesheets that have no `href`, numbered in the order the probe
first saw them; a linked sheet uses its `href` as the id instead. Identity is
tracked per owner node, so inserting a sheet does not renumber the ones after
it.

## Use this package when

Install `@variance-authority/session` when one live DOM can host many subjects
and you can provide the mount function. It is a library runner, not an automatic
Playwright, Vitest, or Jest integration: those runners call `createSession` and
`session.run` themselves. Use `@variance-authority/dom` when you only need one
capture, or `@variance-authority/react` to give the mount callback React
provenance and a way to wait for React to settle. Skip this package when
subjects already run in separate processes or fresh documents — there is no
shared world for pollution to cross, and the probe only adds cost.

## Cost

Nothing is torn down between subjects: no fresh jsdom per file, no browser per
story, no Storybook reload, no re-parsing the design system's stylesheet. Choose
a session when that repeated setup dominates the cost of the shared-state probe.

The probe reads no computed styles and measures no layout. `session.stats()`
reports `probeShare` — probe time as a fraction of session time — for your own
suite; the package's own cost measurement gates that share below 15% and fails
if a change pushes it past.

## What the probe watches

A `via:` key can only name state the document can read about itself. The whole
list:

| key | what it fingerprints |
|---|---|
| `sheet:<id>` | every sheet in `document.styleSheets`, by its `<style>` element's text, or by serialized rule text when it has no owner node |
| `root-custom:--name` | custom properties set inline on `<html>` |
| `root-attr:name` | `class`, `style`, `dir`, `lang`, `data-theme`, `data-mode` on `<html>` |
| `body-attr:name` | the same six on `<body>` |
| `body-residue` | how many children `<body>` has that no subject container owns — an unmounted portal, a toast that never dismissed, a modal backdrop |
| `title` | `document.title` |

Removing a key counts as a write, and a rule rewritten in place counts too: the
fingerprint is over rule text, not rule count, which is what a CSS-in-JS runtime
changes when a theme flips. A cross-origin sheet throws on access and
fingerprints as `unreadable`, so two of them compare equal and a change inside
one is invisible.

Everything outside that list is outside the probe. A singleton store, a cached
client, a memoized selector, a mocked clock are module-level state, not document
state, and a session cannot attribute a leak through them — see "Limits".

## Reading a finding

`session.findings()` returns objects, not text. `session.report(findings?)`
renders them as the block above, confirmed first, defaulting to `findings()`.

| property | type | what it names |
|---|---|---|
| `confidence` | `'suspected' \| 'confirmed'` | overlap alone, or a hash that actually changed |
| `victim` | `string` | the affected subject's id |
| `culprit` | `string \| undefined` | the subject that wrote the shared state; absent when a hash changed and no earlier writer explains it |
| `key` | `string` | the shared-state key both subjects touched |
| `evidence` | `string` | how the tool knows |
| `remedy` | `string` | what to change |
| `culpritComponents` | `readonly string[]` | components the culprit rendered, empty unless `provenanceOf` is configured |

`findings()` is suspicion from read/write overlap, and it is directional: only a
subject that ran *earlier* can have reached a given subject, which is why the
sample's `findings()` says nothing until `verify()` has re-run `story:card`
after the leak. A subject that writes a key it also reads is not reported — that
is a component managing its own stylesheet. One finding per victim/culprit/key,
however many rules matched.

Every write a later subject reads is reported. To act on one, `session.rinse([key])`
removes the leaked stylesheet without rebuilding the document; only sheet
removal is reversible from a probe, since restoring an attribute would mean
retaining every prior value and growing the probe with the session.

## The session surface

```ts
const run = session.run(subject, mount);
```

`run` takes a subject — `{ id, kind }`, where `kind` is `'story' | 'route' |
'fixture' | 'value'` and `title` is an optional third field — and a mount
callback that receives the container. It returns a `SubjectRun`:

| field | what it holds |
|---|---|
| `subject` | the ref you passed |
| `capture` | the raw capture, before any rule is applied |
| `snapshot` | the normalized snapshot, whose `renderHash` is this subject's identity |
| `reads` | shared-state keys this subject's render depended on |
| `writes` | shared-state keys it changed |
| `sequence` | position in the session — what makes a conflict directional |
| `durationMs` | wall clock from clearing the container to the recorded run |

An id is a free string. Nothing parses it, and `story:card` is a convention, not
a format: the ids that reach a finding are the ids you pass, so make them stable
across renames — `story:components-button--primary` rather than a file path.

`session.container` is the element subjects mount into, stable for the session's
lifetime. `session.runs()` returns every `SubjectRun` in order.
`session.dispose()` removes the container from `<body>` and nothing else: the
document, its stylesheets and the ledger survive, so `findings()` and `report()`
still answer afterwards. Skip it and the container stays under `<body>`, where
the next session's probe counts it as residue.

### `verify`

```ts
verify(
  replay: (subject: SubjectRef, container: HTMLElement) => void,
  sample?: readonly string[],
): readonly Finding[];

verify(
  replay: (subject: SubjectRef, container: HTMLElement) => PromiseLike<unknown>,
  sample?: readonly string[],
): Promise<readonly Finding[]>;
```

`replay` is the renderer handed back: confirming a suspicion means rendering the
subject again, so `verify` gives you the subject ref and the container and you
mount it the same way `run` did. It is the second argument to `run` with the ref
added, which is what the sample's one-line dispatch is doing.

`sample` is the subject ids to re-run. Omit it and every subject the session saw
is replayed — which doubles the session, so pass a sample when you already know
which subjects are worth the second pass.

### `createSession` options

| option | default | what it decides |
|---|---|---|
| `document` | required | the live DOM the container is appended to |
| `viewport` | required | width, height, scale, colour scheme — media conditions are resolved against it |
| `engine` | required | what read the DOM, e.g. `jsdom@30` |
| `fonts` | none | the font stack this session is asserted to have |
| `provenanceOf` | none | element to `Provenance`, so a finding can name the component that wrote a node rather than the node |
| `portalsOf` | none | root to the elements it rendered outside itself. Without it a portal's content is somebody else's body child, which reads as pollution |
| `clearContainer` | `true` | empty the container between subjects. Set `false` to model a suite that appends without cleaning up; a subject that mounts nothing is then only caught when it runs first, since the previous subject's DOM satisfies the emptiness check |

`engine` and `fonts` land in the session's **identity** — the inputs a baseline
is addressed by — so changing either produces a different baseline rather than a
diff. `engine` is a free string, recorded verbatim; nothing checks it against the
DOM implementation you actually handed in, so derive it rather than typing it,
and a version bump that does not reach the string leaves two different engines
sharing one baseline address.

## Wiring it into a runner

A session outlives individual tests, so it belongs in a suite-level hook. An
excerpt of the Vitest shape — it needs `environment: 'jsdom'` in your Vitest
config to supply the global `document`, and the file listed under
`setupFiles`:

```ts
// vitest.setup.session.ts
import { afterAll, beforeAll } from 'vitest';
import { createSession, type Session } from '@variance-authority/session';

export let session: Session;

beforeAll(() => {
  session = createSession({
    document,
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' },
    engine: `jsdom@${process.env.npm_package_devDependencies_jsdom ?? 'unknown'}`,
  });
});

afterAll(() => {
  const report = session.report();
  session.dispose();
  if (session.findings().length > 0) throw new Error(report);
});
```

Each test then calls `session.run(subject, mount)` and asserts on the
`SubjectRun` it gets back. Under Playwright the same arrangement lives in a
worker-scoped fixture, with `document` coming from the page's realm.

## Sharp edges

**The container is the same element every run.** React notices: calling
`createRoot` on it twice warns and leaks the previous root. Create one root per
session against `session.container` and `root.render` per subject.

**A subject that renders nothing is refused, not snapshotted.** An empty
container compares equal to every other empty container, so it would report
`unchanged` forever while showing nothing. `run` throws instead — synchronously
when the mount is synchronous, as a rejection when it returned a promise. Text
counts as rendering; comments and whitespace do not. A subject whose entire
output is portalled is rescued only when `portalsOf` is configured.

**Two subjects cannot mount at once.** A session has one container, so
overlapping asynchronous mounts would photograph each other's DOM. Starting a
run while a previous mount has not settled throws synchronously, from both
overloads. Await the previous run first.

**A subject declares when it is finished by returning a promise.** `run` awaits
it before collecting, and returns a `Promise<SubjectRun>` rather than a
`SubjectRun`. A mount that returns nothing keeps the whole path synchronous. A
subject that never settles hangs the session rather than producing a wrong
answer.

## The low-level probe

`probe`, `diffProbes` and `SheetRegistry` are the bracket itself, exported for a
**collector** — the part of a run that opens each subject and hands back a
capture, whether that is the Storybook collector, the route collector, or one
you wrote — that already owns its own bracket and does not want a session's
container.

```js
import { JSDOM } from 'jsdom';
import { probe, diffProbes, SheetRegistry } from '@variance-authority/session';

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="mine"></div></body></html>');
const { document } = dom.window;

// One registry for the whole run: stylesheet identity has to survive both readings.
const registry = new SheetRegistry();
// Your own containers. Their contents are the subject, not residue — without
// this every subject appears to pollute the body with its own output.
const ownedContainers = [document.getElementById('mine')];

const before = probe(document, { registry, ownedContainers });

const style = document.createElement('style');
style.textContent = '.card { padding: 99px }';
document.head.appendChild(style);
document.documentElement.classList.add('dark');

const after = probe(document, { registry, ownedContainers });

console.log([...diffProbes(before, after).written]);
// [ 'sheet:<style:0>', 'root-attr:class' ]
```

`probe` takes two things. `registry` is the `SheetRegistry` whose identities
have to survive both readings, since a stylesheet has no id of its own.
`ownedContainers` names the elements whose contents are the subject rather than
residue; leave it empty and every subject appears to pollute the body with its
own output.

`written` is shared state that changed between the two readings; `removed` is
the subset that existed before and no longer does.

## Limits

**Detection generalises; attribution does not.** Detection is noticing that a
subject's output is unstable; attribution is naming which other subject caused
it. Module-level state is outside the DOM and so outside the probe, and there is
no stack to fall back on: the write happened during an earlier subject's render,
in a frame that returned before this subject was ever compared. Confirmation
still catches the symptom — the same subject producing a different hash with no
code change — and attribution reports no culprit rather than inventing one.

**Confirmation varies time and holds the world fixed.** Re-running a subject in
the same session proves that the subject is unstable. But a leak that happens
*every* time renders the same wrong way in both passes, so the hash never
changes, and a leak the probe never saw is reported as nothing at all.

Both limits at once give you a subject that is stably wrong: its pixels differ
from the baseline, nothing in its own code changed, and no finding explains it.
Catching that means varying the world instead — collecting the subject in a
session nothing else has touched. That is what `npx variance run` — the `run`
command in `@variance-authority/cli` — asks its collector for when a subject's
pixels change.

---

**[@variance-authority/session](https://variance-authority.dev/reference/packages/session)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
