# Put a harness of your own into visual review

Whatever renders your states can go under approved baselines, provided a
state's name is the only input to the bytes it produces. This page is that
route for a harness nobody wrote an adapter for: one module you write, then a
`new` verdict, an approval, and `unchanged` on the rerun — every step after
that module identical to a built Storybook's.

The shipped integrations read those states out of somewhere that already holds
them: a Playwright test, a built Storybook, a served route, a jsdom unit test.
This page is for everything else — a template renderer, an email builder, a
server-side view layer, a bespoke mount — where the states exist and nothing on
that list owns them.

What you write is one module, called a **collector**: it names the states to
observe and hands back one serialized render per state. It is about forty lines,
and all forty are on this page. Everything after it — painting, comparing, the
report, the approval loop — is `@variance-authority/cli`, identical to every
other integration.

## What the harness has to be

The only precondition is that rendering is a function of the state's name and
nothing else. Render `receipt/empty` twice in one process, and again tomorrow on
another machine, and the markup and the applicable CSS have to come back
identical byte for byte. A byte that changes on its own is not tolerated as
noise; it becomes a `changed` verdict on every run until somebody removes it.

In practice that rules out, inside the rendered output:

- a clock — a date, a timestamp, a relative "3 minutes ago", a copyright year;
- an unseeded `Math.random`, `crypto.randomUUID`, or an auto-incrementing id
  that restarts per process;
- iteration order over a `Set`, a `Map` built from concurrent writes, or an
  object assembled from parallel promises;
- a live read — a network call, a database row, a feature flag service;
- the machine's locale, timezone, or `process.env`, unless you pin them.

Two more requirements come from where the render ends up. The CSS that styles
the subject has to be reachable from the DOM you hand over — a `<style>` tag, a
stylesheet the document already holds, or inline `style` — because rules are
read out of the document rather than fetched. And the subject has to be
resource-closed or resource-free: anything it references by URL is fetched from
nowhere at paint time, so a subject with images or web fonts needs their bytes
carried in the document (`assets` and `resources` on the render document, which
the [`@variance-authority/dom` reference](../packages/dom/README.md) covers). The
example below references nothing, which is the easiest version of this to start
from.

## Why a browser is installed

Your collector does not paint. It serializes: the subject's markup, the CSS
rules that actually apply to it, the inherited values in force at its root, and
the viewport those were resolved against. That bundle is a **render document**,
and it is data — JSON, no live page, no handle to anything.

`variance run` opens Chromium once and paints every document the collector
returned. Splitting it this way is what makes the comparison meaningful: two
screenshots are only comparable when the same engine on the same platform at the
same pixel density produced them, so every image in the project is painted in
one place, no matter which of the seven integrations acquired it. Your harness
can be jsdom, a string template, or anything that produces markup, and it never
needs a browser of its own.

## Install

```bash
npm install --save-dev @variance-authority/cli @variance-authority/dom jsdom
npx playwright install chromium
```

`@variance-authority/dom` turns a mounted element into a render document.
`jsdom` is what the example mounts into; if your harness already produces a live
DOM — in a browser, in a worker, in a test environment — use that instead and
drop `jsdom`.

## The harness

This stands in for whatever you already have. It renders receipt templates to
HTML strings and knows nothing about visual review:

```js
// src/receipt.mjs
export const RECEIPT_CSS = `
  .receipt { font: 16px/1.4 system-ui, sans-serif; width: 320px; padding: 16px; }
  .receipt h1 { font-size: 18px; margin: 0 0 8px; }
  .receipt .total { font-weight: 700; }
`;

const RECEIPTS = {
  'receipt/empty': [],
  'receipt/one-item': [['Espresso', '$4.00']],
};

export function renderReceipt(id) {
  const items = RECEIPTS[id];
  if (items === undefined) throw new Error(`no receipt template named ${id}`);
  const lines = items.map(([name, price]) => `<li>${name} <span>${price}</span></li>`).join('');
  return `<section class="receipt"><h1>Receipt</h1><ul>${lines}</ul><p class="total">Total $4.00</p></section>`;
}
```

