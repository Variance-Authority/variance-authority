<p align="center"><img src="https://variance-authority.dev/mark.svg" alt="Variance Authority mark" width="72"></p>

# @variance-authority/store

> Variance Authority baselines on a filesystem, in a plain directory or through git-LFS.

Part of [Variance Authority](https://variance-authority.dev).

This package is where those approved images sit. It gives you two backends —
a plain directory, and a directory whose images are tracked by git-LFS — plus
the reader that answers *why is this baseline what it is* out of your git
history. Take it when a comparison needs baselines on a disk you control:
one runner's own directory, or a repository a team checks out.

Throughout, a **subject** is one named UI state you asked for and can ask for
again — a story, a route, a component in a particular state. A stored baseline
for one subject is two files: a PNG, and a JSON **sidecar** written beside it
recording how that image was painted.

## Requirements

- **Node 22 or newer.**
- **ESM only.** Every `@variance-authority/*` package ships `"type": "module"` and no CommonJS build, so `require()` will not load it.
- The `lfs` and `changelog` entrypoints run `git`, which has to be on `PATH`. The other two need nothing but a writable directory.

```bash
npm install --save-dev @variance-authority/store
```

## Write a baseline and read it back

Complete and runnable as written — save it as `baselines.mjs` and run
`node baselines.mjs`. The PNG below is a real one-pixel image, so nothing has to
be rendered first.

```js
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDurableStore } from '@variance-authority/store/durable';

const root = await mkdtemp(join(tmpdir(), 'baselines-'));
const store = createDurableStore(root);

// Everything about the machine that painted the image. Two machines that
// disagree on any of these fields get separate directories under the root.
const identity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 2,
  fonts: ['Inter/400/normal/abc'],
};

// `label` distinguishes several images of one subject — a viewport, a state.
const key = { subject: 'components/Button/primary', label: 'wide' };

await store.put(key, {
  // A hash of the rendered document, computed by whatever produced the image.
  // The store keeps it and hands it back; it never computes one itself.
  documentDigest: 'v1:9f2a41c7d0b85e36a14c7e2f8b06d735',
  identity,
  width: 1,
  height: 1,
  bytes:
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  missingFonts: [],
});

// The lookup that needs no image: does a baseline exist, and may this machine
// compare against it?
console.log(JSON.stringify(await store.describe(key, identity), null, 2));

// The same lookup from a Linux runner.
console.log(JSON.stringify(await store.describe(key, { ...identity, platform: 'linux/x64' }), null, 2));

console.log(root);
```

### What you get

Two files under the root, in a directory named by a hash of the identity:

```
<root>/v1:d9e2d62e05a69046dc75e1a987837b31/components%2FButton%2Fprimary__wide.png
<root>/v1:d9e2d62e05a69046dc75e1a987837b31/components%2FButton%2Fprimary__wide.json
```

The sidecar, verbatim:

```json
{
  "documentDigest": "v1:9f2a41c7d0b85e36a14c7e2f8b06d735",
  "identity": {
    "renderer": "playwright-chromium",
    "engine": "chromium@131.0.0",
    "platform": "darwin/arm64",
    "deviceScaleFactor": 2,
    "fonts": ["Inter/400/normal/abc"]
  },
  "width": 1,
  "height": 1,
  "missingFonts": []
}
```

The identity is written out in readable form, so you can attribute a baseline to
the machine that produced it and decide whether to keep it.

The first `describe` — the machine that wrote it:

```json
{
  "documentDigest": "v1:9f2a41c7d0b85e36a14c7e2f8b06d735",
  "comparable": true,
  "storedUnder": {
    "renderer": "playwright-chromium",
    "engine": "chromium@131.0.0",
    "platform": "darwin/arm64",
    "deviceScaleFactor": 2,
    "fonts": ["Inter/400/normal/abc"]
  },
  "pictured": true,
  "missingFonts": []
}
```

The second — the Linux runner, which reads a different directory and finds
nothing of its own:

```json
{
  "documentDigest": "v1:9f2a41c7d0b85e36a14c7e2f8b06d735",
  "comparable": false,
  "storedUnder": {
    "renderer": "playwright-chromium",
    "engine": "chromium@131.0.0",
    "platform": "darwin/arm64",
    "deviceScaleFactor": 2,
    "fonts": ["Inter/400/normal/abc"]
  },
  "pictured": true,
  "missingFonts": []
}
```

`comparable: false` with a filled-in `storedUnder` is the whole difference
between "we have never seen this subject" and "we have seen it, on a machine you
are not". A wrong-machine run comes back as one printable line naming the
platform that *was* found, rather than a suite-wide failure with no stated
cause.

`describe` reads a few hundred bytes of text and stats the image. `find` is the
same lookup with the PNG, base64-encoded, attached.

## Approve a change

Nothing in this package promotes a baseline. The CLI does, against whichever
store your configuration names:

```bash
npm install --save-dev @variance-authority/cli
```

```bash
npx variance accept [--config <path>] <subject>... | --all | --shape <fingerprint>[,...] [--message-file <path> [--message <text>]]
```

`accept` promotes an image the run already produced — it re-renders nothing, so
what you approve is what you reviewed. Name subjects to promote those, `--all`
to promote every changed one, or `--shape` to promote by **fingerprint**: the
digest of one recurring visual change, which a report prints against every
subject the change reached. `--message-file` writes the explanation out for the
commit that adds the images:

```bash
npx variance accept --all --message-file .variance/commit-message.txt
git add -- .variance/baselines
git commit -F .variance/commit-message.txt
```

Point the CLI at one of these backends in `variance.config.json`:

```json
{
  "baselines": {
    "kind": "directory",
    "root": ".variance/baselines",
    "layout": "flat",
    "records": ".variance/records"
  }
}
```

`"kind": "lfs"` takes the same keys plus `pattern`. There is no default: the
choice of where baselines live is yours to state.

## Choose a backend

| entrypoint | requires | gives you, and when you want it |
|---|---|---|
| `./durable` | a writable directory | baselines in a plain directory. The single-machine and self-hosted-runner case: nothing shares them. |
| `./lfs` | a writable directory and `git` | the same layout, with the images tracked by git-LFS so a team gets them on checkout. Take it when baselines must travel with the branch. |
| `./changelog` | `git` and a repository | reading back why a baseline is what it is. Take it when you are building a history view rather than running a comparison; nothing in the render path imports it. |
| `./share` | a writable directory | a directory storing bytes a run derived — not baselines. See the last section. |

Both store backends implement one contract, `RasterStore`, which is defined in
`@variance-authority/raster` and installed with this package:

| member | signature | answers |
|---|---|---|
| `find` | `(key, identity) => Promise<Found \| null>` | the baseline for `{ subject, label? }`, looked up under any identity that has ever written one; `null` only when none has. `Found` has the `raster`, whether it is `comparable` (written by the identity asking), and `storedUnder` (the identity that actually wrote it). |
| `describe` | `(key, identity) => Promise<Described \| null>` | the same lookup without the image: `documentDigest`, `comparable`, `storedUnder`, `pictured`, `missingFonts`, and optional accessibility, component and finding data when the sidecar includes it. Cheap enough to run for every subject before deciding which ones need the image at all. |
| `put` | `(key, raster) => Promise<void>` | writes a baseline. |
| `renderCache` | `{ get(documentDigest, identity), put(raster) }` | images this machine has already painted, keyed by document digest and identity, so an unchanged document is not re-rendered. A lookup or write here never throws; a miss and a failure both mean "render it". |
| `unplanned?` | `(keys, identity) => Promise<readonly string[]>` | file names written under this identity that none of these keys addresses — the baselines left behind when a subject leaves the suite. Names an operator can find on disk, not keys. One root serving two suites reports each suite's subjects to the other. |
| `expect?` | `(keys) => void` | an optional hint naming subjects about to be asked about; both backends here ignore it, because `describe` is already a `readFile`. |
| `retention` | `'durable' \| 'ephemeral'` | both backends here are `'durable'`. |

## Where the files go

```
<root>/<identityDigest>/<subject>[__label].png
<root>/<identityDigest>/<subject>[__label].json
```

`identityDigest` hashes the identity — renderer, engine, platform, device scale
factor and fonts — so it names a directory per rendering machine. A baseline
written by one machine cannot be silently picked up by another: it is not in the
directory the other machine reads.

`createDurableStore(root, options)` takes three options, and `createLfsStore`
passes all three through:

| option | default | what it decides |
|---|---|---|
| `layout` | `flat` | `flat` puts every image for the root in one directory per identity, with the subject id percent-encoded into the file name. `beside` puts each image in the directory where its code lives — `components/Button/<identityDigest>/primary__wide.png` — so baselines arrive with the checkout and move when the component's own files move. The directory comes from the key's `path` when the plan named one, and otherwise from the subject id read as a path. Either way a `..` or an empty segment is refused rather than resolved. A `path` from the plan keeps the whole subject id in the file name; an id split into directories spends its own slashes. |
| `cacheRoot` | `root` | where the render cache goes; a durable store doubles as one, so entries are written under `root` unless this points elsewhere. |
| `recordRoot` | `root` | where the `.json` sidecars go. A sidecar changes whenever the document does — a class name, a build id, a font that resolved elsewhere — so sidecars beside their images put a tracked diff on every edit, including the edits that moved no pixel. Point this at an ignored directory or a CI cache and `root` ends up with images and nothing else. |

Splitting the roots moves the sidecar's directory; it does not make the sidecar
optional. Both halves are still written and both are still read, so one half
without the other stops the run — the refusal names the file in the root it was
looked for in.

Both layouts keep the identity directory. Neither layout checks that the root is
committed: if baselines are meant to travel with the branch, that is between you
and your `.gitignore`.

## Missing and corrupt baselines

A missing pair — both `.png` and `.json` absent for a key — returns `null` and
is treated as a new baseline. Any other corruption throws:

- one file without the other
- a sidecar that will not parse
- EACCES after a permissions change
- EMFILE under a run wide enough to exhaust the descriptor table

A CI cache restore that ran out of space, or a `put` killed between its two
writes, both produce exactly a half-written pair — the case that throws.

## Keep baselines in git-LFS

A baseline image is never hand-merged: you take one side. LFS keeps the bytes
out of the object database while the pointer travels with the branch.

```js
import { createLfsStore } from '@variance-authority/store/lfs';

// Run this inside a git repository. The store writes the tracking entry before
// the first image, not on first `put`.
const store = await createLfsStore({ root: '.variance/baselines' });

console.log(JSON.stringify(store.tracking, null, 2));
```

In a fresh repository that prints:

```json
{
  "attributesFile": ".variance/baselines/.gitattributes",
  "pattern": "*.png",
  "added": true,
  "filter": "lfs",
  "diagnostics": []
}
```

and leaves `.variance/baselines/.gitattributes` reading:

```
*.png filter=lfs diff=lfs merge=lfs -text
```

`filter` is what git resolves the `filter` attribute to for a matching path, and
`null` when git could not be asked at all. `diagnostics` is empty when
everything was checked, and lists one line per thing that could not be — so an
un-smudged clone does not read as a passing run.

That last case is the one worth naming. An un-smudged checkout — LFS not
installed, or `GIT_LFS_SKIP_SMUDGE` set — hands you about 130 bytes of text
where a PNG should be, and comparing two of those reports `unchanged` for every
subject in the suite. The store refuses a pointer file read as an image.

`createLfsStore` takes:

| option | default | what it decides |
|---|---|---|
| `root` | required | baseline root, laid out exactly as the durable store lays it out |
| `pattern` | `*.png` | which files are tracked, relative to the `.gitattributes` the entry lives in. Only images match by default; the `.json` sidecar next to each is never routed through LFS |
| `attributesFile` | `<root>/.gitattributes` | where the tracking entry lives — the baseline root, not the repository root |
| `cacheRoot` | `root` | where the render cache goes. Defaults to `root`, so cache entries are tracked and committed alongside baselines unless this points outside the work tree |
| `recordRoot` | `root` | where the `.json` sidecars go, passed straight to the durable store. The reason to set it is sharpest here: `pattern` routes the images out of the object database, and the sidecars are the text left behind gaining a revision per document change |
| `verify` | `true` | `false` skips consulting git entirely, and says so in `tracking.diagnostics` rather than silently |
| `git` | `runCommand` | the `CommandRunner` git is invoked through — a `(command, args, { cwd }) => Promise<{ code, stdout, stderr }>` function, defaulting to a wrapper around `execFile`, swappable in tests |

Because `git` is injected, all of this is testable without a git repository.

## Bound the render cache

The render cache is keyed by document digest, so it gains an entry for every
edit and is worth nothing after the next one. Left under a committed `root` it
grows without bound. Sweep it:

```js
import { sweepRenderCache } from '@variance-authority/store/durable';

console.log(await sweepRenderCache('.variance/cache', { maxAgeMs: 14 * 24 * 60 * 60 * 1000, ceilingBytes: 512 * 1024 * 1024 }));
```

Those are the defaults — two weeks since an entry was last *asked for* (a hit
refreshes the entry's mtime), and 512 MiB after the age cut. The answer reports
`root`, `found`, `removed`, `freed`, `held` and `identities`, so a scheduled
sweep has something to print. It never throws: everything in the cache can be
painted again, so a root that cannot be listed, an entry that cannot be stat-ed
and a file deleted mid-walk all come back as counts rather than an exception.

## Read why a baseline changed

Where baselines are commits, `npx variance accept --message-file` has already
written the explanation into the commit message: prose for whoever scrolls
`git log`, and below it versioned **trailers** — `Key: value` lines appended
after the body, for a parser rather than a person. A baseline commit looks like
this:

```
chore(variance): regenerate baselines

tighten the card

v1:2c4f9a1e0b7d3856a91c4e2f8b06d735 Card src/Card.tsx 11/14
drift --va-space-3 12px -> 20px over 11 approvals

run 4242 @ 9f8e7d6c5b4a --shape

Variance-Run: v1 eyJjaGFuZ2Vsb2dWZXJzaW9uIjoxLCJydW4iOiI0MjQyIiw…
Variance-Change: v1 eyJmaW5nZXJwcmludCI6InYxOjJjNGY5YTFlMGI3ZDM4…
```

This entrypoint reads those trailers back:

```js
import { readChangelog, wasRead } from '@variance-authority/store/changelog';

// Run this inside the repository holding the baselines.
const answer = await readChangelog({ root: '.variance/baselines', limit: 50 });

if (!wasRead(answer)) {
  console.error(answer.because);
} else {
  for (const line of answer.bounded) console.warn(line);
  for (const commit of answer.commits) {
    console.log(commit.sha, commit.at, commit.record.selection);
    for (const entry of commit.record.entries) {
      console.log(' ', entry.fingerprint, entry.component ?? 'unnamed', `${entry.subjects.length}/${entry.reached}`);
    }
  }
}
```

Against the commit above, that prints:

```
a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4 2026-08-21T10:14:02+10:00 shape
  v1:2c4f9a1e0b7d3856a91c4e2f8b06d735 Card 11/14
```

`sha` is the full forty characters git prints, and `at` is the author date as
git reports it.

`11/14` is the finding: the change was promoted in eleven of the fourteen
subjects it reached, so three are still sitting in the suite. `selection` says
which flag chose the subjects — `named`, `shape` or `all` — because `--all`
promotes changed subjects as well as new ones, and that is regeneration rather
than review.

`readChangelog` takes:

| option | default | what it decides |
|---|---|---|
| `root` | required | the baseline root. Only commits that touched a path under it are read — a repository's ordinary commits are not baseline updates, and scanning them would spend the whole log to get the same answer |
| `cwd` | `root` | where git is run |
| `limit` | `200` | commits to read; a reading that hits this cap notes it in `bounded` rather than presenting the window as the whole history |
| `since` | none | a revision to read forward from, exclusive, passed as `<since>..HEAD`. One that does not resolve is a refusal naming it, never an empty answer |
| `git` | `runCommand` | the `CommandRunner` git is invoked through, so this is testable without a repository |

**An empty list is a real answer only when git ran, this is a repository, and no
commit under the root left a record.** Every other case is a refusal:
`wasRead` narrows the union, and `because` names what went wrong. "No baseline
has ever been explained" and "git could not be run" are opposite findings,
and an operator who reads the second as the first goes hunting for a bug in the
writer.

A **shallow clone** is the case that would otherwise pass silently — CI checks
out at depth 1, so a reading there sees one commit and would report it as the
whole history. That is not refused: the answer returns a `bounded` line saying
what it could not see. `bounded` collects the same kind of line for a commit
whose record this reader could not decode, and for a read that stopped because
it hit `limit`.

The reading is over the whole commit message rather than a trailer block at the
end, so a squash merge that folds three baseline commits into one yields three
records instead of none.

## A directory other machines may read

`./share` is not a baseline store. `createDirectoryShare(root)` gives you a
`get`/`put` pair over bytes that a run *derived* — a suite index, and whatever
comes after it — under a key that is a commit. Neither call ever throws.
Everything in it can be derived again from the tree it was derived at, which is
why losing it costs a rebuild and losing a baseline costs the comparison.

```js
import { createDirectoryShare } from '@variance-authority/store/share';

const share = createDirectoryShare('.variance/share');

await share.put('9f8e7d6c5b4a', new TextEncoder().encode('{"suite":[]}'));
console.log(new TextDecoder().decode(await share.get('9f8e7d6c5b4a')));
```

A directory is what every transport already is on the machine using it:
`actions/cache` restores one, `aws s3 sync` mirrors one, an NFS mount is one,
and a laptop has one. Writes land through a temporary file in the same directory
and a rename, so two jobs publishing at once cannot leave half a segment behind.
[Sharing an evaluation](https://variance-authority.dev/docs/sharing) is the
operator's side of it.

---

**[@variance-authority/store](https://variance-authority.dev/reference/packages/store)** is part of [Variance Authority](https://variance-authority.dev) — [documentation](https://variance-authority.dev/docs) · MIT
