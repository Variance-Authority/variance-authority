// compass: variance-authority.reach.crossings
/**
 * `variance view`'s page: the record itself, whole, and the code that opens it.
 *
 * The record is embedded as gzip in base64, because a page opened from a file
 * can fetch nothing beside it. Nothing is picked out of the record here: what
 * is shown is decided in the page, from the bytes.
 */

import { chip, text } from './report-html-elements.js';
import { MARK, PAGE } from './report-html-style.js';

/** The record a page carries, and what is known of it outside its own bytes. */
export interface Carried {
  readonly suite?: string;
  /** Where it was read from. */
  readonly recording: string;
  /** Its bytes there. */
  readonly size: number;
  /** The record with its runs raw, gzipped. */
  readonly packed: Buffer;
  /** The page's own code. */
  readonly code: string;
}

/** The record as one self-contained page. */
export function viewPage(carried: Carried): string {
  const chips = [
    ...(carried.suite === undefined ? [] : [chip('suite', carried.suite)]),
    chip('record', carried.recording.split('/').slice(-2).join('/'), carried.recording),
    chip('size', `${carried.size.toLocaleString('en-US')} bytes`),
  ];
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<title>variance view</title>',
    `<style>${PAGE}${STYLE}</style>`,
    `</head><body data-suite="${text(carried.suite ?? '')}">`,
    `<header><div class="brand">${MARK}<span>variance</span></div>` +
      `<h1>view<span class="more">the recording, as it was written</span></h1><div class="chips">${chips.join('')}</div></header>`,
    '<nav class="tabs" aria-label="views"></nav>',
    '<main><p class="empty">Opening the record…</p></main>',
    `<script id="recording" type="application/octet-stream">${carried.packed.toString('base64')}</script>`,
    `<script>${carried.code.replaceAll('</script', '<\\/script')}</script>`,
    '</body></html>',
  ].join('\n');
}

const STYLE = `
main{max-width:96rem;margin:0 auto;padding:1.5rem 1.25rem 4rem}
header{position:static;padding-inline:max(1.25rem,calc((100% - 96rem) / 2 + 1.25rem))}
.tabs{display:flex;flex-wrap:wrap;gap:.25rem;padding:0 max(.45rem,calc((100% - 96rem) / 2 + .45rem));border-bottom:1px solid var(--hairline);background:var(--deep);position:sticky;top:0;z-index:15}
.tabs a{padding:.5rem .8rem;font-size:12px;color:var(--quiet);border-bottom:2px solid transparent}
.tabs a:hover{color:var(--ivory)}
.tabs a[aria-current=page]{color:var(--ivory);border-bottom-color:var(--orange)}
h1.title{font:600 16px/1.4 var(--mono);overflow-wrap:anywhere;margin:0 0 1rem}
section.part{margin:0 0 2.5rem}
section.part h2 .count{color:var(--quiet);font-weight:400;margin-left:.5rem}
section.part .hint{color:var(--quiet);font-size:12px;margin:.15rem 0 .6rem}
.empty{color:var(--quiet);margin:0 0 1rem}
dl.facts{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:.2rem 1.25rem;margin:0 0 2rem;font-size:12px}
dl.facts:empty{display:none}
dl.facts dt{color:var(--quiet)}
dl.facts dd{margin:0;font-family:var(--mono);overflow-wrap:anywhere}
.vfilter{width:100%;max-width:24rem;margin:0 0 .6rem;background:var(--panel);border:1px solid var(--hairline);
border-radius:5px;color:var(--ivory);font:12px/1.6 var(--mono);padding:.35rem .5rem}
.vfilter::placeholder{color:var(--warm)}
.grid{border:1px solid var(--hairline);border-radius:5px;overflow-x:auto;overflow-y:hidden;font:12px/26px var(--mono)}
.grid>*{min-width:var(--wide)}
.scroll{height:calc(var(--shown) * 26px);overflow-y:scroll;overflow-x:hidden}
.body{position:relative}
.row{display:grid;gap:0 .75rem;height:26px;padding:0 .6rem}
.row.head{height:30px;line-height:30px;background:var(--panel);border-bottom:1px solid var(--hairline);scrollbar-gutter:stable;overflow-y:scroll}
.body .row{position:absolute;left:0;right:0;top:0}
.body .row:hover{background:var(--panel)}
.cell{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0}
.cell.path{direction:rtl;text-align:left}
.cell.path>*{direction:ltr;unicode-bidi:isolate}
button.col.num{text-align:right}
.cell.num{text-align:right;font-variant-numeric:tabular-nums}
button.col{all:unset;cursor:pointer;color:var(--quiet);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
button.col:hover,button.col:focus-visible{color:var(--ivory)}
button.col.asc::after{content:' ▲'}
button.col.desc::after{content:' ▼'}
a.go{color:var(--ivory);border-bottom:1px dotted var(--warm)}
a.go:hover{color:var(--orange)}
.track{position:relative;height:26px}
.bar{position:absolute;top:6px;height:14px;display:flex;border-radius:2px;overflow:hidden;background:var(--green)}
.bar i{display:block;height:100%}
.ph.prepare{background:var(--warm)}
.ph.environment{background:var(--quiet)}
.ph.setup{background:#b7923a}
.ph.collect{background:#5f8aa6}
.ph.cases{background:var(--green)}
`;
