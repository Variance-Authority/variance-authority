# Helix checkpoint

**Surface:** this file (git-committed). Epitaphs: [`epitaphs.md`](epitaphs.md).
**Cycle:** 5 → 6
**Reload budget:** one read. Verdicts only — no deliberation, no candidate lists.

---

## Outcome

M0 spike answers its exit question: **is normalization quality achievable?**

**Answered: yes, under one profile, on one corpus.** No rule had to be abandoned.
Five were wrong and all five were fixable within the existing structure.

**Proof.**

| # | Claim | State |
|---|---|---|
| P1 | A no-op refactor does not change the hash | **met** — 20/20 stable cases agree, including CSS accretion (1007 rules → 1 kept, 99.90% pruned) |
| P2 | A real change produces one root plus counted collateral | **met** — 17/17 changed cases agree; every case declaring a root count reports exactly it |
| P3 | Owner chains resolve to component display names | **met** — chains drive both attribution and differ matching in the measurement |
| P4 | Both profiles agree on the dimensions both can observe | **met** — 38/38 comparable cases; four defects found and repaired to get there (journal 0007) |

```
jsdom     scorable 38   agreed 38/38   false unchanged 0   false changed 0   undecidable 1
chromium  scorable 39   agreed 39/39   false unchanged 0   false changed 0   undecidable 0
P4        comparable 38   agreement 38/38   undeclared divergence 0
```

Capture cost, one Chromium reused across the corpus: **7.5 ms/capture warm vs
205 ms/capture cold — 27.4x** (48 renders, three runs 27.4/28.0/27.4).

**Boundary.** M0 only. Excluded: raster stage, CLI, GitHub Action, MCP server,
cross-repo `inherited`, hosted anything. No push, no publish.

---

## Branches

