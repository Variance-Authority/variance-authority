# What visual review costs, and where Variance Authority cuts it

A visual regression suite costs you twice: machine time for every picture it
takes, and an engineer's time for every difference it shows. Both grow with one
number — how many comparisons the suite makes, and how many of those it puts in
front of a person. A screenshot tool takes every picture first and compares
afterwards, so that number is fixed before anything clever runs.
[Variance Authority](README.md) runs beside the tool and the tests you already
have, and decides earlier. It skips the UI states your change could not have touched,
settles a state whose DOM and styles are unchanged without painting a pixel,
and when it does show you a difference, it names the component and the
`file:line` that drew it.

## Two bills, one count

The machine bill is a multiplication, and it is worth writing out because every
factor in it is a decision somebody made once and forgot:

```text
UI states × viewports × browsers × themes × builds
```

Forty stories at two viewports in two browsers under light and dark is 320
pictures per build. Every push pays for all 320, in CI minutes on your runners
or in the unit a hosted service meters. Most of those pictures are of states the
push did not touch, and the suite takes them anyway, because a screenshot tool
learns that nothing changed by taking the picture and comparing it.

The review bill is the same count after the comparison. Every difference that
survives to a person is a decision: open the image, find what changed, work out
whether anyone meant it. A design-token edit that repaints every surface turns
into hundreds of those decisions at once, each one correct and none of them
useful. A flaky state turns into the same decision every week. A team that
lives with this for a quarter starts approving in bulk, and a suite approved in
bulk has stopped testing anything.

Perceptual matching, pixel thresholds and a hosted review queue all read a
comparison that has already been captured, painted and billed, so they lower the
review bill and leave the machine bill where it was. Cutting both means deciding
before the picture is taken, and that needs to know what each UI state is made
of. A module graph can predict it; Variance Authority checks that prediction
against what each state actually rendered when its baseline was painted.

## One design-token edit, through a run

The selection-reuse example builds a throwaway checkout of 304 files and edits
one of them, `tokens.css`. Two UI states exist: a catalog story that renders
`Button`, whose stylesheet imports the token, and an account story that renders
`Badge`, which imports nothing. It scans the source twice, the second time warm
from the first scan's index, and prints which stories the edit selects. Run it
from a checkout of this repository, after `yarn install && yarn build`:

```bash
yarn workspace @variance-authority/example-selection-reuse demo
```

```text
CACHED SOURCE SELECTION — one changed token
  changed:  src/tokens.css
  collect:  story:catalog (reaches Button)
  skip:     story:account (does not reach Badge)
```

The demo stops at that answer. In a run with the file graph on, as below, the
account story would never be rendered, compared or shown to anyone: one picture
saved per viewport, browser and theme, and one review decision nobody has to
make.

## Cheaper to run: fewer pictures, each one cheaper

### A change runs only the states it touched

```bash
variance run --since origin/main
```

`--since` takes the files changed since the merge base with `origin/main`,
works out which components those files can affect from a scan of your source,
and skips a UI state when its stored baseline records none of those components.
The second half is what makes the skip safe. The component list is written next
to the approved image by the run that painted it, so it says what the state
actually rendered the last time anyone looked, not what a module graph predicts
it might render.

