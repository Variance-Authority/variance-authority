/**
 * The mark and the page's whole appearance, inline.
 *
 * Split out for size rather than for principle: two hundred lines of CSS
 * between two functions that have to be read together is what makes a renderer
 * unreadable. Everything about *why* it is inline is on `STYLE` itself.
 */

export const MARK =
  '<svg viewBox="0 0 512 320" width="26" height="16" aria-hidden="true">' +
  '<path fill="#f3f4f6" d="M64 54H159L256 266H160Z"/>' +
  '<path fill="#f3f4f6" d="M331 28H419L494 266H397Z"/>' +
  '<path fill="#ff4a19" d="M256 266L202 152L283 28H376L301 165Z"/>' +
  '<path fill="#d83a13" opacity=".72" d="M202 152L256 266L301 165L264 103Z"/>' +
  '</svg>';

/**
 * Inline, because a stylesheet over the network is a page that renders twice.
 *
 * The palette is `docs/visual-guidelines.md` and the type is the site's, with the
 * families falling back to the system stacks rather than fetching a font file —
 * the metrics differ from the marketing page and the identity does not.
 */

export const STYLE = `
:root{
--deep:#181b1d;--panel:#1e2224;--charcoal:#24282a;--hairline:#383e41;
--ivory:#f3f4f6;--warm:#756d67;--quiet:#8f8580;--orange:#ff4a19;--fold:#d83a13;--green:#7fa28c;
--sans:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
--mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;background:var(--deep);color:var(--ivory);font:13px/1.5 var(--sans);
-webkit-font-smoothing:antialiased}
code,kbd{font-family:var(--mono)}
::selection{background:var(--orange);color:var(--deep)}
:where(a,button,summary,input,[tabindex]):focus-visible{outline:2px solid var(--orange);
outline-offset:2px;border-radius:4px}
a{color:inherit;text-decoration:none}
.grow{flex:1}
.nil{color:var(--warm)}
em{font-style:normal;color:var(--warm)}
.px{font-variant-numeric:tabular-nums;color:var(--quiet);white-space:nowrap}
.where{color:var(--quiet)}
.file{font-family:var(--mono);font-size:11px;color:var(--warm)}
.hint{margin-left:.75rem;font-weight:400;font-size:11px;letter-spacing:0;
text-transform:none;color:var(--warm)}

/* masthead */
header{position:sticky;top:0;z-index:20;padding:.75rem 1.25rem .6rem;background:var(--deep);
border-bottom:1px solid var(--hairline)}
.brand{display:flex;align-items:center;gap:.5rem;font-family:var(--mono);font-size:11px;
letter-spacing:.22em;text-transform:uppercase;color:var(--quiet)}
h1{margin:.45rem 0 0;font-size:20px;font-weight:600;letter-spacing:-.01em;
display:flex;align-items:baseline;gap:.5rem}
h1.bad{color:#e5705f}
h1.ok{color:var(--green)}
h1 .more{font-size:11px;font-weight:400;color:var(--warm)}
.intent{margin:.35rem 0 0;font-size:15px;color:var(--ivory)}
.chips{display:flex;flex-wrap:wrap;gap:.35rem;margin-top:.5rem}
.chip{font-family:var(--mono);font-size:10.5px;color:var(--quiet);border:1px solid var(--hairline);
border-radius:3px;padding:.1rem .4rem;max-width:100%;overflow-wrap:anywhere}
.chip b{font-weight:400;color:var(--warm);margin-right:.4rem}
.census{margin-top:.6rem}
.bar{display:flex;height:4px;border-radius:2px;overflow:hidden;background:var(--charcoal)}
.seg{display:block}
.seg.changed,.seg.new{background:var(--orange)}
.seg.incomparable{background:var(--fold)}
.seg.failed{background:#c0392b}
.seg.ignored{background:var(--warm)}
.seg.excluded{background:var(--charcoal);box-shadow:inset 0 0 0 1px var(--hairline)}
.seg.unreached{background:var(--charcoal);box-shadow:inset 0 0 0 1px var(--hairline)}
.seg.unchanged{background:var(--green)}
.keys{display:flex;flex-wrap:wrap;gap:.9rem;margin-top:.4rem}
.key{background:none;border:0;padding:0;cursor:pointer;font:inherit;font-size:11px;
color:var(--quiet);display:flex;align-items:center;gap:.35rem}
.key b{font-variant-numeric:tabular-nums;color:var(--ivory);font-weight:600}
.key i{width:6px;height:6px;border-radius:1px;display:block}
.key.changed i,.key.new i{background:var(--orange)}
.key.incomparable i{background:var(--fold)}
.key.failed i{background:#c0392b}
.key.failed b{color:#e5705f}
.key.ignored i{background:var(--warm)}
.key.excluded i{background:var(--hairline)}
.key.unreached i{background:var(--hairline)}
.key.unchanged i{background:var(--green)}
.key[aria-pressed=true]{color:var(--orange)}

/* frame */
main{display:grid;grid-template-columns:19rem minmax(0,1fr);align-items:start}
@media (max-width:900px){main{grid-template-columns:1fr}.rail{position:static!important;height:auto!important}
header{position:static}}
.rail{position:sticky;top:5.6rem;height:calc(100vh - 5.6rem);overflow:auto;padding:1rem .75rem 3rem;
border-right:1px solid var(--hairline)}
.rail h2{margin:1.25rem 0 .4rem;font-size:10px;letter-spacing:.18em;text-transform:uppercase;
color:var(--warm);font-weight:500}
#filter{width:100%;background:var(--panel);border:1px solid var(--hairline);border-radius:5px;
color:var(--ivory);font:12px/1.6 var(--mono);padding:.35rem .5rem}
#filter::placeholder{color:var(--warm)}
.causes .cause{display:grid;grid-template-columns:1fr auto;gap:0 .5rem;width:100%;text-align:left;
background:none;border:0;border-left:2px solid transparent;padding:.4rem .5rem;cursor:pointer;
font:inherit;color:inherit;border-radius:0 4px 4px 0}
.causes .cause:hover,.row:hover{background:var(--panel)}
.causes .cause[aria-pressed=true]{border-left-color:var(--orange);background:var(--panel)}
.causes .cause .name{grid-column:1;font-size:12.5px}
.causes .cause .n{grid-column:2;font-variant-numeric:tabular-nums;color:var(--quiet);font-size:11px}
.causes .cause .file,.causes .cause .px{grid-column:1/3;font-size:10.5px}
.rows{display:flex;flex-direction:column}
.row{display:flex;align-items:center;gap:.4rem;padding:.3rem .5rem;border-radius:4px;font-size:11.5px}
.row code{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.row.on{background:var(--charcoal)}
.dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--warm)}
.dot.changed{background:var(--orange)}
.dot.new{background:var(--green)}
.dot.incomparable,.dot.failed{background:#c0392b}
.pane{padding:1.25rem 1.5rem 6rem;min-width:0}

/* sections */
section{margin-bottom:2.5rem}
h2{display:flex;align-items:baseline;font-size:11px;letter-spacing:.18em;text-transform:uppercase;
color:var(--quiet);font-weight:500;margin:0 0 .75rem;padding-bottom:.4rem;
border-bottom:1px solid var(--hairline)}
h3{display:flex;align-items:baseline;font-size:12px;font-weight:600;color:var(--ivory);
margin:1.5rem 0 .5rem}

/* markers — never a sentence */
.mark{font-family:var(--mono);font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;
padding:.1rem .3rem;border-radius:2px;white-space:nowrap;margin-right:.35rem;cursor:help}
.mark.area,.mark.quiet{color:var(--warm);background:#ffffff08}
.mark.warn{color:var(--orange);background:#ff4a191f}
.mark.ok{color:var(--green);background:#7fa28c1f}
.mark.cause{color:var(--orange);background:#ff4a191f}
.mark.band{color:var(--quiet);background:#ffffff08;text-transform:none;cursor:default}
.mark.part{color:var(--quiet);background:#ffffff08}
.mark.font{text-transform:none;letter-spacing:0;font-size:10.5px}

/* clusters */
.clusters{list-style:none;margin:0;padding:0;display:grid;gap:.6rem}
.clusters li{border:1px solid var(--hairline);border-radius:6px;background:var(--panel);padding:.6rem .75rem}
.clusters .head{display:flex;align-items:center;gap:.5rem}
.clusters .comp{font-size:13px;font-weight:600;color:var(--ivory)}
.settles{font-variant-numeric:tabular-nums;font-family:var(--mono);font-size:16px;color:var(--orange)}
.settles.none{color:var(--warm)}
.settles em{font-size:12px}
.fp{margin:.35rem 0}
.subs{display:flex;flex-wrap:wrap;gap:.25rem;margin-top:.5rem;font-size:11px}
.subs a{border:1px solid var(--hairline);border-radius:3px;padding:.05rem .35rem;color:var(--quiet)}
.subs a:hover{border-color:var(--orange);color:var(--ivory)}
.subs a.partial{opacity:.5;border-style:dashed}
.folds{list-style:none;margin:.3rem 0 0;padding:0}
.folds li{display:flex;flex-wrap:wrap;align-items:baseline;gap:.6rem;padding:.25rem 0;
border-bottom:1px solid #ffffff0a;font-size:11.5px}
.folds .n{color:var(--quiet);font-variant-numeric:tabular-nums;white-space:nowrap}
/* A divergence's parting: full width under the subjects it explains, and
   preformatted, because explainParting indents its own manifestation lines. */
.folds .why{flex:0 0 100%;margin:.2rem 0 0;color:var(--quiet);
font:11px/1.5 var(--mono);white-space:pre-wrap}
.ungrouped{display:flex;flex-wrap:wrap;gap:.3rem;align-items:center;font-size:11px;color:var(--quiet)}

/* copy affordances */
.copy,.cmd{background:none;border:1px solid transparent;border-radius:3px;padding:.1rem .3rem;
cursor:pointer;color:var(--quiet);font:inherit;text-align:left;position:relative}
.copy code{font-size:11px}
.copy:hover,.cmd:hover{border-color:var(--hairline);color:var(--ivory);background:#ffffff08}
.cmds{display:flex;flex-wrap:wrap;gap:.3rem;margin-top:.5rem}
.cmd{border-color:var(--hairline);background:#00000030}
.cmd code{font-size:11px;color:var(--ivory)}
.cmd .lbl{font-size:9.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--warm);
margin-right:.4rem}
.cmd code{overflow-wrap:anywhere}
/* A subject's commands: one quiet line until opened, then one row each, the
   sentence above the command it names. */
.cmds-fold{margin-top:.5rem}
.cmds-fold>summary{cursor:pointer;padding:.2rem 0;font-size:11.5px;color:var(--warm)}
.cmds-fold[open]>summary{color:var(--ivory)}
.cmds-fold .cmds{flex-direction:column;margin-top:.25rem}
.cmds-fold .cmd{display:flex;flex-direction:column;gap:.15rem}
.cmds-fold .lbl{font-size:11px;letter-spacing:0;text-transform:none;margin:0}
.copied::after{content:"copied";position:absolute;inset-inline-start:50%;bottom:100%;
transform:translateX(-50%);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;
color:var(--green);padding-bottom:2px}

/* subject */
.subject{border:1px solid var(--hairline);border-radius:8px;background:var(--panel);
padding:.75rem .9rem;margin-bottom:1rem;scroll-margin-top:6rem}
.subject:target,.subject.on{border-color:var(--orange)}
.subject .top{display:flex;align-items:center;gap:.5rem}
.subject .id{font-size:13px;font-weight:600}
.verdict{font-family:var(--mono);font-size:9.5px;letter-spacing:.08em;text-transform:uppercase;
padding:.1rem .35rem;border-radius:2px;background:#ffffff08;color:var(--quiet)}
.verdict.changed{color:var(--orange);background:#ff4a191f}
.verdict.new{color:var(--green);background:#7fa28c1f}
.because{margin:.35rem 0 .6rem;color:var(--quiet);font-size:12px}

/* viewer */
.modes{display:flex;align-items:center;gap:.25rem;margin-bottom:.5rem}
.modes button{background:none;border:1px solid var(--hairline);border-radius:4px;
padding:.15rem .45rem;font:inherit;font-size:11px;color:var(--quiet);cursor:pointer;
display:flex;align-items:center;gap:.35rem}
.modes button:hover{color:var(--ivory)}
.modes button.on{color:var(--deep);background:var(--orange);border-color:var(--orange);font-weight:600}
.modes kbd{font-size:9px;opacity:.65}
.blend{width:8rem;accent-color:var(--orange);display:none}
.stage[data-mode=blend]~.modes .blend{display:block}
.modes:has(~.stage[data-mode=blend]) .blend{display:block}
.stage{position:relative;display:grid;gap:.5rem;background:#0000004d;border:1px solid var(--hairline);
border-radius:6px;padding:.5rem;overflow:hidden}
.stage img{display:block;max-width:100%;max-height:72vh;width:auto;height:auto;image-rendering:pixelated;
background:repeating-conic-gradient(#2a2f31 0% 25%,#202426 0% 50%) 0 0/16px 16px}
.stage .boxes,.stage .handle{display:none}

/* trio — before · diff · after, and the diff is why the page is open */
.stage[data-mode=trio]{grid-template-columns:repeat(3,minmax(0,1fr));align-items:start}
.stage[data-mode=trio] img{grid-row:1}
.stage[data-mode=trio] .before{grid-column:1}
.stage[data-mode=trio] .diff{grid-column:2;outline:1px solid var(--orange);outline-offset:2px}
.stage[data-mode=trio] .after{grid-column:3}
.stage[data-mode=diff] .before,.stage[data-mode=diff] .after{display:none}

/* stacked modes */
.stage[data-mode=regions] .before,.stage[data-mode=regions] .diff,
.stage[data-mode=wipe] .diff,.stage[data-mode=blend] .diff,.stage[data-mode=blink] .diff{display:none}
.stage[data-mode=wipe],.stage[data-mode=blend],.stage[data-mode=blink],.stage[data-mode=regions]{
place-items:start;width:max-content;max-width:100%}
.stage[data-mode=wipe] img,.stage[data-mode=blend] img,.stage[data-mode=blink] img{
grid-area:1/1}
.stage[data-mode=regions] img{grid-area:1/1}
.stage[data-mode=wipe]{cursor:ew-resize}
.stage[data-mode=wipe] .after{clip-path:inset(0 0 0 var(--wipe,50%))}
.stage[data-mode=wipe] .handle{display:block;position:absolute;top:0;bottom:0;
left:calc(.5rem + (100% - 1rem) * var(--wipe-n,.5));width:1px;background:var(--orange);
pointer-events:none;box-shadow:0 0 0 1px #0006}
.stage[data-mode=blend] .after{opacity:var(--blend,.5)}
@keyframes blink{0%,49%{opacity:0}50%,100%{opacity:1}}
.stage[data-mode=blink] .after{animation:blink 1.2s steps(1) infinite}
.stage[data-mode=regions] .boxes{display:block;position:absolute;inset:.5rem auto auto .5rem;
pointer-events:none}
.stage[data-mode=regions] .boxes b{position:absolute;border:1px solid var(--orange);
background:#ff4a1914;pointer-events:auto;cursor:pointer}
.stage[data-mode=regions] .boxes b.collateral{border-color:var(--warm);background:#756d6714}
.stage[data-mode=regions] .boxes b.on{background:#ff4a1940;box-shadow:0 0 0 1px var(--orange)}
.none{color:var(--warm);font-size:12px;margin:.25rem 0}

/* tables */
table{border-collapse:collapse;width:100%;font-size:11.5px;margin-top:.6rem}
th{text-align:left;font-weight:500;color:var(--warm);font-size:10px;letter-spacing:.1em;
text-transform:uppercase;padding:.25rem .5rem;border-bottom:1px solid var(--hairline)}
td{padding:.25rem .5rem;border-bottom:1px solid #ffffff0a;vertical-align:top}
tbody tr:hover,tbody tr.on{background:#ffffff08}
tr.cause td{border-left:2px solid var(--orange)}
.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap;font-family:var(--mono)}
.moves td:last-child{width:45%}
.held{color:var(--green)}
.net{color:var(--orange)}
.from{color:var(--warm)}

/* the settled and the unobserved: one compact row each, never a stage */
.entries{display:flex;flex-direction:column}
.entry{display:flex;align-items:center;gap:.5rem;padding:.3rem 0;
border-bottom:1px solid #ffffff0a;font-size:12px}
.entry code{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:38%}
.entry .why{color:var(--quiet);font-size:11.5px;flex:1;min-width:0}
.entry .why code{color:var(--warm);max-width:none}
.why.unsaid{color:var(--warm);font-style:italic}
.entry .px{color:var(--warm);font-family:var(--mono);font-size:11px;
font-variant-numeric:tabular-nums;margin-left:auto}
.dot.unchanged{background:var(--green)}
.dot.ignored{background:var(--warm)}
.dot.excluded{background:var(--hairline)}
.dot.unreached{background:var(--hairline)}

/* the declaration ledgers: every rule is a row, including the quiet ones */
.ledger td:first-child{width:22%}
.ledger td:last-child{width:38%}
.ledger tr.dead td,.ledger tr.unresolved td,.ledger tr.expired td,
.ledger tr.unworn td,.ledger tr.unscoped td{border-left:2px solid var(--orange)}
.ledger .none{color:var(--warm);font-family:var(--mono);font-size:10.5px}
.ledger em{color:var(--warm);font-style:normal;font-size:9.5px;margin-left:.15rem}
.note{color:var(--quiet);font-size:11px;margin:.4rem 0 0}

/* coverage */
.strip{display:flex;flex-wrap:wrap;gap:.3rem;margin:.5rem 0}
.warnings{margin:.5rem 0;padding-left:1rem;color:var(--quiet);font-size:12px}
.findings{margin:.5rem 0 0;font-size:11.5px;color:var(--quiet)}
.findings ul{list-style:none;margin:0;padding:0}
.findings li{display:flex;flex-wrap:wrap;align-items:center;gap:.35rem;padding:.15rem 0 .15rem .4rem;
  border-left:2px solid var(--hairline)}
.findings li.new{border-left-color:var(--orange)}
.findings-lead{margin:0 0 .4rem;font-size:12px;color:var(--ivory)}
.findings-lead.mine{color:var(--orange)}
.findings-why{margin:.5rem 0 0;padding-top:.35rem;border-top:1px solid var(--hairline)}
.findings-rest{margin-top:.6rem}
.findings-rest>summary{cursor:pointer;padding:.2rem 0;color:var(--warm)}
.findings-rest[open]>summary{color:var(--ivory)}
.band-head{font-family:var(--mono);font-size:9.5px;letter-spacing:.09em;text-transform:uppercase;
  color:var(--warm);margin:.5rem 0 .25rem}
.findings-lead+.band-head{margin-top:0}
.age{font-size:10px;margin-left:auto;padding:.05rem .3rem;border-radius:3px;color:var(--quiet);
  background:#ffffff08;white-space:nowrap;cursor:default}
.age.new{color:var(--orange);background:#ff4a191f}
.truncated{display:flex;gap:.5rem;align-items:center;margin:.35rem 0 0;font-size:11px}
.hidden{display:none!important}
`;

/**
 * Inline, and it is the comparison rather than decoration.
 *
 * Three pictures side by side is where every self-hosted report stops, and it is
 * the point at which a 4-pixel shift becomes invisible. A wipe, a blend, a blink
 * and a region overlay each answer a question the arrangement cannot, and all
 * four are a few lines over images the page already has. Nothing here fetches, and
 * nothing here decides anything about the run — every number on the page is in
 * the artifact before this script runs.
 */