| id | Branch | State |
|---|---|---|
| B1 | **normalizer** | landed and measured |
| B2 | **provenance** | landed; load-bearing for correctness since ADR-0007, not only attribution |
| B3 | **corpus** | landed; found five defects the implementation's own tests could not |
| B4 | **dual-surface** | landed and measured — both profiles scored, P4 met |
| B5 | **differ** | landed and measured |
| B6 | **per-profile ground truth** | settled by ADR-0008 (undecidable / divergent / undeclared) |
| B7 | **persistent harness** — `packages/playwright`, one browser per run | landed and measured (27×) |
| B8 | **session** — one standing world, cross-pollution detected rather than prevented | landed and measured (3.5×, ~2% probe overhead) |
| B9 | **impact axis** — reflow vs repaint, orthogonal to the frequency bands | landed; answers B6's leftover band-cardinality question |
| B10 | **intent / adjudication** — declared claims vs findings, and the locate/source chain | landed; a report is a cause, a place and a file |
| B11 | **raster tier** — six phases, two retention modes, MCP surface | landed and measured; found that area ranks the displaced above the displacer |
| B13 | **the boundary** — what a package is, and what an entrypoint costs | landed; ADR-0013, enforced by `tools/boundaries.check.ts` |
| B14 | **replacement** — what a case is, and whether an incumbent can actually be left | landed and measured against a real `toHaveScreenshot`; three rows no threshold reaches, one row we lose |
| B15 | **limbs** — what a run knows with no baseline at all: bands split, inspection, locale, provenance without React | landed and measured; four capabilities and six defects, every one of them found by writing the capability rather than by looking for the defect |
| B18 | **the author loop, and what a subject is asserted on** — a trail across a session, and a declared sensitivity | landed in `core` and reachable from the library; **not from the binary**. `trail.ts` answers the four questions a pair of observations cannot — what has changed since the session started, what the last edit did, what it put back, and whether the loop is going in circles. `sensitivity.ts` declares which bands a subject is asserted on at all, and folds onto `applyIgnores` rather than reimplementing absorption, so it inherits the register and the dead-rule reporting. Both need two snapshots; `variance run` holds one |
| B17 | **cause on every path** — what a baseline has to carry for a run to name the component that caused a change | landed and measured; ADR-0027. Two halves stay open: the ephemeral mode holds one snapshot, and `tribunal`'s sidecar columns drop the field |
| B16 | **ignores** — what is not the subject, and the accounting that stops one becoming a blind spot | landed and wired end to end; ADR-0025 and ADR-0026, [`docs/ignores.md`](../ignores.md). Two forms (a subtree, a difference shape), both tiers from one declaration, a per-rule ledger, and a fifth verdict — `ignored`, green, and never spelled `unchanged`. The fingerprint pays twice: `variance accept --shape` promotes one change across every subject it reached and refuses the ones where something else also moved |
| B19 | **composition** — the suite compared to itself at one commit, and why a component moved | landed and measured ([`docs/composition.md`](../composition.md), journal 0017). The other axis: many subjects, one revision, joined on the components they share, from digests a run already computed — no second render, no image, no store. Three answers nothing could previously phrase: an **echo** (one rendering, several subjects, so eleven diffs are one review), a **divergence** (one props digest, two renderings, at one commit), and an attribution ladder over every component that moved — `edited`, `token`, `upstream`, `contradicted`, then **unexplained**, which is the finding. Unexplained carries `held`: the subjects where the same component with the same props did *not* move, which is the control group the flake argument was missing. It still refuses to call that a flake — `suspect` alone, `flake` only once a second reading of that subject also disagreed. Two decisions fell out and are ADR-0033 and ADR-0034. Does not survive a shard split, and the merge behind `variance report` over shards says so |
| B20 | **the entry point** — where a change enters a rendered page, above the wire and above the end state | landed in `packages/react`, and **half of it is now the run's own wait** ([journal 0018](journal/0018-where-a-change-enters-the-room.md), ADR-0037). Two instruments the pipeline did not have. `tapCommits` installs React's own commit hook — which must exist *before* `react-dom` loads, so a tap that attached late **refuses** rather than reporting a quiet page — and reads `PerformedWork` off the committed tree, so `awaitQuiet` answers a page that never settles with the components still committing by name and leaves out the ones that merely mounted. `pendingSuspense` needs no hook and no advance warning: a boundary's state is reachable by traversal from the expando provenance already reads, at any time, in production, and it comes back with the owner chain and who wrote the `<Suspense>` rather than as a count. Both replace a poll in pixel space — the incumbent screenshots until two agree, which costs a raster per poll and names nothing on failure. **The Suspense half is wired and the policy is decided:** every page agent waits for boundaries before it reads — first, ahead of stabilization, and two clean readings deep so a waterfall cannot slip through the gap between an outer boundary resolving and the inner one it reveals — and a subject still showing a fallback is **refused by name** rather than captured, because a skeleton on a slow machine and a component on a fast one is a baseline every band agrees with and nobody wrote. The one escape hatch is declaring the subject a loading-state capture, checked in the other direction too. Proved against a real build on three stories, one of which never resolves ([`suspense.chromium.test.js`](../../cases/storybook-case/src/suspense.chromium.test.js)). **The tap half stays an export**, and for a stated reason rather than an unmade decision: it must be installed before `react-dom` loads, which a collector arriving at somebody else's page cannot guarantee, so an unattached tap would refuse every subject on a page it merely reached too late. The fourth depth — which *prop* controls which band — is measured and specced ([0024](../specs/0024-what-a-prop-controls.md)), and three of seven predictions were wrong, which is the argument for measuring it per component |
| B21 | **the framework as a dimension** — the fiber read as a first citizen, beside HTML and CSS | landed in `packages/react`, `core` and `dom`, and carried end to end through a real collection ([`docs/framework.md`](../framework.md), [journal 0019](journal/0019-what-the-fiber-licenses.md), ADR-0036). Two components can produce a byte-identical document and differ in everything that decides what happens next, so the fiber is not a provenance lookup — it is a **sixth band**. `wiringOf` records hook shape, wrapper chain, context subscriptions and reconciliation keys; `componentInstances` folds them into a `wiring` digest that sits *beside* `rendering` exactly where `geometry` does, so a whole new dimension shipped with **every stored digest unchanged**. The rule that shaped it is checkable and is asserted rather than assumed: read the same page twice and if the value moved it is not a band — which puts the fiber's most valuable single fact, whether an instance was destroyed and rebuilt, on the other side of the line. `remountedSince` is a finding rather than a band: measured, a counter clicked once reads `1 of 1` under a stable child and `0 of 1` under one declared inside its parent's body, with identical `outerHTML`, identical `rendering` and identical wiring. What is open is no longer a policy question — B20 answered that one — but a wiring one: no collector passes `wiringOf` and no report carries a remount |
| B22 | **the last hop** — a rendered node connected to the line of JSX that wrote it | landed as [`@variance-authority/jsx-source`](../../packages/jsx-source), and proved end to end through a minified production Storybook. The claim it corrects is this repository's own: `_debugSource` is gone in React 19, from which four documents concluded that per-element locations were finished. They are not — every transform still computes `{fileName, lineNumber, columnNumber}` and React 19 is what throws it away, so the missing hop is one anybody can supply. The location rides a `Symbol.for` key on props, which is invisible to `for…in` (never an attribute), invisible to `Object.keys` (never in a props digest) and therefore free: no `renderHash`, no `structureHash`, no baseline moved. Reports prefer it over the name scan wherever it exists, because a scan names where a component is *declared* — one line for every instance — and this names which of them changed ([journal 0020](journal/0020-the-line-that-wrote-it.md)). **The first way in was `jsxImportSource` and it does not compose**: there is one of that setting per build and Emotion, theme-ui and everything with a `css` prop have already spent it, so taking it is taking their runtime away. The answer is to stand *underneath* React rather than in front of it — every custom runtime bottoms out in `react/jsx-dev-runtime` and forwards the transform's source argument on the way down, so replacing what that specifier resolves to serves all of them at once and never mentions `jsxImportSource`. A Vite plugin covers Vite, Storybook and Vitest; a resolver covers Jest; both guard against answering the recording runtime's own request, which is why `moduleNameMapper` cannot do it. Verified against Emotion 11.14 through all three runners with `jsxImportSource` left pointing at `@emotion/react` ([journal 0021](journal/0021-underneath-rather-than-in-front.md)). **And against a React development build it now asks for nothing at all**, which is the form the ask should always have had: a plugin, a resolver and a `jsxDev` are each an edit to the build that ships production code, made so that a *test* can see more. React's development build already captures an `Error` inside its own element factory and keeps it on every fiber as `_debugStack`; `packages/react` reads the first non-vendor frame, carries at most four candidates transiently on `Provenance.stack`, and the collector resolves them through the source map the dev server already emits — with a source-map decoder written out in `core` because `core` takes no dependency (ADR-0013), and the module fetched *through the page*, which already holds the origin, the cookies and the session. It reaches the classic transform too, because React captures the same error in `createElement`. The economics are what make it bounded rather than clever: on a 4211-node document every fiber carried a stack and between them they held **14 distinct call sites**, so the resolver's cache is the mechanism, not an optimization. Proved end to end against a real Vite dev server whose `vite.config.mjs` is `export default {}` ([journal 0022](journal/0022-the-error-react-already-threw.md)). **React development builds only** — a minified production artifact carries no such error, which is what the two install routes above are now for |
| B23 | **change management** — what a diff reaches, read from source rather than from a bundler | landed and measured ([`docs/selecting.md`](../selecting.md), [journal 0025](journal/0025-what-a-second-scan-costs.md), ADR-0038/0039/0040). Selection's expensive row was *a changed file that declares no component runs everything*, which is every token file, every theme, every hook — so the selector surrendered on exactly the diffs it was bought for. `@variance-authority/sense` scans the source into one `FileRecord` per file and `core/relate` folds them into CSR adjacency with the transpose materialized, so *what depends on this* costs what *what this depends on* costs. The direction convention is the whole trick: a component depends on the file that declares it, so one walk against the arrows from a changed file reaches every importer and every component in one pass. A file whose imports could not be read carries the **sentence** saying so and is traversed as though it changed. `nx` and `turbo` enter as **seeds, never a selection** — they see the one edge a specifier scan cannot, a package importing another's built output, and the price of that edge is project granularity. Beside the traversal, `closureOf` hashes the graph the way `bazel` keys an action: cycles condensed by Tarjan so every member carries one digest, unread inputs marked volatile and propagated. **The cost is the claim.** git names every file's content without opening one, a digest names the parse, and a digest plus a layout digest over the path set names the whole record — 3002 ms cold, 236 ms warm, and the one-file edit is inside the noise. That also answers the Rust question against ADR-0004's gate, and the answer is no: parsing was never the expensive half once cached, resolution was, and resolution is now eliminated rather than made faster. Two halves stay open — component-to-component edges ([0025](../specs/0025-component-relations.md)) and somewhere to store a closure digest ([0026](../specs/0026-selection-by-closure-digest.md)) |
| B12 | **history** — what accumulates across runs, and where it lives | **wired, and answering four of its five questions** ([`docs/history.md`](../history.md), [what is left](../specs/0002-history-store.md)). The contract gap that blocked it is decided — `current()`, the one read about the present, which never truncates because a missing previous row is a change that did not happen (ADR-0031). A run records itself, the hashes that moved, the tokens it resolved and every subject that failed to read the same way twice; `variance accept` records the approval, as a second row because an append-only store cannot flip a flag. It then asks — recurrence over a window with sweeps as the denominator (ADR-0032), churn for the components it blamed, and a journey for any token whose value moved — and carries the answers in the report, so no surface downstream holds a connection. The headline case is produced by the pipeline. Still open: `reach` has no caller, and nobody has run the eleven runs and eleven approvals that would demonstrate the 22px against a real project. First implementation refuted and retired ([epitaphs](epitaphs.md)) |

