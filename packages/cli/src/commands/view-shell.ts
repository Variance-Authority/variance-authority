// compass: variance-authority.reach.crossings
/**
 * The frame every variance exploration page shares: a masthead, one tab per
 * view, and a router that shows one view at a time.
 *
 * It is a shell and nothing else. A view arrives as markup the caller built
 * from data it already holds; the shell lays them side by side, keeps the
 * address (`#view` or `#view/needle`) as the page's position, and carries a
 * link from one view to a row of another. The page is inline for the reason
 * the visual review's is: it is opened from a file, with nothing beside it and
 * no network.
 */

import { text } from './report-html-elements.js';
import { PAGE } from './report-html-style.js';

/** One view: the markup under its tab. */
export interface View {
  /** The view's name in the address, and the tab's anchor. */
  readonly id: string;
  readonly label: string;
  readonly body: string;
  /** False for a view reached only by a link: no tab. */
  readonly tab?: false;
  /** True when the address names one row exactly and the rest stay hidden. */
  readonly pick?: true;
}

/** One page: the masthead, the views, the one shown first, and what only these views draw. */
export interface Shell {
  readonly title: string;
  readonly header: string;
  readonly views: readonly View[];
  readonly first: string;
  readonly style?: string;
  readonly script?: string;
}

/** The views as one self-contained page, opened on `first`. */
export function shell(page: Shell): string {
  const first = page.views.some((view) => view.id === page.first) ? page.first : (page.views[0]?.id ?? '');
  const tabs = page.views.filter((view) => view.tab !== false).map((view) => `<a href="#${text(view.id)}" data-tab="${text(view.id)}">${text(view.label)}</a>`).join('');
  const views = page.views
    .map(
      (view) =>
        `<section class="view" id="view-${text(view.id)}" data-view="${text(view.id)}"${view.pick ? ' data-pick' : ''}>` +
        `<input class="vfilter" type="search" placeholder="filter ${text(view.label.toLowerCase())}" aria-label="filter ${text(view.label.toLowerCase())}" autocomplete="off">` +
        `${view.body}</section>`,
    )
    .join('');
  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${text(page.title)}</title>`,
    `<style>${PAGE}${STYLE}${page.style ?? ''}</style>`,
    `</head><body data-view="${text(first)}">`,
    page.header,
    `<nav class="tabs" aria-label="views">${tabs}</nav>`,
    `<main>${views}</main>`,
    `<script>${SCRIPT}${page.script ?? ''}</script>`,
    '</body></html>',
  ].join('\n');
}

/** What the frame draws: the tabs and the one view shown. */
const STYLE = `
.tabs{display:flex;gap:.25rem;padding:0 max(.45rem,calc((100% - 72rem) / 2 + .45rem));border-bottom:1px solid var(--hairline);background:var(--deep);position:sticky;top:var(--head,0);z-index:15}
.tabs a{padding:.5rem .8rem;font-size:12px;color:var(--quiet);border-bottom:2px solid transparent}
.tabs a:hover{color:var(--ivory)}
body[data-view] .view{display:none}
.vfilter{width:100%;max-width:24rem;margin:0 0 1rem;background:var(--panel);border:1px solid var(--hairline);
border-radius:5px;color:var(--ivory);font:12px/1.6 var(--mono);padding:.35rem .5rem}
.vfilter::placeholder{color:var(--warm)}
th[data-sort]{cursor:pointer;user-select:none}
th[data-sort]:hover{color:var(--ivory)}
th[data-sort].asc::after{content:' ▲'}
th[data-sort].desc::after{content:' ▼'}
tr.hit,.lane.hit{background:#ff4a1914;box-shadow:inset 2px 0 0 var(--orange)}
a.go{color:var(--ivory);border-bottom:1px dotted var(--warm)}
a.go:hover{color:var(--orange)}
main{max-width:72rem;margin:0 auto;padding:1.5rem 1.25rem 4rem}
header{padding-inline:max(1.25rem,calc((100% - 72rem) / 2 + 1.25rem))}
`;

/**
 * The router. The address is `#view` or `#view/needle`: the view is shown, and
 * the needle fills its filter and marks the rows it names. A tab shows its
 * view with no needle. Sorting is by a header cell: a number where a cell
 * carries `data-v`, its text otherwise.
 */
const SCRIPT = `
(()=>{
const body=document.body;
const views=[...document.querySelectorAll('.view')].map((v)=>v.dataset.view);
function rows(view){return [...view.querySelectorAll('[data-key]')];}
function narrow(view,q){
const needle=q.toLowerCase();
const pick=view.hasAttribute('data-pick');
for(const row of rows(view))row.classList.toggle('hidden',pick?row.dataset.key.toLowerCase()!==needle:needle!==''&&!row.dataset.key.toLowerCase().includes(needle));
for(const sec of view.querySelectorAll('section.part')){
const any=sec.querySelector('[data-key]:not(.hidden)')!==null||sec.querySelector('[data-key]')===null;
sec.classList.toggle('hidden',needle!==''&&!any);}
}
function mark(view,q){
for(const row of rows(view))row.classList.toggle('hit',q!==''&&row.dataset.key===q);
for(let up=view.querySelector('.hit');up;up=up.parentElement)if(up.tagName==='DETAILS')up.open=true;
const first=view.querySelector('.hit');if(first&&first.scrollIntoView)first.scrollIntoView({block:'center'});
}
function route(){
const [name,...rest]=decodeURIComponent(location.hash.slice(1)).split('/');
const id=views.includes(name)?name:body.dataset.view;
const needle=rest.join('/');
body.dataset.view=id;
for(const tab of document.querySelectorAll('.tabs a'))tab.setAttribute('aria-current',tab.dataset.tab===id?'page':'false');
for(const v of document.querySelectorAll('.view')){
const on=v.dataset.view===id;v.style.display=on?'block':'none';
const box=v.querySelector('.vfilter');
if(on){box.value=needle;box.dispatchEvent(new Event('input'));mark(v,needle);}
}
}
for(const box of document.querySelectorAll('.vfilter'))box.addEventListener('input',()=>narrow(box.closest('.view'),box.value.trim()));
addEventListener('hashchange',route);
for(const th of document.querySelectorAll('th[data-sort]'))th.addEventListener('click',()=>{
const table=th.closest('table');const at=[...th.parentNode.children].indexOf(th);
const dir=th.classList.contains('asc')?-1:1;
for(const other of th.parentNode.children)other.classList.remove('asc','desc');
th.classList.add(dir===1?'asc':'desc');
const body=table.tBodies[0];
const key=(tr)=>{const td=tr.children[at];const v=td.dataset.v;return v===undefined?td.textContent.trim():Number(v);};
[...body.rows].sort((a,b)=>{const x=key(a),y=key(b);return (x<y?-1:x>y?1:0)*dir;}).forEach((tr)=>body.appendChild(tr));
});
route();
})();
`;
