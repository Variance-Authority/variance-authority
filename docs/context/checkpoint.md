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
| B13 | **the boundary** — what a package is, and what an entrypoint costs | landed; ADR-0013, enforced by `tools/boundaries.test.ts` |
| B14 | **replacement** — what a case is, and whether an incumbent can actually be left | landed and measured against a real `toHaveScreenshot`; three rows no threshold reaches, one row we lose |
| B15 | **limbs** — what a run knows with no baseline at all: bands split, inspection, locale, provenance without React | landed and measured; four capabilities and six defects, every one of them found by writing the capability rather than by looking for the defect |
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

---

## Open links

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
- **The cases have still never run on Linux.** All four case files skipped inside
  the container and said why: `dist/` is excluded from the build context, so
  `incumbent-case` has no page bundle, and `storybook-changed/` is gitignored, so
  `storybook-case` has no second build. The strongest evidence in this repository
  — the head-to-head against a real `toHaveScreenshot`, and the whole CLI over a
  real Storybook — is exactly the part a second machine has not seen. Building
  both inside the image is the fix and nothing does it.
- **`observePair` over the wire is broken on Node 24.** `offload.chromium.test.tsx`
  fails to collect with `RequestInit: Expected signal ("AbortSignal {}") to be an
  instance of AbortSignal` — two `AbortSignal` realms meeting at `fetch`. It is a
  runtime finding rather than a platform one: the image ships Node 24 and
  `check.yml` pins Node 22, so nothing else here has met it. Unfixed, and it means
  the remote renderer is untested on the newest runtime.
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
- **The durable path cannot rank at all, and this is now demonstrated rather than
  suspected.** Separating cause from collateral needs the previous revision's
  *snapshot*; `observeAgainstBaseline` has a baseline **image** and no snapshot,
  so `variance run` reports every region as `collateral` and orders them by area
  — the ordering journal 0013 measured as backwards. The first real CLI run over
  `cases/storybook-case` names `Tokens`, the wrapper the edit displaced, where the
  edit was to `Button`. **`observePair` does not fix this either, and the
  earlier claim that it did was wrong.** It carries a single snapshot and calls
  `attributeRegions` and nothing else — it never reaches `rankRegions`, so it
  attributes and stops. Cause-first ordering happens only where `core` is
  composed by hand with *two* documents: `examples/todomvc`'s observe test and
  the two `incumbent-case` suites, all of which supply `causes` themselves.
  Carrying a semantic baseline beside the image is the fix and nothing does it.
- **Regions in the space between boxes report `unattributed`.** A gap produced by
  `Stack`'s `gap` is inside `Stack` and inside no child, and comes back as "a
  region no box contained, which usually means the scale or origin was wrong" —
  a sentence that sends the reader after a bug that is not there. 3 of 4 regions
  on one story of the first real run. Whether a parent should claim its own gaps
  is a real question about what attribution means, not an obvious fix.
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
  `tools/documentation.test.ts` resolves every link, every backticked repository
  path and every `file:line` reference across all 68 markdown files, and compiles
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
- **The layout is checked, the *naming* is not.** `tools/boundaries.test.ts`
  proves every import is declared and every requirement has one owner. Nothing
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