---

## Moves

| id | Branch | Move | Result |
|---|---|---|---|
| M1 | — | Scaffold, ADRs 0001–0003, `core` types | **expected** |
| M2 | B1 | Normalization pipeline | **mixed** — ADR-0003 step 4 was wrong; amended to all-or-nothing shorthand expansion (journal 0004) |
| M3 | B4 | Collector + CSS applicability pruning | **expected** — 99.90% pruned; found a false `unchanged` I had written into whitespace handling (journal 0005) |
| M4 | B1+B4+B5 | Score the corpus | **expected after repair** — 30/37 on first run, 37/37 after five fixes, all five real defects (journal 0006) |
| M5 | B4+B6+B7 | Persistent harness; settle B6; score `chromium`; compare profiles | **expected after repair** — 31/39 on first run, 39/39 after four fixes, all four real defects, one fix backed out for producing a false `unchanged` under `jsdom` (journal 0007) |
| M6 | B8 | Stop rinsing; detect and attribute cross-pollution | **expected** — 3.5× faster; found that `:root` tokens never reached any subject under jsdom, so the token band was inert on the cheap tier (journal 0008) |
| M7 | B9 | Separate reflow from repaint; component roles; cross-subject docket | **expected** — see journal 0009 |
| M8 | B10 | Intent, policy, adjudication (spec §7.2); ADR-0010's two environment keys | **expected** — `rebrand` and `rebrand-with-accident` change the same 14 screenshots and adjudicate differently |
| M9 | B10 | `locate` and `source` — landmark orientation, component→file by reading the repo | **expected, and its conclusion was wrong** — `_debugSource` is indeed gone in React 19, from which this read "per-element source is a plugin story nothing tells". The transform still emits the location; React 19 is what discards it, and a runtime standing where React's resolves keeps it. Corrected by B22 ([journal 0020](journal/0020-the-line-that-wrote-it.md), [0021](journal/0021-underneath-rather-than-in-front.md)) |
| M10 | B11 | Raster phases, durable/ephemeral retention (ADR-0011), MCP surface | **mixed** — the offload works and the ranking did not; area measures displacement, so the ordering now comes from the semantic tier (journal 0013) |
| M12 | B13 | Cut packages by requirement rather than by feature; group `core`; enforce the rule as a test | **expected, and it found drift** — `raster` was four requirements in one box; four packages imported test-time requirements they never declared, which works in a workspace and breaks on a standalone install |
| M11 | B12 | Answer the three objections in the README; settle what history records and where it lives | **refuted, then settled** — the pixel-count ledger was built and killed by its own measurement (1px → 4949px); the local-file design was killed by the merge argument. What replaces both is now ADR-0018 and the history spec; the code landed later and reaches nobody |
| M13 | B14 | Run a real `@playwright/test` against a corpus declared first; ask what an import costs | **expected, and it corrected us twice** — 35/36 assertions on the first run; `toHaveScreenshot` does measure across a size mismatch in 1.62, where the scenario was declared as a refusal to, and attribution named `Indicator` where `Toolbar` was predicted (journal 0014) |
| M14 | B14 | Write the collector `cases/storybook-case` was missing and run the CLI over a real Storybook | **mixed, and the most productive move so far** — the workflow closes (new → accept → unchanged → 5 of 8 changed on a one-component edit, with the right five), and the first execution found five defects no unit test could reach. Three made durable mode unusable: the run never exited, `stabilization` was dropped by the identity codec so `accept` and `run` keyed on different digests, and the refusal that resulted named the same machine on both sides (journal 0014) |

