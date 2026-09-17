<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/session

> Run many Variance Authority subjects in one standing DOM world, and detect cross-pollution rather than prevent it.

Part of [Variance Authority](https://variance-authority.dev), a visual regression system you run
yourself: it renders a UI state, compares it against the baseline you approved,
and reports what changed in the vocabulary of your source.

A **subject** is one thing to render and compare — a story, a component
instance, a page. A session owns one reusable container and **brackets** each
subject's mount: it takes a cheap snapshot of shared state immediately before
and after the mount, so it can tell what that subject left behind. The caller
supplies the mount function, so the same runner can host DOM-only subjects or a
framework integration without importing that framework — it knows about React
only through that function, and runs whatever a caller can put on a page.

Because nothing is torn down between subjects, one subject can leave state that
another one reads — a stylesheet, a global attribute, a stray DOM node. This
package calls that **cross-pollution** and reports it rather than preventing
it.

```bash
npm install --save-dev @variance-authority/session
```
## Use this package when

Install `@variance-authority/session` when one live DOM can host many subjects
and the caller can provide the mount function. It is a library runner, not an
automatic Playwright, Vitest, or Jest integration: those runners must call
`createSession` and `session.run` themselves. Use `@variance-authority/dom`
when you only need one capture, or use `@variance-authority/react`
to supply React provenance and readiness to the mount callback. Skip this
package when subjects already run in separate processes or fresh documents —
there is no shared world for pollution to cross, and the probe only adds cost.

## Cost and trade-off

Nothing is torn down between subjects: no fresh jsdom per file, no browser per
story, no Storybook reload, no re-parsing the design system's stylesheet.
Choose a session when that repeated setup dominates the cost of the lightweight
shared-state probe.

The trade-off is the cross-pollution risk described above. Most runners avoid
it by rinsing state between subjects; a session skips that step and detects the
leaks instead.

## How findings are produced

Every subject is bracketed by a cheap shared-state probe, and its reads are
derived from its own capture. That turns *"these tests are flaky in CI"* into a
**finding**: a fixed report with five fields.

| field | what it names |
|---|---|
| `[confidence] victim` | the affected subject, and whether the cause is suspected or confirmed |
| `cause:` | the subject that wrote the shared state, and the components that rendered it when those are known |
| `via:` | the shared-state key both subjects touched |
| `evidence:` | how the tool knows |
| `fix:` | what to change |

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

A `via:` line can only ever name something the document can read about itself
— a stylesheet, a root custom property, an attribute on the root or body, a
stray body child, the title. That is a small fraction of the ways one subject
can reach another, so a finding can miss a leak that lands anywhere else (see
"Honest limits" below).

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

Two options in the table below carry their own vocabulary. `engine` (e.g.
`jsdom@30`) is recorded as part of the session's **identity** — the inputs a
baseline is addressed by, so a different engine produces a different baseline
rather than a diff. `provenanceOf` maps a DOM element to its **Provenance** —
the chain of components that rendered it — so a finding can name a component
instead of a bare node.

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
re-run. When it is omitted, every subject the session saw is replayed. Pass a sample when
confirmation is the expensive half and you already know which subjects are worth
the second pass.

`verify` needs the renderer back: confirming a suspicion means rendering the
subject again and checking whether its hash changed.

`probe`, `diffProbes` and `SheetRegistry` are the bracket itself — the
snapshot-and-diff pair described above — exported for a caller running the
detector over a world a session did not create. `probe` takes
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
`unchanged` forever while showing nothing. A session refuses that snapshot
instead of producing it.

A subject that is not finished when `mount` returns says so by returning a
promise; `run` awaits it and stays entirely synchronous when it does not, because
the synchronous path is the overwhelming majority and the package exists to be
cheap.

The session does not launch a browser, create a React root, or discover a test
runner. The document, viewport, engine identity, and renderer are caller-owned;
an empty mount throws, and overlapping asynchronous mounts are refused because
the session has one reusable container.

## Honest limits

**Detection generalises; attribution does not.** Detection is noticing that a
subject's output is unstable; attribution is naming which other subject caused
it. Module-level state — a singleton store, a cached client, a memoized
selector, a mocked clock — is outside the DOM and so outside the probe, and there is no stack to fall back on: the write
happened during an earlier subject's render, in a frame that returned before this
subject was ever compared. Confirmation still catches the symptom — the same
subject producing a different hash with no code change — and attribution reports
no culprit rather than inventing one.

**Confirmation varies time and holds the world fixed.** Re-running a subject in
the same session proves that the subject is unstable. But a leak that happens
*every* time renders the same wrong way in both passes, so the hash never
changes, and a leak the probe also never saw is reported as nothing at all.

That is both limits at once, and what comes out of it is a false regression
rather than a flake: the subject is stably wrong. Catching it means varying the
world instead, and collecting the subject in a session nothing else has touched.
That is what `variance run` — the `run` command in `@variance-authority/cli` —
asks its collector for when a subject's pixels change.

---

**[@variance-authority/session](https://variance-authority.dev/reference/packages/session)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