## The collector

```js
// variance/collector.mjs
import { JSDOM } from 'jsdom';
import { acquireDocument, collect } from '@variance-authority/dom';
import { normalize } from '@variance-authority/core/rules';
import { renderReceipt, RECEIPT_CSS } from '../src/receipt.mjs';

const VIEWPORT = { width: 360, height: 240, deviceScaleFactor: 1, colorScheme: 'light' };

export default async function collector({ plan }) {
  const dom = new JSDOM(
    `<!doctype html><html><head><style>${RECEIPT_CSS}</style></head><body></body></html>`,
  );
  const { document } = dom.window;

  return {
    async plan() {
      return plan;
    },

    async collect({ subject }) {
      let html;
      try {
        html = renderReceipt(subject.id);
      } catch (error) {
        return { ok: false, because: `${subject.id} did not render: ${error.message}` };
      }

      document.body.innerHTML = html;
      const root = document.body.firstElementChild;
      if (root === null) return { ok: false, because: `${subject.id} rendered no element` };

      const options = { subject, viewport: VIEWPORT, fonts: [] };
      return {
        ok: true,
        document: acquireDocument(root, options),
        snapshot: normalize(collect(root, { ...options, engine: 'jsdom@30', portalsOf: () => [] }), {
          sourceRoot: process.cwd(),
        }),
      };
    },

    async close() {
      dom.window.close();
    },
  };
}
```

The module default-exports a function, not an object. `variance run` imports the
file by path and calls that function once, and whatever it returns is used for
every subject in the run — which is where anything expensive belongs. Here that
is one jsdom window, opened once and reused; in your version it might be a
template cache, a database connection, or a compiler instance. Opening it inside
`collect` would pay for it per subject.

Three methods make up the rest:

| method | called | returns |
| --- | --- | --- |
| `plan()` | once, before anything is collected | the subjects this run should observe |
| `collect(subject)` | once per planned subject, serially | that subject's render, or a refusal |
| `close()` | once, after the last subject and before the report is written | nothing; release whatever `plan` and `collect` held |

`collect` is never called concurrently, even when `concurrency` is raised —
mounting two subjects into one document would let each decide the other's
verdict. What runs in parallel is the painting and comparing that happen after.

Two lines deserve a note. `portalsOf: () => []` states that this harness renders
nothing through a portal; without it the run warns on every subject that
portalled content would be invisible to the capture. And `fonts: []` asserts no
font identities, which the config section below explains.

## What `collect` gets, and what it gives back

### The argument

`collect` is handed a **planned subject** — the state to render, plus what the
run knows about it:

| field | type | required | what it is |
| --- | --- | --- | --- |
| `subject.id` | `string` | yes | The id this state is stored, compared and accepted under. Any string. `receipt/empty` is one id, not a path — the slash means nothing to the tool. |
| `subject.kind` | `'story' \| 'route' \| 'fixture' \| 'value'` | yes | What sort of thing it is. Subjects planned from a config `ids` list are `fixture`. |
| `subject.title` | `string` | no | A human label for the report. |
| `viewport` | `Viewport` | no | Present when the subject declares its own; it overrides the run's. Absent means use the run's. |
| `tags` | `readonly string[]` | no | What the subject declares itself to be, when the artifact that planned it carried tags. Absent for a `list` plan. |
| `path` | `string` | no | The directory that declares this subject, relative to the repository root, when a plan can supply one. It decides where a `beside` baseline layout files the image. |

One subject id is one image. To observe the same state at two viewports or in
dark mode, give it two ids.

### The return value

`collect` returns a `Collected`, which is one of two objects. Never throw for a
subject you cannot render — return the refusal and the run reports it by name,
with your sentence attached, and carries on with the other subjects.