| M15 | B15 | Split `a11y` and `content` out of `geometry`, rank bands once, and score the corpus's own band declarations | **expected, and the scoring is what paid** — five corpus cases changed band and no test noticed, because the declared band asserted nothing anywhere. Scoring it found that the differ reported a list rotation as five changed strings, which `reorder/list` was written to catch and could not: its assertions were the verdict and the root count, both correct while the report is useless |
| M16 | B15 | `inspect` — five rules over one snapshot, so a defect present on the first run is reported rather than approved into the baseline | **expected, and it found the bug it was written to catch** — `<button><span aria-hidden="true">↻</span></button>` was named "↻", because name-from-content read `textContent`. The case did not notice for a session, because it reads a prebuilt bundle; it now refuses to run against one older than its inputs |
| M17 | B15 | `compareLocales` — untranslated strings and boxes that stopped fitting, across two renders of one subject | **corrected twice by its own measurement** — the first run found nothing, because the rule read text nodes and the forgotten string was a `title`; and at 420px German fits, so whether a translation fits is a property of the container as much as the translation. `matchTrees` cannot be reused: it keys on the accessible name, which is exactly what a translation changes |
| M18 | B15 | A second `provenanceOf`, reading `data-*` — 25 lines, no framework in the process | **expected, and it found two defects neither in the new code** — every plain `<section>` blew the stack on a `roleOf`/`accessibleName` mutual recursion, and a `prop` root labelled `Panel → Button` was attributing to `Button` in the per-component roles the report prints, sending a reviewer to a file nobody edited |
| M19 | — | Read all nine specs against the code, correct what drifted, then empty the directory of everything that ships | **mixed, and it found one MUST with no code behind it** — the locale spec required an uncompared count that did not exist, so a subject whose tree diverged reported *fewer* findings and read as the cleaner one. The CLI spec named five of six commands; Linux verification said `not built` with a Dockerfile in the tree that could not have run its own contract; CI feedback promised a Bitbucket recipe nobody had written. Seven specs discharged into ADRs 0015–0020 and deleted, one deleted without an ADR for forcing no decision; **two remain, and both are genuinely unfinished** |
| M27 | B18 | Answer the route-level ask as an attribution rather than a mode | **expected, and it turned out to already be expressible** — a sensitivity names a place and narrows by band, which is the exact shape `IgnoreRule` accepts *with* a place and refuses without one. So it translates rather than duplicates. What the translation needed was one honest field: `whole`, meaning "the place is the subject", because "no place" and "every place" are the two readings of a missing selector and one of them is the tolerance the mechanism refuses. It is set by `asIgnore` and the config parser does not accept it |
| M26 | B18 | Make the ephemeral mode carry a working history | **expected** — a trail is a value and a pure function over it, so nothing accumulates on disk and the ephemeral contract is satisfied by construction rather than by exception. Steps are snapshots (~7.5 ms) and never images; the render hash is what catches a loop going in circles, which no two-element comparison can see. Its blind spot is stated: `RenderDocument.assets` is optional and unfilled, so an image swapped behind an unchanged URL moves no hash here |
| M25 | B17 | Fix acquisition so the image is of the page that was acquired | **expected, and it moved every baseline** — ADR-0028. One walk upward. The flagship story went from a 1024-wide photograph of a layout that exists nowhere to a 148-wide one that matches the 147.33 the page laid out. It also found a test passing for a reason that had stopped being true: `:root` matches `<html>`, so the token rule now *ships* rather than being flattened into the inherited floor, and `examples/todomvc`'s "stripping `inherited` deletes the colours" assertion had quietly become vacuous |
| M24 | B16+B17 | Put six adversarial lenses over the staged ignore and cause work, each finding verified by an independent refuter | **expected, and the yield says something about the review that preceded it** — 22 defects confirmed, 6 high, in code that had passed `yarn verify` and a hand review. Four were the exact failure the ignore mechanism exists to prevent: a shape ignore absorbing a change 100× larger than the one it was written for, a `select` rule scoped to one route silencing its element in every subject, `until` never applying to shape rules at all, and a marked wrapper being deleted by wrapper collapse so the exclusion evaporated. Two more had the report *asserting the opposite of what the run did* — the ledger printing `[expired]` over a rule that was still absorbing, and calling every rule dead on any run that compared nothing. The most useful finding refused its own fix: extending `LAYOUT_OUTPUT` with the eleven leaking properties was tried and measured to break the headline case, because for those the computed value *is* the authored one |
| M23 | B17 | Ask why the flagship case still named `Tokens` after the hashes landed | **mixed, and it was two defects wearing one symptom** — `Tokens` wraps `Button` and measures *byte-identical* to it, so the containment join had no tighter box and broke the tie in document order, which is always the wrapper. One character (`<` → `<=`). Behind it, the larger one: the run also found the image is 1024 wide where the page is 147.33, so the whole coordinate conversion is between two layouts. Fixing the tie made the case name `Button` at `Button`'s file; the frame defect is detected and unfixed |
| M22 | B17 | Make the durable path rank by cause: carry the previous document's component hashes in the baseline sidecar | **expected, and the measurement is what paid** — the wiring was small and the first real consumer of `hashComponents` found the hashes were wrong for this purpose. One padding edit named every enclosing component, because `transform-origin` computes to half the border box on every element. `width`/`height` were the suspects and were not the cause; discharged as ADR-0027 |
| M21 | B16 | Answer the one thing every competitor has and this did not: a way to say *this is not the subject* | **expected, and the design work was in what it refuses** — a rectangle and a bare band are both refused, so an ignore names a subtree or a difference shape and nothing else; the shape form carries the component responsible, which no pixel fingerprint can. Found two things while wiring it: `changedPixels` had to become *net* of exclusions or a masked subject reads as one that barely moved, and a per-rule breakdown had to exist on every observation *including at zero*, because a field that vanishes when nothing was absorbed cannot report the state that matters |
| M28 | B19 | Join the suite's examples to each other on the components they share, and ask what explains each movement | **mixed, and both corrections were in what the join is allowed to claim** — it reported **11 divergences** on `examples/todomvc` and all 11 were false, because `digestableProps` excludes `children`, so a props digest is not a statement of inputs; three refusals later the answer is **0**, which is correct (ADR-0034). And the first graph recorded only enclosure, which on real code names layout primitives: every `Chip` is `within: Stack` and `createdBy: TodoFooter`, so an edit to `src/app/todo.tsx` explained nothing until the ladder read authorship first (ADR-0033). The census has 8 components and `TodoApp`/`TodoHeader`/`TodoList`/`TodoFooter` — the four files a reviewer opens — are in none of them. **21 echoes, every one crossing a subject boundary**, and the unrequested finding: the three `ds/button--*` stories echo into the application not at all, so the design-system examples guard a component whose real usage they never touch (journal 0017) |
| M29 | B22 | Ask what it would take to activate source *only for Variance*, altering no production code at all | **expected, and the answer had already been measured and set aside** — journal 0021 recorded `_debugStack` as "the thing that was measured and not shipped", so this move is mostly the cost of not believing a measurement the first time. Two things it corrected on the way in: React 19 captures the stack in `createElement` as well as `jsxDEV`, so the mechanism reaches hand-written elements and the classic transform, not only what a JSX transform touched; and Node applies source maps to `Error.stack` itself, so a frame read under Vitest arrives already original and the map hop is a browser problem only. The proof is a React app in a temporary directory whose `vite.config.mjs` is `export default {}`, and the two things it cost were neither about React nor about maps — `os.tmpdir()` is a symlink on macOS and Vite resolves its own root, and a cold dev server navigates twice while it prebundles (journal 0022) |
| M30 | B23 | Answer *what does this change reach* from the source, and make a second scan cost the diff | **expected, and the measurement moved the design** — the first shape cached parses by content digest, which is the obvious move and leaves three quarters of the warm cost on the table: parsing was never the expensive half, resolution was. Caching the *edges* needs a key that survives the same bytes resolving differently, and that key is a digest over the repository's path set — so `./later` resolving to nothing yesterday and to `src/later.ts` today is a cache miss rather than a wrong graph, which is the one test that had to exist end to end. Two corrections on the way: `git ls-files -s` reads the index, so an unstaged edit would carry a stale digest — the unforgivable error here — and the scanned directories had to be *left out* of the layout digest, or a narrower run would discard a wider run's records every time |
| M20 | — | Build the product half — a self-hosted review backend on the operator's own D1 and R2 | **expected, and the interesting part was what it may not do** — the review surface promotes a candidate the run already uploaded and cannot render one, which forced the build to carry each candidate's document digest and identity rather than only its pixels (ADR-0021); the store joined `parity.test.ts` as a fourth backend and reached every pinned verdict, so ADR-0016 now holds across a *split* pair as well as three whole ones. **Nothing has been deployed** |