That asks three things of you. The baseline has to carry the component list, which
React gives you for free and other frameworks get from the same build step that
[attribution](attribution.md) needs; a state whose baseline has no list is
observed, never skipped. And the run needs `source.dirs` in its configuration so
it knows where to scan; without it, `--since` refuses rather than guess. And a
file that declares no component — a stylesheet, a token file, a shared helper —
runs the whole suite unless you turn on the file graph, `"relations": true`
under `source`, which follows the imports from that file to the components it
reaches; [the expensive row](selecting.md#the-expensive-row-and-what-retires-it)
says what it costs. Every skipped state appears in the report with the sentence
that skipped it, and [running less of the suite](selecting.md) walks through how
each step is answered.

How much this saves is a property of your suite, not of this page. A change that
touches two states in a 300-state suite costs two states' work. A change to a
token file that every component imports selects every state that renders one,
and that is the right answer; there, the saving comes from the next section and
from [how a rebrand is reviewed](#a-rebrand-is-read-once-not-once-per-screen),
not from selection. The first run beside your current tool counts what it
skipped on your own pull requests, which is the figure worth forwarding.

### The DOM decides before a picture does

Each UI state is read first as a document: its DOM, the styles that apply to
it, a hash of each image and font it loaded, and the component that produced
each element. Reading that is much cheaper than
painting it. On the todomvc example in Chromium, [reading the document takes 3.0
ms and painting the same page takes 54.0 ms](instruments.md), roughly eighteen
times as much, on one machine.

So the run reads first and paints only when it has to. The baseline image was
painted from a document, and the run keeps a digest of it. When this run's
document has the same digest, the browser that painted the baseline would be
painting the same input again, so no screenshot is taken, unless that baseline
was painted on another machine, which refuses the shortcut. The states whose
DOM, styles or resources changed are the only ones that pay for a raster.

Canvas, WebGL and video draw outside the document, so a document cannot settle
them. A state built on one is better captured as a screenshot in the page your
test already has open, which is supported, and pays for its picture on every
run; [the blind spots of each capture](metrics.md#m9-blind-spots) are listed.

### One browser process for the whole run

Painting is not the only cost around a picture. Starting a browser, opening a
page and navigating to the state are paid per capture in most setups, and they
grow with the suite. Variance Authority keeps one Chromium open for the run,
with a page per viewport, and paints every captured document into those. [Measured on the
kitchen-sink example](better-tests.md), a capture into an already-open page
costs about 7.5 ms, and one that starts from a fresh browser about 205 ms.

Reading Storybook, the run opens the preview once and switches stories over
Storybook's own channel instead of navigating to each one. Holding the page
still for a capture — fonts loaded, animations paused, the caret hidden — is on
by default and [costs about 0.3 ms per state once the page is
warm](stabilization.md).

### No meter, and what you pay instead

There is no per-screenshot bill: the packages are MIT-licensed and run in your
CI, against baselines you keep. Compute, storage, renderer capacity, retention,
upgrades and the pager are yours instead, and if you would rather buy those as a
service, [compare the operating models](compare-visual-review.md) before you
choose.

## Easier to keep: fewer differences, each one answered

The review bill is paid in decisions, and a decision is expensive when you
cannot tell what you are looking at. Each section below removes one kind of
decision that should never have reached a person: working out which component a
diff belongs to, rejecting a rebrand on a test that was not about colour,
re-running a flake to see if it goes away, reading a baseline diff that
changed nothing visible, and keeping a second suite in step with the first.
What remains is the difference somebody meant, or a
regression.

### A difference names its component and line

A pixel diff tells you how many pixels changed, and then you open the image to
find out what that means. Variance Authority traces each changed region back to
the element that painted it, the component that rendered that element, and the
line of source that wrote it: **this region, inside `Toggle`, in
`main → region "Todos" → item 2 of 3`, written at
`examples/todomvc/src/ds/components.tsx:107`.**

A reviewer reads that in seconds and knows who to ask. [From a pixel to a
line](attribution.md) says what each step needs from your build — React's
development build supplies most of it — and where the chain stops and says so
instead of guessing.

### A rebrand is read once, not once per screen

A route test — a whole page rendered at a URL — that fails on every colour
change is a route test nobody reads, and loosening its threshold also stops it
noticing that the sidebar collapsed. Instead, you declare what a group of states
is under test for. Every difference the run finds has a kind: accessibility,
geometry, style values (`token`), text, or sub-pixel noise. A route declared
`layout` asserts on accessibility and geometry, and lets a change of style
values through without a review. The report calls each UI state a subject, and
prints what every such rule let through:

```text
SENSITIVITY — 38 subject(s) not asserted on in full, by 2 rule(s)
  routes — asserts on layout; absorbed token difference(s) in 38 of 41 subject(s):
    a route asserts the page assembles, not what it is painted
  [dead] legacy-embed — asserts on content across 3 subject(s) and absorbed
    nothing (a third-party embed you do not style)
```

The same route still reports a navigation bar that shifted by one pixel: it
absorbs a kind of change, not an amount, and says how much it absorbed on every
run. A state let through this way costs one hash comparison, before the run does
any work on the changed pixels; [sensitivity](sensitivity.md) owns the levels
and the `[dead]` rule.

A component story stays strict, because for a component test a colour change is
the change under review. What changes is how it reaches you. In the [review
service you can deploy](../packages/tribunal/README.md), the first thing on a
build is one entry per component the run named as a cause, largest first, with
the file it is declared in; the reflow that change pushed onto everything around
it is one number for the build. A token edit that touched forty stories through
`Button` is listed as `Button`, once, and after approval it is one entry in the
changelog rather than forty.

### An unstable state gets a cause, not a retry

A retry hides an unstable state until the next time, and a tolerance big enough
to absorb rendering noise is big enough to absorb a small real change. When a
state differs, Variance Authority reads it again instead: once more in the same
page to see whether it drifts on its own, then in a fresh page to see whether
something an earlier test left behind changed it. Each reading names the
component and the kind of change, so an animation, a different environment, an
unstable component and leaked state each arrive as what they are.

Some causes never become review work. Paused animations and a hidden caret
remove theirs by construction; an image painted by a different browser, platform
or font set goes to its own baseline instead of into a comparison. If you run
a history store beside your CI, what is left is
[counted by component and kind across runs](flakiness.md), so the report can say
that the text inside `Clock` read differently in six of the last twelve sweeps,
or that nine sweeps have not seen it since somebody fixed it.
Nothing is ignored automatically at any count. Ignoring it stays a line someone
writes down with a reason.

### An edit that changes no pixel changes no tracked file

Every baseline is an image plus a small record of how it was painted. The image
changes when a pixel changes; the record changes when the document does — a class
name, a build id — so a record committed beside its image puts a diff in your
pull request on edits that changed nothing visible. One key sends the records
somewhere version control does not look:

```jsonc
"baselines": {
  "kind": "directory",
  "root": "baselines",
  "records": ".variance/records"
}
```

After that, a pull request's baseline diff is exactly the images that changed,
which is the diff a reviewer should be reading. [Where baselines live](placement.md) covers the trade: a second location to
restore in CI.

### The harness you have stays

Your Playwright specs, Storybook, served routes, jsdom unit tests and Vitest
browser mode already know how to put the app into the states you care about.
Variance Authority takes the state from whichever of them set it up, and your
existing `toHaveScreenshot` assertions can keep running while you try it. There
is no second suite to write and keep in step with the first, and nothing to
migrate in one go. [Add it to what you already use](replacing.md) takes one
harness at a time.

## Where to start

Pick one UI state that a harness you trust already sets up, and take it through
[your first run](start.md): a baseline you approve, then a second run that
reports it unchanged. Add `--since origin/main` once you have a few baselines
and `source.dirs` set, and the next pull request shows you which states it
skipped and why.
[Gate a build on what changed](gates.md) puts that run in CI beside the job you
have now.