**The refusal** has exactly two fields:

```js
{ ok: false, because: 'receipt/late did not render: no receipt template named receipt/late' }
```

`because` is free text, not an enum. Write the sentence you would want to read at
7am; it is printed verbatim under `not observed` and stored in the report. A run
with a refused subject exits `1` — an absent observation is not an unchanged one.

**The success** has one required field and seven optional ones:

| field | type | required | what it adds |
| --- | --- | --- | --- |
| `ok` | `true` | yes | |
| `document` | `RenderDocument` | yes | The serialized render. Build it with `acquireDocument`. |
| `snapshot` | `SemanticSnapshot` | no | The normalized structure and style of the same render. Without it a changed region has coordinates and no name: the report can show you the pixels but cannot say which element they are. |
| `source` | `SourceIndex` | no | Component name → `file:line`, as `Readonly<Record<string, {file, line, via}[]>>`. What turns a named region into somewhere to open in an editor. |
| `stabilization` | `readonly string[]` | no | Names of tricks you applied to the page before reading it — pinned animations, hidden carets. Reported so a run can state what it did to your application. An empty list and an absent one both say you stabilized nothing. |
| `diagnostics` | `readonly Diagnostic[]` | no | `{ severity: 'warn' \| 'error', code, message, nodePath? }`. What you noticed about the *reading* rather than the picture: a template that logged an error and rendered anyway, a fixture that had to be retried. An `error` here fails the run. |
| `causes` | `readonly string[]` | no | Components your own comparison already identified as the roots of the change. Used to order the report by the edit rather than by area. |
| `before` | `RenderDocument` | no | The previous revision's document, for `retention: "ephemeral"`, where both sides are rendered inside one run and neither is stored. |
| `presentation` | `PresentationSignalRecord` | no | A presentation consequence your harness compared itself. See [presentation intelligence](presentation.md). |

A full success object from the example above, abbreviated:

```js
{
  ok: true,
  document: {
    documentVersion: 1,
    subject: { id: 'receipt/one-item', kind: 'fixture' },
    html: '<section class="receipt" data-va-path="0"><h1 data-va-path="0/0">Receipt</h1>…</section>',
    frame: { html: {}, body: {}, ancestors: [] },
    css: ['.receipt {font-size:16px;line-height:1.4;width:320px;padding:16px}\n.receipt h1 {…}'],
    viewport: { width: 360, height: 240, deviceScaleFactor: 1, colorScheme: 'light' },
    inherited: {},
    fonts: [],
    diagnostics: [],
  },
  snapshot: { formatVersion: 1, subject: { id: 'receipt/one-item', kind: 'fixture' }, /* … */ },
}
```

`acquireDocument` fills every one of those document fields for you, so you do not
assemble it by hand. Two are worth knowing about anyway. `css` holds only the
rules that actually match the subtree — the `.unused` rule in the harness's
stylesheet is not in the list above, and on a real design system this is the
difference between shipping one rule and shipping a thousand. And `frame`
reproduces the ancestors the subject rendered inside as empty tags, so a rule
like `html.dark .receipt` still matches once the subtree is used on its own.

### Documents, not images