---

## Open links

- **The ignore register answers for one run, and Argos's answers for a hundred.**
  What each rule absorbed, and which absorbed nothing, is computed and printed per
  run. The question an operator actually asks — *how many builds has this ignore
  absorbed nothing in* — needs the same accumulation B12 needs and reaches the
  same wall: nothing is recorded across runs. The ledger is the shape the rows
  would take, and no row has ever been written.
- **No ignore has met a real flake.** The mechanism is measured against
  constructed masks, hand-built PNGs and a jsdom document: a square inside a box,
  a square straddling it, a square that moved. Whether a real CDN avatar or a real
  carousel produces a *stable* fingerprint across runs of a real suite is the
  claim that matters and the one nothing here tests. The failure mode if it does
  not is benign — the rule stops absorbing and is reported dead — which is why it
  shipped at this evidence level, and it is still unmeasured.
- **Band cardinality — a policy decision, no longer a modelling gap.** Under
  `chromium` every `token`-band change that alters a component's size is reported
  as `geometry`, because `dominantBand` returns the worst band present (4 cases,
  journal 0007), so a project blocking on `geometry` blocks on every padding
  change. B9 supplies the missing distinction as a second axis rather than by
  changing the bands: `impact` says whether a change can *move* anything, so
  "spacing token" is now `band: token, impact: layout` and "colour token" is
  `band: token, impact: paint`. What remains open is which of the two a policy
  should gate on — that is spec §7.2's business, not the differ's.
- **Profile skip order** (ADR-0002). Measured: a warm `chromium` capture is 7.5 ms,
  not the ~100 ms the ADR's tier table assumed. The gap between the two semantic
  tiers is ~5×, not ~100×, so "skip chromium on a jsdom hit" buys much less than
  the table implies. Still undecided, now with a number.
- **`dialog-open/dialog`** is the only remaining contested case: the subject
  boundary for portalled content is a real open question, not a per-profile one.
- **Two machines now, and the second one refuted something on its first run.**
  `docker/linux-verify.sh` executed for the first time on 2026-08-03, native
  arm64, Node 24. **ADR-0010 survived** — every semantic verdict agreed, and no
  cross-platform divergence appeared in any band. What did not survive is the
  `texture` band's *evidence*: the `text-smoothing` probe perturbs
  `-webkit-font-smoothing`, which only macOS implements, so on Linux both renders
  are byte-identical and the probe measures 0 changed pixels. The band is not
  wrong and rasterization really does vary across machines; what this repository
  had was a simulation that only works on the machine that wrote it — journal
  0008's fixture convenience, arriving in the pixel corpus. Real evidence needs
  two machines rendering one page, and now that there are two, nothing yet does.
