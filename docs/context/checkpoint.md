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
| B12 | **history** — what accumulates across runs, and where it lives | **built, wired to nothing, and blocked on a contract decision** ([what is left](../specs/0002-history-store.md)): the hashing (ADR-0018), the rows, the drift arithmetic and the service all ship; no run calls any of them, and the wire has no read that would let one. First implementation refuted and retired ([epitaphs](epitaphs.md)) |

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
| M9 | B10 | `locate` and `source` — landmark orientation, component→file by reading the repo | **expected** — `_debugSource` is gone in React 19, so per-element source is a plugin story nothing tells |
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
  path and every `file:line` reference across all 99 markdown files, and compiles
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
- **The MCP layer has never served a real agent.** Five tools shaped by argument
  about what an agent needs, tested against text rather than against use.
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
- **A tag change is a replacement.** `matchKey` never pairs an element whose tag
  moved, so `<div>` → `<section aria-label>` reports a removal and an addition
  rather than a `role-changed`, and the `a11y` band does not carry it.
  `as-region/card` declares `geometry` for that reason with the limit attached.
  Pairing across a tag change needs a similarity heuristic nothing here has.

---

## Next

Two open fronts, and they are independent.

**History (B12) is built and wired to nothing, and the next step is a decision
rather than code.** What is recorded and where it lives are settled — ADR-0018 and
[the history spec](../specs/0002-history-store.md) — and both have code:
`hashComponents` ships in `core/attribute`, and
`@variance-authority/history` and `@variance-authority/server` implement the rows,
the drift arithmetic and the service. What is missing is the only part that was
ever the point — **no run calls any of it.** `variance run` records nothing, so no
row has ever been written by a run and the per-component hashes have never been
compared across two of them. The next step is not more implementation; it is a
consumer path, and until one exists "the hashing moves only when the component's
own code moves" is asserted by a unit test and by nothing else.

**The trail has no live session to run in.** `variance serve` reads a report and
never renders — the same refusal `variance report` takes, argued at length — so an
agent cannot yet hold a trail and observe again through it. Everything the loop
needs exists as values and pure functions; what is missing is a boundary that may
observe, and adding one inverts a stated position rather than filling a gap. That
is a decision, not a task.

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
