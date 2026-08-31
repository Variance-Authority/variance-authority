/**
 * The two panes a build is worked in: the docket rail, and the change beside it.
 *
 * Its own module for the same reason [`styles-stage.ts`](./styles-stage.ts) is:
 * the sheet is one string handed to an operator, and the number of rules a person
 * has to hold at once to change one of them is a real cost. What is decided here
 * is *where a reviewer's eye goes first*, which is a layout question with a
 * correct answer — the band headings and the row a change occupies, above the
 * fold, in a column that does not grow with the build.
 *
 * The rule that matters most is the least visible one: nothing in this block
 * scrolls the document. The rail scrolls through the changes, the stage scrolls
 * through the one that is open, and the page itself is fixed to the viewport. A
 * surface where the document scrolls is a report; a surface where the panes
 * scroll is a place a reviewer navigates.
 */
export const DOCKET_STYLES = `
/* The trail, which is the whole navigation. Five of the seven pages are *about*
   the page above them, and a trail says that where a menu would assert they are
   peers. */
.va-crumbs { align-items: center; display: flex; gap: 0.3rem; min-width: 0; }
.va-crumb { color: var(--va-ink-3); font-size: 0.8rem; text-decoration: none; white-space: nowrap; }
.va-crumb:hover { color: var(--va-accent); }
.va-crumb-sep { color: var(--va-line-firm); font-size: 0.8rem; }

/* Changes or subjects: the two ways to work a build, as two addresses rather
   than as a piece of component state. */
.va-switch { background: var(--va-sunken); border-radius: 9px; display: flex; flex: none; gap: 0.15rem; margin-bottom: 0.5rem; padding: 0.2rem; }
.va-switch .va-mode { flex: 1; text-align: center; text-decoration: none; }
.va-switch .va-mode.va-on { background: var(--va-accent-soft); color: var(--va-accent); font-weight: 650; }
.va-switch .va-mode.va-off { color: var(--va-ink-3); cursor: not-allowed; }

.va-rail-head { align-items: center; display: flex; flex: none; flex-wrap: wrap; gap: 0.4rem; padding: 0 0.15rem 0.5rem; }
.va-rail-tally { color: var(--va-ink-3); font-size: 0.76rem; margin-right: auto; }
.va-rail-empty { padding: 0.6rem 0.15rem; }
/* The scrolling half. \`min-height: 0\` is what keeps it scrolling rather than
   pushing the rail past the bottom of the window — a flex child's default
   minimum is its content, and a build of forty changes would take the viewport
   with it. */
.va-rail-list { flex: 1 1 auto; min-height: 0; overflow-y: auto; }

/* The orders. Small, and deliberately not a select: four addresses a reader can
   middle-click, which a select cannot be. */
.va-sorting { display: inline-flex; gap: 0.1rem; }
.va-sort { border-radius: 6px; color: var(--va-ink-3); font-family: var(--va-mono); font-size: 0.66rem; letter-spacing: 0.06em; padding: 0.15rem 0.4rem; text-decoration: none; text-transform: uppercase; }
.va-sort:hover { background: var(--va-sunken); color: var(--va-ink); }
.va-sort.va-on { background: var(--va-accent-soft); color: var(--va-accent); }

/* A band, and the sentence that says why its rows are together. The left edge
   carries the band's meaning: an alarm is red, a decision is green, and the
   ordinary work you asked for is the accent. */
.va-band { border-left: 2px solid var(--va-line-firm); margin: 0 0 0.9rem 0.15rem; padding-left: 0.7rem; }
.va-band h3 { align-items: center; display: flex; font-size: 0.76rem; font-weight: 700; gap: 0.4rem; letter-spacing: 0.05em; margin-bottom: 0.15rem; text-transform: uppercase; }
.va-band h3 .va-num { background: var(--va-sunken); border-radius: 999px; color: var(--va-ink-2); font-size: 0.7rem; letter-spacing: 0; padding: 0 0.4rem; }
.va-band > .va-note { font-size: 0.74rem; margin-bottom: 0.35rem; }
.va-band-stranded { border-left-color: var(--va-bad); }
.va-band-stranded h3 { color: var(--va-bad-ink); }
.va-band-reached { border-left-color: var(--va-accent); }
.va-band-contradicted { border-left-color: var(--va-warn); }
.va-band-contradicted h3 { color: var(--va-warn-ink); }
.va-band-unexplained { border-left-color: var(--va-warn); }
.va-band-unexplained h3 { color: var(--va-warn-ink); }
.va-band-upstream { border-left-color: var(--va-collateral); }
.va-band-token { border-left-color: var(--va-collateral); }
.va-band-unnamed { border-left-color: var(--va-line-firm); }
.va-band-unread { border-left-color: var(--va-warn); }
.va-band-decided { border-left-color: var(--va-good); }
.va-band-orphan { border-left-color: var(--va-warn); }

/* A heading that is a path or a property, not a claim, so it overrides the
   band's uppercase: a name a reviewer uppercases is a name they cannot grep. */
.va-band h3.va-root, .va-root { flex-wrap: wrap; font-family: var(--va-mono); font-size: 0.78rem; font-weight: 600; gap: 0.15rem; letter-spacing: 0; text-transform: none; }
.va-root .va-root-in { color: var(--va-ink-3); font-weight: 400; }
.va-root .va-root-name { color: var(--va-ink); }
.va-root-component .va-root-name { font-family: var(--va-sans); font-weight: 700; }

/* The same cause on the change page: one line under the name, and the other
   changes it made. */
.va-from { align-items: baseline; display: flex; flex-wrap: wrap; font-size: 0.8rem; gap: 0.3rem; margin-top: 0.2rem; }
.va-from-mark { color: var(--va-ink-3); font-size: 0.72rem; letter-spacing: 0.05em; text-transform: uppercase; }
.va-from .va-root { font-size: 0.8rem; }
.va-from-go { color: var(--va-accent); text-decoration: none; }
.va-from-go:hover { text-decoration: underline; }

/* The prediction under a root, and the same claim about the whole build. It sits
   between a heading and the rows it explains, so it is quieter than both. */
.va-foreseen { color: var(--va-ink-3); font-size: 0.72rem; line-height: 1.5; margin: 0.1rem 0 0.4rem; }
.va-foreseen .va-num { color: var(--va-ink-2); font-family: var(--va-mono); }
.va-foreseen .va-from-go { color: var(--va-ink-2); font-family: var(--va-mono); text-decoration: none; }
.va-foreseen .va-from-go:hover { color: var(--va-accent); text-decoration: underline; }
.va-foreseen-off { color: var(--va-warn-ink); }
.va-rail-head + .va-foreseen { margin: -0.2rem 0 0.5rem; }

/* One change, in a row a reviewer scans a column of. The name is the only thing
   at full contrast; everything else on the row is there to be skipped. */
.va-row { margin-bottom: 0.1rem; }
.va-row-link { align-items: baseline; border: 1px solid transparent; border-radius: 8px; column-gap: 0.5rem; display: grid; grid-template-columns: minmax(0, 1fr) auto; padding: 0.35rem 0.5rem; row-gap: 0.05rem; text-decoration: none; }
.va-row-link:hover { background: var(--va-sunken); }
.va-row.va-here .va-row-link { background: var(--va-accent-soft); border-color: var(--va-accent); }
.va-row-name { font-size: 0.88rem; font-weight: 550; grid-area: 1 / 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.va-row-spread { font-size: 0.74rem; grid-area: 2 / 1; }
.va-row-size { color: var(--va-ink-3); font-size: 0.74rem; grid-area: 2 / 2; text-align: right; }
.va-row .va-mark { font-size: 0.68rem; grid-area: 1 / 2; justify-self: end; }
.va-row-from { color: var(--va-ink-3); font-family: var(--va-mono); font-size: 0.7rem; grid-area: 3 / 1 / 4 / 3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* The page with nothing open: four sentences and two links, and no encyclopedia.
   Everything a reader could want past this has an address of its own. */
.va-opening { max-width: 44rem; }
.va-opening h1 { margin-bottom: 0.3rem; }
.va-opening-links { align-items: baseline; display: flex; flex-wrap: wrap; gap: 0.6rem; margin-top: 1.4rem; }

/* The change itself. The two buttons are in the head, level with the component
   name: every line below them is a reason to press one or to refuse, and a
   reviewer who has read them should not scroll back past the reasons to act. */
.va-decide { max-width: 62rem; }
.va-decide-head { align-items: flex-start; border-bottom: 1px solid var(--va-line); display: flex; flex-wrap: wrap; gap: 0.8rem; justify-content: space-between; padding-bottom: 0.8rem; }
.va-decide-head h1 { margin: 0; }
.va-decide-lead { font-size: 1rem; margin-top: 0.8rem; }
.va-decide-act { align-items: center; display: flex; flex-wrap: wrap; gap: 0.55rem; }
.va-decide-act button { font-weight: 600; }
.va-decide-act .va-approve { background: var(--va-good); border-color: var(--va-good); color: #ffffff; }
.va-decide-act .va-approve:disabled { background: var(--va-sunken); border-color: var(--va-line-firm); color: var(--va-ink-3); }
.va-decide h2 { font-size: 0.78rem; letter-spacing: 0.08em; margin-top: 1.6rem; text-transform: uppercase; }

/* Whether the commit arrives, in the three colours the three answers deserve.
   The alarm is spent on one of them and must stay that way: a page that shouted
   over every component out of a dependency trained the alarm out of its readers
   inside a build. */
.va-reaches { border-radius: 7px; font-size: 0.9rem; margin-top: 0.9rem; padding: 0.5rem 0.7rem; }
.va-reaches.va-reached { background: var(--va-info-bg); color: var(--va-info-ink); }
.va-reaches.va-alarm { background: var(--va-bad-bg); color: var(--va-bad-ink); }
.va-reaches.va-unnamed { background: var(--va-info-bg); color: var(--va-info-ink); }

/* The run's own conclusion, above the file graph's. Left-marked rather than
   filled: it sits directly over the reach block, and two filled panels in a row
   read as one panel with a seam in it. The colour is the rung — the two that
   say *the run found nothing* borrow the alarm, and the three that explain
   something do not, because an explanation is not a finding. */
.va-attributed { border-left: 3px solid var(--va-line-firm); font-size: 0.92rem; margin-top: 0.9rem; padding-left: 0.7rem; }
.va-attributed code { font-size: 0.86em; }
.va-attributed-edited { border-left-color: var(--va-accent); }
.va-attributed-upstream { border-left-color: var(--va-collateral); }
.va-attributed-token { border-left-color: var(--va-collateral); }
.va-attributed-contradicted { border-left-color: var(--va-bad); }
.va-attributed-unexplained { border-left-color: var(--va-bad); }
.va-attributed-go { color: var(--va-accent); font-weight: 600; white-space: nowrap; }

/* A band this change did not move on its own. Directly under the lead and
   marked in the collateral colour, which is what it is: the sense moved here,
   the decision is one file up, and the two belong on one screen without the
   second looking like a second change. */
.va-handed { color: var(--va-ink-2); font-size: 0.95rem; margin-top: 0.35rem; }
.va-handed em { color: var(--va-ink); font-style: normal; font-weight: 600; }
.va-handed-go { color: var(--va-accent); font-weight: 600; white-space: nowrap; }

/* The three counts, side by side rather than in a sentence. A sentence has to
   pick an order and an emphasis; these are three answers of equal standing to
   three questions a reviewer asks in the same breath. */
.va-tally { align-items: baseline; color: var(--va-ink-2); display: flex; flex-wrap: wrap; font-size: 0.9rem; gap: 0.15rem 1.1rem; margin: 0.2rem 0 0.9rem; }
.va-tally strong { color: var(--va-ink); font-size: 1rem; }
.va-tally > .va-note { margin-left: auto; }

/* What happened to the things that draw this one — the question an author of a
   leaf actually has. The list is ordered worst first, so the row that needs a
   look is the one under the summary. */
.va-consumers { margin: 1.1rem 0; }
.va-consumers-tally { color: var(--va-ink-2); font-size: 0.92rem; margin: 0 0 0.5rem; }
.va-consumers-own { color: var(--va-bad-ink); font-weight: 600; }
.va-consumers-list { display: grid; gap: 0.3rem; list-style: none; margin: 0; padding: 0; }
.va-consumers-list li { align-items: baseline; border-left: 3px solid var(--va-collateral); display: flex; flex-wrap: wrap; gap: 0.5rem; padding: 0.15rem 0 0.15rem 0.6rem; }
.va-consumer-name { color: var(--va-ink); font-weight: 600; }
.va-consumer-moved { border-left-color: var(--va-bad); }
.va-consumers-rest { color: var(--va-ink-3); font-size: 0.85rem; margin: 0.5rem 0 0; }
.va-consumers-rest span[title] { color: var(--va-ink-2); }
.va-alarm-text { color: var(--va-bad-ink); }

/* What a press of Approve settles that is not the change it is under. Directly
   under the counts, because it is a correction to one of them: the seven renders
   to accept are seven whole pictures, and four of them hold somebody else's
   undecided difference. */
.va-carries { background: var(--va-bad-bg); border-radius: 6px; color: var(--va-ink-2); font-size: 0.88rem; margin: 0 0 0.9rem; padding: 0.4rem 0.6rem; }
.va-carries-go { color: var(--va-accent); font-weight: 600; white-space: nowrap; }
.va-carries-mark { background: var(--va-bad-bg); border-radius: 999px; color: var(--va-bad-ink); font-size: 0.68rem; padding: 0.05rem 0.4rem; }

/* What a band claim is made of. At the foot, because it is the same sentence for
   all of them and a reviewer needs it once — and not behind a disclosure,
   because the complaint that produced it was a page hiding its sources. */
.va-held { border-left: 2px solid var(--va-good); color: var(--va-ink-2); font-size: 0.86rem; margin: 0.6rem 0 0; padding-left: 0.7rem; }
.va-held-mark { color: var(--va-good); font-weight: 600; }
.va-held-none { border-left-color: var(--va-ink-3); }
.va-held-none .va-held-mark { color: var(--va-ink-2); }
.va-held-go { color: inherit; text-decoration: underline; text-decoration-style: dotted; }
.va-evidence { border-top: 1px solid var(--va-line); color: var(--va-ink-3); font-size: 0.8rem; margin-top: 1.6rem; padding-top: 0.6rem; }
.va-evidence em { color: var(--va-ink-2); font-style: normal; }

/* What the last run said, beside the change rather than nine thousand pixels
   below it. Warm rather than red: *you have seen this* is not an alarm, it is
   the sentence a reviewer skips work on. */
.va-since { border-radius: 7px; font-size: 0.9rem; margin-top: 0.7rem; padding: 0.5rem 0.7rem; }
.va-since.va-known { background: var(--va-warn-bg); color: var(--va-warn-ink); }
.va-collateral-note { margin-top: 1.6rem; }

/* Where the renders stopped agreeing. Directly above the list they divide, so a
   reviewer reads the groups and then finds them in order — and the sizes are the
   left column in both, which is what makes the two readable as one list. */
.va-parted { margin: 1.4rem 0 0.6rem; }
.va-parted h2 { margin-bottom: 0.4rem; }
.va-parted ul { display: grid; gap: 0.5rem; list-style: none; margin: 0; padding: 0; }
.va-parted li { border-left: 3px solid var(--va-line); padding: 0.1rem 0 0.1rem 0.7rem; }
.va-parted li:first-child { border-left-color: var(--va-collateral); }
.va-parted-head { align-items: baseline; display: flex; flex-wrap: wrap; gap: 0.6rem; margin: 0; }
.va-parted-head .va-num { color: var(--va-ink); font-family: var(--va-mono); font-size: 0.95rem; }
.va-parted-only { color: var(--va-ink-2); font-size: 0.85rem; font-weight: 600; }
.va-parted-take { background: var(--va-sunken); border-radius: 5px; color: var(--va-ink-3); font-size: 0.74rem; margin-left: auto; padding: 0.1rem 0.4rem; }
.va-parted-in { font-size: 0.8rem; margin: 0.15rem 0 0; overflow-wrap: anywhere; }

/* Where it showed up: one row per render, each decidable on its own, because a
   batch that could only be taken whole would be a batch nobody could refuse
   part of. */
.va-where { display: grid; gap: 0.15rem; margin-top: 0.5rem; }
.va-where-row { align-items: baseline; border-radius: 8px; column-gap: 0.6rem; display: grid; grid-template-columns: minmax(6rem, 15rem) auto auto minmax(0, 1fr) auto; padding: 0.35rem 0.5rem; }
.va-where-row:hover { background: var(--va-sunken); }
.va-where-subject { font-size: 0.88rem; font-weight: 550; grid-column: 1; overflow: hidden; text-overflow: ellipsis; text-decoration: none; white-space: nowrap; }
.va-where-size { grid-column: 2; text-align: right; }
.va-where-row .va-mark { grid-column: 3; }
.va-where-with { grid-column: 4; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.va-where-row .va-note { font-size: 0.76rem; }
.va-where-act { display: flex; gap: 0.25rem; grid-column: 5; justify-self: end; }
.va-where-row > .va-mark:last-child { grid-column: 5; justify-self: end; }
.va-where-act button { border-radius: 6px; font-size: 0.8rem; line-height: 1; padding: 0.2rem 0.5rem; }
.va-where-act .va-approve:not(:disabled) { border-color: var(--va-good); color: var(--va-good-ink); }
.va-mark.va-known { background: var(--va-warn-bg); border-radius: 999px; color: var(--va-warn-ink); font-size: 0.68rem; padding: 0.05rem 0.4rem; }
.va-mark.va-alarm { background: var(--va-bad-bg); border-radius: 999px; color: var(--va-bad-ink); font-size: 0.68rem; padding: 0.05rem 0.4rem; }

/* What moved, in the sense the hashes recorded. The lead sentence is emphasis
   inside the existing lead paragraph and gets no box of its own — it is the
   subject of the page, not a note beside it. What follows is detail, and the
   only part that raises its voice is a component the picture lost: the hashes
   name it and no region does, which is the one state a reviewer cannot see. */
.va-decide-lead em { font-style: normal; font-weight: 600; }
.va-moved-lost { background: var(--va-bad-bg); border-radius: 7px; color: var(--va-bad-ink); font-size: 0.9rem; margin-top: 0.7rem; padding: 0.5rem 0.7rem; }
.va-moved h3 { font-size: 0.72rem; letter-spacing: 0.06em; margin-top: 1rem; text-transform: uppercase; }
.va-moved-with { display: grid; gap: 0.15rem; margin-top: 0.35rem; }
.va-moved-with li { align-items: baseline; column-gap: 0.5rem; display: flex; flex-wrap: wrap; font-size: 0.88rem; }
.va-moved-list { display: grid; gap: 0.3rem; }
.va-moved-row { align-items: baseline; column-gap: 0.5rem; display: flex; flex-wrap: wrap; font-size: 0.85rem; }
/* Pushed rather than edited, and dimmed to say so. The list is ordered by name
   and not by consequence, so without this a passenger reads level with a cause. */
.va-moved-passenger .va-moved-name { color: var(--va-ink-3); font-weight: 400; }
.va-moved-name { font-weight: 600; }
/* How far a passenger is from the change, in the import graph. A chip and not a
   sentence, and only on the rows the records place: a column that says the same
   thing on every row is read once and skipped after. */
.va-moved-far { background: var(--va-sunken); border-radius: 5px; color: var(--va-ink-3); font-size: 0.74rem; padding: 0.05rem 0.35rem; }

/* The commit, its files, and how far out it landed — the build page's own
   section, above the docket rather than beside it, because it is true of every
   change on the page and nothing on it is decided. */
.va-impact { border-top: 1px solid var(--va-line); display: grid; gap: 1rem; margin-top: 1.4rem; padding-top: 1.1rem; }
.va-impact-commit { align-items: baseline; display: flex; flex-wrap: wrap; font-size: 0.9rem; }
.va-impact-files ul { display: grid; gap: 0.1rem; margin-top: 0.35rem; }
.va-impact-files li { font-size: 0.82rem; }
.va-impact-depth h2 { font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; }
.va-rungs { display: grid; gap: 0.3rem; margin-top: 0.5rem; max-width: 34rem; }
.va-rung { align-items: center; display: grid; gap: 0.6rem; grid-template-columns: 7.5rem 1fr auto; }
.va-rung-at { font-size: 0.8rem; text-align: right; }
/* The bar is the reached count and the fill is the moved count inside it, so the
   two are read as a share rather than as two lengths a reader has to divide. */
.va-rung-bar { background: var(--va-collateral); border-radius: 3px; display: block; height: 0.6rem; min-width: 2px; }
.va-rung-moved { background: var(--va-cause); border-radius: 3px; display: block; height: 100%; }
.va-rung-num { font-size: 0.78rem; }
/* The movement the bars cannot hold, which is the one part of the spread they
   are silent about. A list and not a sentence, because each row carries its own
   reason and a paragraph of them is a paragraph nobody finishes. */
.va-unheld { background: var(--va-bad-bg); border-radius: 7px; color: var(--va-bad-ink); font-size: 0.85rem; margin-top: 0.7rem; max-width: 34rem; padding: 0.5rem 0.7rem; }
.va-unheld ul { display: grid; gap: 0.25rem; margin-top: 0.4rem; }
.va-unheld li { align-items: baseline; column-gap: 0.45rem; display: flex; flex-wrap: wrap; }
.va-unheld-name { font-weight: 600; }
.va-unheld-why { opacity: 0.78; }
`;