- **The review backend has never met Cloudflare.** `@variance-authority/tribunal` is verified against real SQL through `node:sqlite` and an in-memory bucket — the schema, the append-only triggers, the promotion path, the routes and every refusal. What that cannot reach is the platform: whether D1's `batch` is transactional in the way the history backend's atomicity rests on, object-size ceilings, quotas, `STRICT` tables, and two Workers writing at once. Lineage under concurrency is also weaker than the SQLite backend's, which takes a write lock where two Workers cannot. One `wrangler deploy` against a throwaway account would settle most of it and nothing has run one.
- **The cases have still never run on Linux.** All four case files skipped inside
  the container and said why: `dist/` is excluded from the build context, so
  `incumbent-case` has no page bundle, and `storybook-changed/` is gitignored, so
  `storybook-case` has no second build. The strongest evidence in this repository
  — the head-to-head against a real `toHaveScreenshot`, and the whole CLI over a
  real Storybook — is exactly the part a second machine has not seen. Building
  both inside the image is the fix and nothing does it.
- **`observePair` over the wire was broken on Node 24, and is fixed.** The
  failure was `RequestInit: Expected signal ("AbortSignal {}") to be an instance
  of AbortSignal` — two `AbortSignal` realms meeting at `fetch`, because a jsdom
  test environment installs its own DOM globals over the process's and the newer
  runtime brand-checks the signal it is handed. jsdom is the environment this
  package exists for, so the fix is in `packages/remote/src/transport.ts` rather
  than in the test: the signal is used when the runtime accepts it and the
  deadline is raced when it does not, demoted once per process. What that costs is
  stated where it happens — on the fallback the request is abandoned rather than
  cancelled, so the socket lingers.
  `examples/todomvc/src/offload.chromium.test.tsx` now passes on **Node 26**,
  including the byte-identical-over-a-socket assertion. **Node 24 itself is still
  unrun here** — the machine has 22 and 26 — and `check.yml` now runs a `[22, 24]`
  matrix rather than a single pin, which is the gap that let this hide.
- **One machine.** Every rect and the 27× ratio come from one mac, one Chromium.
  Fonts enter the environment key as a caller-supplied string rather than a
  content hash, so a second machine could render different geometry and the key
  would not say so.
- **Corpus validity beyond ourselves.** One corpus, built by us. Both profiles now
  agree on it, which proves the two collection paths implement one ruleset. It
  does not prove the ruleset holds on someone else's component library. Sharpened
  by journal 0008: the corpus applies token overrides *inline on the subject
  root*, which routed around a hole where `:root` tokens reached nothing — a
  fixture convenient in the same way the implementation was convenient tested
  nothing. Narrowed, not closed, by `cases/` — the *inputs* there are authored by
  Storybook and by Playwright, but the components are still ours.
- **Replacement is measured against one comparator.** `pixelmatch` at
  Playwright's defaults, on eight scenarios we chose, on one machine. It is the
  differ behind most of the ecosystem, which is why it was picked, and it is
  still one. The hosted products are not confronted at all: their review UI,
  approval workflow, cross-browser grid and repository-scale change detection are
  outside anything here, and the one claim that carries to them — a comparison of
  images cannot see a change that never reached a pixel — is an argument from
  shape rather than a measurement.
- **An imported baseline forfeits two things, and nothing tracks which subjects
  are affected.** A foreign PNG states no identity, so `incomparable` is
  unavailable; it is not a document, so ranking falls back to area, which journal
  0013 measured as backwards. "Import, then let the generation age out" is the
  right shape and no generation is recorded anywhere.
- **Module-level state is outside the session probe.** A singleton store or
  cached client cannot be seen. Confirmation catches the symptom; attribution
  correctly reports no culprit.
- **The docket has never seen a real change set.** `buildDocket` aggregates roots
  across subjects and is tested on constructed diffs. No repository has been run
  through it, so "one token, 300 collateral, one action" is demonstrated at 3
  subjects, not 300.
- **Ranking rests on one measurement.** `rankRegions` fixes an ordering that area
  gets backwards, on one mutation and one story. The finding is solid; the
  generality is not measured.
- **The durable path ranks by cause now, and the fix found a defect in the
  hashes it rests on.** A stored baseline carries the component hashes of the
  document that painted it (ADR-0027), so `causesBetween` names the components
  whose own content moved and `rankRegions` takes its ordering from that instead
  of from area. What made it work was a measurement rather than the wiring: the
  first real consumer of `hashComponents` found that one padding edit inside
  `Button` named `Tokens`, `Stack`, `Card` and the unattributed root as causes,
  because under a layout engine `transform-origin` computes to half the border
  box and therefore moves on every element whose box moves. `width` and `height`
  were the obvious suspects and, measured, were not the ones doing it. Those
  properties now hash into `geometry`; `cases/storybook-case` names `Button` and
  nothing else. **Two halves remain open**: `observePair` carries one snapshot so
  the ephemeral mode still cannot compare hashes, and `tribunal`'s sidecar table
  has explicit columns, so a baseline stored there drops the field and ranks by
  area until a migration adds it. Both degrade to the previous behaviour rather
  than to a wrong one.