A collector hands over a document and the CLI paints it. There is no arm of
`Collected` that carries a PNG, so if your harness already produces images, this
is not the path — see [If you already have the pictures](#if-you-already-have-the-pictures).

### Where the plan comes from

`plan()` returns `{ subjects, notObserved, warnings }`. The collector both
receives a plan and returns one because two different things can produce it:

- With `subjects.kind: "list"` or `"storybook"`, the CLI builds the plan before
  loading your module — from the ids you wrote down, or from a built story
  index — and passes it as `context.plan`. Return it unchanged, as the example
  does.
- With `subjects.kind: "collector"`, `context.plan` is `undefined` and the plan
  is yours to build: crawl a sitemap, read a template directory, query an
  inventory. Return `{ subjects: [{ subject: { id, kind: 'fixture' } }], notObserved: [], warnings: [] }`.

`notObserved` is for subjects you know about and are not observing; they appear
in the report by name rather than vanishing. Each entry is
`{ subject: string, kind, because: string }`, where `kind` is `excluded` (a
decision — a tag you filter out), `failed` (it exists and could not be read), or
`unreached` (the run stopped before getting to it). `warnings` are strings
printed with the run.

If your collector needs to stop the whole run — a missing template directory, a
service it cannot call — throw an error marked as the operator's to fix, and the
CLI exits `2` instead of `1`:

```js
throw Object.assign(new Error('template directory not found'), { varianceOperatorError: true });
```

## The config

```jsonc
// variance.config.json
{
  "project": "receipts",
  "profile": "jsdom",
  "viewport": { "width": 360, "height": 240 },
  "retention": "durable",
  "subjects": {
    "kind": "list",
    "ids": ["receipt/empty", "receipt/one-item"],
    "collector": "variance/collector.mjs"
  },
  "baselines": { "kind": "directory", "root": ".variance/baselines" },
  "fonts": [],
  "report": ".variance/report.json"
}
```

It is JSON and runs nothing, so `subjects.collector` is the one key that brings
your module into a run. Unknown keys are refused by name, and paths resolve
against this file's directory rather than the working directory.

| key | what it decides |
| --- | --- |
| `project` | The label this project's rows are filed under in a shared history store. Required even with no history configured. |
| `profile` | What the run is *capable* of observing — `jsdom` or `chromium`. `jsdom` means structure, ARIA and declared style; `chromium` adds computed style, layout and geometry, and is only honest if your collector read inside a real browser. It does not decide what paints. Set it to match where you acquired. |
| `viewport` | `width` and `height` in CSS pixels, plus optional `deviceScaleFactor` (default `1`) and `colorScheme`, `light` or `dark` (default `light`). The fallback for a subject whose planned entry carries no viewport of its own. Keep it equal to the viewport your collector acquires at, since that is what media queries were resolved against. |
| `retention` | `durable` compares against an image a previous run stored, and requires `baselines`. `ephemeral` renders both sides inside one run and keeps neither, and then `baselines` must be absent and your `collect` must return `before`. Setting both is refused. |
| `subjects.kind` | `list` — the ids are in this file. `storybook` — read them from a built story index. `collector` — your `plan()` discovers them, and the config stops being the statement of what is watched. |
| `baselines.kind` | `directory` — files you commit. `lfs` — the same files through the Git LFS filter. `remote` — an endpoint and a token, with nothing in the repository. No default; see [baseline placement](placement.md). |
| `fonts` | Fonts this machine is asserted to have, each as `family/weight/style/hash` — a bare family name is refused. The hash is of the font bytes and is yours to supply, because a page can ask whether a family resolves and can never read the file behind it. `[]` asserts nothing, which is correct for the example (it declares `system-ui` and no web fonts) and wrong for a subject with a web font: two machines carrying different cuts of Inter would then produce the same identity, compare, and report the difference as a regression. |
| `report` | Where `run` writes and where `report` and `accept` read. Defaults to `.variance/report.json`. Candidate images land beside it. |
| `browser` | Which engine paints: `chromium` (default), `firefox`, or `webkit`. It is part of the key baselines are stored under, so switching it moves every subject into a partition where nothing is approved yet. |

`profile: "jsdom"` costs you one thing, and the run says so on every line of
output: jsdom has no layout engine, so a changed region can be located in the
image but not joined to the element that occupies it. If attribution matters
more than the simplicity of this page, acquire inside a browser — the
[route collector](start-routes.md) and the
[Storybook collector](start-storybook.md) do, and your own collector can too.

### Where the approved images live

`.variance/baselines` is what every later run compares against, so it has to be
tracked and pushed. A run that cannot read it does not fail: it finds nothing,
reports every subject `new`, records what is on screen as the new truth, and
exits `0`.

The wildcard is the mistake to avoid. `.variance/` also holds the report and
candidate images that genuinely are per-run junk, so exclude the contents
rather than the directory, and git still descends:

```gitignore
.variance/*
!.variance/baselines/
```

Inside that root, images are filed under the identity of the machine that
painted them — `v1:297753c4…/receipt%2Fempty.png` — and a run only compares
against its own partition. So baselines approved on your laptop are not the ones
CI compares against: a Linux runner finds none under its identity and reports
every subject `new`. Paint in one place that both use, which in practice means
running `variance run` inside the same container image locally and in CI.
`variance doctor` is the readback: it lists each identity in the root and says
whether this machine's is one of them.

## Run the first loop

A `--save-dev` install puts `variance` in `node_modules/.bin`, so run it through
`npx` or from a package script.

```bash
npx variance doctor --config variance.config.json
npx variance run --config variance.config.json
```

`doctor` reports what this machine can do and guesses at nothing: it opens the
browser that will paint, measures the fonts you asserted inside it, and lists
which identities the baseline root holds.

The first durable run exits `1` and reports both receipts as `new` — an image
nobody has approved is not a pass. Write the HTML report beside the JSON one,
because the image links inside it are relative to the report:

```bash
npx variance report --config variance.config.json --format html > .variance/report.html
```

Open it in a browser. Each subject is a picture you can work: the approved
image, the difference, and the candidate, with a wipe, a blend and a blink
between them. A `new` subject has no approved image, so what you are looking at
is the candidate alone, and the question is only whether that is what the
template is supposed to look like.

It is, so approve them by id:

```bash
npx variance accept --config variance.config.json receipt/empty
npx variance accept --config variance.config.json receipt/one-item
npx variance run --config variance.config.json
```

`accept` promotes the image that run already produced. It renders nothing, so
there is no suite to re-run first. The rerun exits `0` with both subjects
`unchanged`.

From here the loop is: edit the template, run `variance run`. Change
`font-weight: 700` to `400` in the harness and the next run exits `1` with both
receipts `changed` and the region that changed named in the report.

Exit codes are three, and they mean different things to different people: `0`
nothing to review, `1` the run happened and found something a person must decide
about, `2` the run did not happen as configured — a bad config, a missing
browser, a store the run cannot talk to.

## If you already have the pictures

A collector hands over markup and lets the CLI paint it. If your harness already
produces PNGs — a native screenshot tool, a design tool export, a renderer of
your own — there is nothing for the CLI's render half to do, and `variance run`
has no way to take an image you already made.

`@variance-authority/observe` is the comparison on its own. Hand it two images,
or one image and a baseline you looked up yourself, and it answers `new`,
`changed`, `unchanged`, `ignored`, or `incomparable` with the differing regions
and a sentence saying why. What you keep is everything around it: storing
baselines, deciding what approval means, writing the report, and choosing the
process exit code. There is no `accept` command on this path, because that
belongs to the CLI you are not using.

## Go deeper

- [choose from the state you already have](cases.md) — whether another
  integration already owns these states before you write a collector.
- [baseline placement](placement.md) — `directory`, `lfs` and `remote`, and what
  each costs when acquisition and rendering run on different machines.
- [stabilization](stabilization.md) — what to do about a subject that is
  deterministic in your harness and changes once a browser paints it.
- [composition](composition.md) — which evidence to add when a pixel verdict is
  not the question you have.
- [`@variance-authority/dom`](../packages/dom/README.md) — `acquireDocument` in
  full: resource closure, assets, inherited values, and the framework readers
  that attach component names to a capture.
- [`@variance-authority/cli`](../packages/cli/README.md) — the collector
  interface as TypeScript, `collectAlone` for telling a regression from a leak
  between subjects, and every config key this page left out.
- [`@variance-authority/observe`](../packages/observe/README.md) — the
  comparison used on its own.
