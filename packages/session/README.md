<p align="center"><img src="./mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/session

**Requires:** a live DOM, and a `mount` function you write. It knows about React
only through that function, so a session runs whatever a caller can put on a
page.

Run many subjects in one standing world.

A session owns one reusable container and brackets each subject's mount with a
shared-state probe. The caller supplies the mount function, so the same runner
can host DOM-only subjects or a framework integration without importing that
framework.

## Use this package when

Install `@variance-authority/session` when one live DOM can host many subjects
and the caller can provide the mount function. It is a library runner, not an
automatic Playwright, Vitest, or Jest integration: those runners must call
`createSession` and `session.run` themselves. Use [`@variance-authority/dom`](../dom)
when you only need one capture, or use [`@variance-authority/react`](../react)
to supply React provenance and readiness to the mount callback.

## Cost and trade-off

Nothing is torn down between subjects: no fresh jsdom per file, no browser per
story, no Storybook reload, no re-parsing the design system's stylesheet.
Choose a session when that repeated setup dominates the cost of the lightweight
shared-state probe.

The risk that buys is cross-pollution — one subject leaving state another one
reads. The industry answer is to rinse between subjects, and rinsing is exactly
the cost we just removed.

## How findings are produced

Every subject is bracketed by a cheap shared-state probe, and its reads are
derived from its own capture. Which turns *"these tests are flaky in CI"* into:

```
[confirmed] story:card
  cause:    story:toolbar (rendered by Button, Toolbar)
  via:      sheet:<style:0>
  evidence: re-running `story:card` in the same session produced a different
            render hash with no code change; `story:toolbar` wrote
            `sheet:<style:0>`, which this subject matched via `.card`
  fix:      make `story:toolbar` clean up `sheet:<style:0>`, or scope it so it
            cannot reach `story:card`
```

Isolation is an enemy of cost and detection is not, which is the half that
generalises. Naming the writer is the narrow half: a `via:` line can only ever be
something the document can read about itself — a stylesheet, a root custom
property, an attribute on the root or body, a stray body child, the title. That
set was chosen for cost and it is the right set for the cost; it is also a small
fraction of the ways one subject reaches another.

See [ADR-0009](../../docs/context/adr/0009-sessions-detect-instead-of-rinse.md).

## Smallest working path

```ts
import { createSession } from '@variance-authority/session';

const session = createSession({
  document,
  viewport: { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' },
  engine: 'jsdom@30',
});

const subjects = [
  { id: 'story:button', kind: 'story' as const, text: 'Save' },
  { id: 'story:card', kind: 'story' as const, text: 'Card' },
];

for (const subject of subjects) {
  session.run(subject, (container) => {
    container.textContent = subject.text;
  });
}

const findings = session.findings();
console.log(findings); // [] when neither subject wrote state the other read
session.dispose();
```

The example runs synchronously because its mount callback returns `void`. A
callback that waits for a render may return a promise; `run` then returns a
promise for the same `SubjectRun`. `findings()` reports suspected
cross-pollution. Call `verify(replay, sample?)` when a replay is affordable and
you need confirmation of order dependence.

`createSession` takes:

| option | default | what it decides |
|---|---|---|
| `document` | required | the live DOM the container is appended to |
| `viewport` | required | width, height, scale, colour scheme — media conditions are resolved against it |
| `engine` | required | what read the DOM, e.g. `jsdom@30`, as it lands in the identity |
| `fonts` | none | the font stack this session is asserted to have |
| `provenanceOf` | none | element to `Provenance`, so a finding can name the component that wrote a node rather than the node |
| `portalsOf` | none | root to the elements it rendered outside itself. Without it a portal's content is somebody else's body child, which reads as pollution |
| `clearContainer` | `true` | empty the container between subjects. The one teardown a session still performs, because it is the one that is cheap: emptying is proportional to the last subject, rebuilding a document is proportional to everything. `false` models a suite that appends without cleaning up — a real pattern, and one the detector should describe rather than forbid |

`verify(replay, sample?)` takes an optional second argument: the subject ids to
re-run. Omitted, every subject the session saw is replayed. Pass a sample when
confirmation is the expensive half and you already know which subjects are worth
the second pass.

**`verify` takes the renderer back, and that is not a convenience.** Confirming a
suspicion means rendering the subject again and seeing whether its hash moves,
so a verification without the renderer could report only the original
suspicion, not confirm it.

`probe`, `diffProbes` and `SheetRegistry` are the bracket itself, exported for a
caller running the detector over a world a session did not create. `probe` takes
`registry` — the `SheetRegistry` whose identities have to survive across both
readings, since a stylesheet has no id of its own — and `ownedContainers`, the
elements whose contents are the subject rather than residue. Without the second
one every subject appears to pollute the body with its own output.

The low-level path is for a collector that already owns its bracket: create one
`SheetRegistry`, call `probe(document, { registry, ownedContainers })` before
and after a mount, and pass the two results to `diffProbes`. The returned
`written` keys identify shared state that changed; the session path is the
supported starting point for a new runner.

## Two sharp edges, both deliberate

**The container is the same element every run.** React notices: calling
`createRoot` on it twice warns and leaks the previous root. Create one root per
session and `root.render` per subject.

**A subject that renders nothing is refused, not snapshotted.** An empty
container compares equal to every other empty container, so it would report
`unchanged` forever while showing nothing — the exact failure this project
exists to refuse, arriving through the cheapest possible door.

A subject that is not finished when `mount` returns says so by returning a
promise; `run` awaits it and stays entirely synchronous when it does not, because
the synchronous path is the overwhelming majority and the package exists to be
cheap.

The session does not launch a browser, create a React root, or discover a test
runner. The document, viewport, engine identity, and renderer are caller-owned;
an empty mount throws, and overlapping asynchronous mounts are refused because
the session has one reusable container.

## Honest limits

**Detection generalises; attribution does not.** Module-level state — a singleton
store, a cached client, a memoized selector, a mocked clock — is outside the DOM
and so outside the probe, and there is no stack to fall back on: the write
happened during an earlier subject's render, in a frame that returned before this
subject was ever compared. Confirmation still catches the symptom, the same
subject producing a different hash with no code change, and attribution reports no
culprit rather than inventing one.

**Confirmation varies time and holds the world fixed.** Re-running a subject in
the same session proves it is unstable; a leak that happens *every* time renders
the same wrong way in both passes and never moves the hash, so one the probe
never saw either is reported as nothing at all. That is the two limits composing,
and it is the kind that becomes a false regression rather than a flake. Catching
it means varying the world instead — collecting the subject in one nothing else
has touched, which is what a `variance run` asks its collector for when a
subject's pixels moved
([spec 0012](../../docs/specs/0012-order-dependence-in-a-run.md)).