- **A component hash is named for the enclosure and a region for its author, and
  five allowlisted properties still leak.** `causesBetween` keys on `owners[0]`
  (ADR-0018) while `AttributedRegion.component` is `createdBy` (ADR-0007); the two
  diverge wherever an element is passed as a prop, and a one-sided match found
  nothing and silently reverted to area. Regions now carry both names. Separately,
  `LAYOUT_OUTPUT` still misses percentage `padding-*`, `auto` `margin-*`,
  edge-anchored `top/right/bottom/left` and percentage `transform`: each computes
  from the box and moves when a descendant resizes, so a component using one can
  be named a false cause. Adding them to the list was measured and is *worse* —
  with `padding-*` on it, a padding edit inside `Button` stops naming `Button`.
  The fix is per-value rather than per-property and belongs in `resolveStyle`,
  which is the only place holding both the author's declaration and the engine's
  override. Unbuilt. The failure is a false cause and never a missed one.
- **The photographed page is the acquired page now (ADR-0028), and it re-based
  everything.** `applicableCss` walked down from the subject and never up, so a
  rule matching `body` or an ancestor never reached the render while `frameOf`
  still shipped their attributes — a Storybook preview centring its story painted
  the subject full-width instead. Measured at **1024** device pixels against an
  acquired subject **147.33** CSS wide; the same story now reports `136×76 to
  148×82` and `subject-size-diverged` is silent. Every `documentDigest` moved, so
  every stored baseline reports `new` — chosen over a compatibility flag, because
  the old images are of a page that never existed. What is still not reproduced:
  an ancestor's inline style and its shadow content, and ancestors carry no
  `data-va-path`, so `verify` cannot re-test a frame rule the way it re-tests a
  subject rule.
- **Regions in the space between boxes report `unattributed`.**
- **Component names do not survive a minified build.** React reads a display name
  off the function; a production bundler renames it; attribution then produces a
  complete, confident report naming `a`. `keepNames` fixes it, nobody would guess
  it, and nothing detects it — a report full of one-letter components is
  indistinguishable to the tool from a project whose components are called that.
- **The acquired document is not proven faithful.** It paints something with the
  subject's geometry that responds to its styling, over a socket, byte-identically
  — which is enough to offload and is not the same claim as "the image matches the
  page it was acquired from".
- **The documentation is checked now, and one class of it still is not.**
  `tools/docs-links.check.ts` resolves every link, every backticked repository
  path and every `file:line` reference across all 176 markdown files, and compiles
  every README `ts` example against the built `.d.ts` with no unused import. It
  found that **11 of the 20 examples did not compile** — wrong arity, options
  that were renamed, a field that no longer exists — which is what a reader was
  copying. What it deliberately does not *compile* is a fence in a spec or an
  ADR: those are proposals about code that may not exist. Their type references
  are checked, and so now is any block that lists the CLI's commands against the
  binary — which found the CLI spec naming five of six. What still passes unread
  is a spec's ordinary prose: a behaviour paragraph can describe a field that does
  not exist, which is exactly what the locale spec's uncompared count was for a
  whole branch.
- **The layout is checked, the *naming* is not.** `tools/boundaries.check.ts`
  proves every import is declared and that adopter-facing code names one package
  (ADR-0024, which retired the one-owner rule). Nothing
  proves a package's name still describes what it needs — `store` could grow a
  socket and only a reader would notice.
- **The MCP layer has never served a real agent.** Seven tools shaped by argument
  about what an agent needs, tested against text rather than against use.
- **The component graph has never seen a real change set.** Every attribution in
  B19 is measured by handing `attributeMovement` a declared file list; no
  `--since` against a repository's own history has produced one. The two rungs
  that need it — `edited` and `token` — are therefore exercised by construction
  rather than by use, and a run without a change set degrades to `upstream`,
  `contradicted` and a shortlist entry that says so.
- **A production build loses the rung that works.** `createdBy` is React's
  `_debugOwner` and is absent from a minified bundle, so the ladder falls back to
  enclosure — which is where it was before ADR-0033 — and the artifact records no
  build mode, so an empty list is indistinguishable from a component genuinely
  mounted by nothing. Both readings are printed and neither is verified. Same
  family as "component names do not survive a minified build", and the same fix
  would not help: `keepNames` preserves names, not owner links.
- **The shortlist has no consumer inside the run.** An unexplained movement is
  ranked by how much control the suite has over it, and `variance run --flakes`
  still reads every subject in plan order. A person or an agent spends the
  shortlist; nothing points the sweep at it. A vacancy, not a decision.
- **Divergence refuses more than it can count.** The three checks in
  `divergencesOf` trade a measured 100% false-positive rate for a false-negative
  rate nobody here can measure: a component whose two renderings genuinely
  disagree *and* mount different subtrees is refused by the third rule and
  nothing counts it (ADR-0034).
- **The font probe reports metric-compatible substitutes as missing.** A false
  alarm rather than a false `unchanged`, and the same hole as "one machine".
- **Nothing accumulates across runs, and it is no longer for want of code.** Spec
  §5 has promised per-component change frequency since the draft; ADR-0018 and
  [the history spec](../specs/0002-history-store.md) say what to record and where
  it lives, and **both are implemented** —
  `hashComponents` in `core/attribute`, the rows and drift arithmetic in
  `@variance-authority/history`, the socket in `@variance-authority/server`. What
  does not exist is a caller: `variance run` records nothing, so every one of those
  is exercised only by its own unit tests. The README's third answer is still half
  built, and the missing half moved from "write it" to "wire it".
- **The README makes claims about deployment nothing has exercised.** Linux CI,
  git-LFS artifacts, a CI bot committing images back — all stated as intent and
  marked as such, none run once.
- **Inspection has run against nothing anybody else wrote.** Nine rules, each
  with a non-firing case, and `cases/storybook-case` reports 0 findings across 8
  subjects — a real answer about that design system, not a measurement of the
  rules. Whether the list should grow is *settled* rather than open (ADR-0015:
  a rule belongs here if a stored snapshot can decide it, which excludes
  contrast, focus order and motion, with reasons in the file). What is open is
  whether the nine hold up outside this repository.
- **`untranslated` reports candidates, not defects.** A brand name, a product
  code and an acronym are all "identical in both languages". The sentence says so
  in both directions and the rule skips strings with no letters, which is as far
  as a document can get without a catalogue to join against. Joining against the
  actual message catalogue — the ids, not the values — is the thing that would
  make it exact, and no format for that has been decided.
- **No corpus case constructs a provider-backed `prop` root.**
  `prop-primary-variant/hero` was written for it and does not: Hero *forwards*
  `p.props.heroPrimaryVariant` from the fixture rather than deciding it, so the
  props arrive from outside the subject and no component inside it is
  responsible. `Root.cause` is therefore set only where a provider exists, and
  the only thing asserting that path is `packages/dom/src/attributed.test.ts`.
  A fixture where one component decides what another receives would close it.
- **No real `nx` or `turbo` has ever answered.** Both seams run a real subprocess
  against a shell script standing in for the tool, which is the right test for the
  seam — which binary is found, what happens to the progress lines they print
  around their JSON, and that a failure can never produce the empty list that means
  *this diff crosses no package boundary*. What it does not test is the JSON either
  tool actually emits, or that `--filter=...[base]` scopes what this assumes it
  scopes. That needs a real monorepo with one of them configured.
- **The graph has never selected a real run.** `source.relations` is exercised by
  unit tests over constructed records and by a scan of this repository, and no
  suite has been narrowed by it against a real change set. The failure mode is
  benign by construction — every uncertainty widens — which is why it shipped at
  this evidence level, and the number that matters, *how much of a real suite it
  actually skips*, is unmeasured.
- **A tag change is a replacement.** `matchKey` never pairs an element whose tag
  moved, so `<div>` → `<section aria-label>` reports a removal and an addition
  rather than a `role-changed`, and the `a11y` band does not carry it.
  `as-region/card` declares `geometry` for that reason with the limit attached.
  Pairing across a tag change needs a similarity heuristic nothing here has.

---

## Next

Two open fronts, and they are independent.

**History (B12) has a caller now, and what is left is a run rather than code.**
The wiring landed on 2026-08-10: a run records itself, the hashes that moved and
every subject that failed to read the same way twice, then asks the record how
often that has happened before (ADR-0031, ADR-0032). The eleven-run journey the
spec is named for has still never been produced against a real project — eleven
runs, eleven approvals, and the sentence at the end of them — and `reach` is
half answered, by B19 at one commit and by nothing across two.

**Composition (B19) is landed and its shortlist has no consumer.** An
unexplained movement ranks the subjects worth reading twice, and `--flakes`
still reads in plan order; pointing it at the ranking is a change to `again.ts`
that nothing has made. Behind that, the larger one: the graph has never met a
real change set, so the two rungs that need `--since` are exercised by
construction. Both are cheap. The expensive question is whether eight components
in one application generalizes at all.

**The trail has no live session to run in.** `variance serve` reads a report and
never renders — the same refusal `variance report` takes, argued at length — so an
agent cannot yet hold a trail and observe again through it. Everything the loop
needs exists as values and pure functions; what is missing is a boundary that may
observe, and adding one inverts a stated position rather than filling a gap. That
is a decision, not a task.

**The commit tap (B20) still has no collector.** Suspense does — every page agent
waits, and refuses a subject read mid-arrival (ADR-0037) — but `tapCommits` is an
export `settle()` has never called, and the obstacle is the one that decides the
answer: the tap must be installed before `react-dom` loads, which is exactly what
a collector navigating to somebody else's page cannot promise. An unattached tap
refuses by design, so wiring it in as it stands would refuse every subject on
every page reached too late, and refusing on that is not the same claim as
refusing on a boundary that is genuinely open. What it needs is a way to install
before the app — an init script on the context, which both drivers have and
neither uses for this — not a policy decision.

**The sixth band is collected by nobody (B21).** `collect()` accepts `wiringOf`
and the example passes it; no shipped collector does, so every real subject is
absent from the band rather than wired-and-empty. That is one line per collector
and one decision behind it — whether a subject read without a framework adapter
should say so in the report — and the remount finding needs a place to be printed
before it can be acted on. The collectors now reach into `@variance-authority/react`
for the Suspense wait, so the dependency that would have carried this is already
there.

**Selection now has two answers and stores neither (B23).** The graph is wired,
`--since` walks it, and `nx`/`turbo` seed it. The digest beside it is built, tested
and consulted by nothing, because a closure digest is only meaningful against an
earlier one and no baseline carries one — so a run still inherits every way a
shallow clone, a rebase or a wrong `--since` ref can shape a diff. That is
[0026](../specs/0026-selection-by-closure-digest.md), and it is a sidecar field and
a lookup rather than a decision. The other half is
[0025](../specs/0025-component-relations.md): components are nodes with one edge
kind reaching them, so *where does `Button` appear* is answered through files, and
a barrel file makes everything reach everything.

**Generality remains unmeasured.** One corpus, one mutation behind the ranking,
one machine behind every ratio, and an MCP surface nothing has used. The cheapest
thing that would move any of those is running the whole chain over a repository
that is not ours.

**Band cardinality** remains where B9 left it — a policy decision about which
axis to gate on, not a modelling gap. B15 narrows it: `a11y` and `content` are
now their own bands, so "block on `geometry`" no longer means "block on every
padding change *and* every dropped label *and* every copy edit".

**The corpus scores blame now, and scoring it found two more defects.** Every
`hash-changed` case declares `blames` — the name the report puts in front of a
reviewer — and both measure harnesses assert it under both profiles, because
which component is responsible is a fact about the code and a profile is a fact
about the observer.
