import type { ObservationRecord } from '@variance-authority/report';
import type { CliRunReport } from './run.js';
import { docketOf, type CauseEntry, type Docket } from './docket.js';

/**
 * The run as one HTML page: the third angle on the same docket.
 *
 * Text answers *what happened* at a terminal, the pull-request body answers it in
 * a review thread, and neither can show a picture. This is the angle that can —
 * and it is deliberately the **cheapest rung of presentation infrastructure**:
 * one file, written by the same command that writes the JSON, uploaded as a CI
 * artifact by whatever already uploads CI artifacts. No service, no account, no
 * upload step, no retention policy, nothing to keep running.
 *
 * ## Why it is not a second opinion about the run
 *
 * Everything decided here is decided in `docket.ts` — one cause entry per
 * component, collateral counted rather than listed, `namedIn` recording whether
 * the semantic tier actually named the cause or whether the largest region was
 * taken instead. Adding a fourth renderer must never add a fourth answer, so this
 * file folds nothing: it receives a `Docket` and turns it into elements. That is
 * the property that lets a hosted review surface later render *the same docket*
 * server-side and be unable to disagree with the artifact in CI.
 *
 * ## The one constraint a reader has to know
 *
 * **Image paths are relative to the report**, exactly as `ObservationRecord.images`
 * declares them, so this page belongs beside `report.json` rather than anywhere
 * else. The alternative — base64 data URIs, one genuinely portable file — would
 * make this function read the filesystem, and a formatter that can fail on ENOENT
 * is a formatter that cannot be tested by handing it a value. Portability is
 * worth a flag later; it is not worth that.
 *
 * No script, no network, no font. A page that fetches anything is a page that
 * renders differently in the reviewer's browser than it did in CI, which is a
 * peculiar failure for this project of all projects to ship.
 */

export function reportHtml(report: CliRunReport): string {
  const docket = docketOf(report);
  const changed = report.observations.filter((entry) => entry.verdict !== 'unchanged');

  return [
    '<!doctype html>',
    '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${text(headline(docket))} — variance</title>`,
    `<style>${STYLE}</style>`,
    '</head><body>',
    `<h1>${text(headline(docket))}</h1>`,
    provenance(report),
    causes(docket),
    collateral(docket),
    subjects(changed),
    coverage(docket),
    '</body></html>',
  ]
    .filter((part) => part !== '')
    .join('\n');
}

/**
 * The sentence at the top, and it leads with causes rather than with a count.
 *
 * Same rule as the pull-request body (ADR-0019): "1530 pixels changed" is a
 * number nobody can act on, and "Toggle changed" is a sentence somebody owns.
 */
function headline(docket: Docket): string {
  if (docket.failed.length > 0 && docket.reviewable === 0) {
    return `${docket.failed.length} subject(s) could not be observed`;
  }
  if (docket.reviewable === 0) return 'Nothing needs review';

  const [first] = docket.causes;
  if (first === undefined) return `${docket.reviewable} subject(s) need review`;

  const rest = docket.causes.length - 1;
  return (
    `${first.label} changed in ${count(first.subjects.length, 'subject')}` +
    (rest > 0 ? `, and ${count(rest, 'other component')}` : '')
  );
}

/**
 * What produced this, above the findings rather than in a footer.
 *
 * A visual report read on a different machine from the one that painted it is the
 * normal case, and the identity is what says whether the two are even comparable.
 * Putting it where a reader has already scrolled past would make it a detail; it
 * is the precondition for every image below being meaningful.
 */
function provenance(report: CliRunReport): string {
  const { identity } = report;
  const rows: [string, string][] = [
    ['run', report.at],
    ['renderer', `${identity.renderer} · ${identity.engine} · ${identity.platform} · ${identity.deviceScaleFactor}x`],
    ['retention', report.retention],
  ];
  if (report.intent !== undefined) rows.push(['intent', report.intent]);
  if (identity.fonts.length > 0) rows.push(['fonts in the identity', identity.fonts.join(', ')]);

  return (
    '<dl class="provenance">' +
    rows.map(([term, value]) => `<dt>${text(term)}</dt><dd>${text(value)}</dd>`).join('') +
    '</dl>'
  );
}

function causes(docket: Docket): string {
  if (docket.causes.length === 0) return '';

  return section(
    'Causes',
    '<ol class="causes">' + docket.causes.map((entry) => cause(entry)).join('') + '</ol>',
  );
}

function cause(entry: CauseEntry): string {
  // `namedIn` is the whole reason this is not just a sorted list. Zero means the
  // semantic tier named nothing and the entry is the largest region by area —
  // which `rankRegions` documents as getting the ordering *wrong* — so the page
  // says which claim it is making rather than making the confident one twice.
  const named =
    entry.namedIn === 0
      ? '<span class="caveat">largest region, not a named cause</span>'
      : entry.namedIn < entry.subjects.length
        ? `<span class="caveat">named the cause in ${entry.namedIn} of ${entry.subjects.length}</span>`
        : '';

  return (
    '<li>' +
    `<div class="label">${
      entry.named ? `<code><strong>${text(entry.label)}</strong></code>` : text(entry.label)
    } ${named}</div>` +
    (entry.files.length > 0
      ? `<div class="files">${entry.files.map((file) => `<code>${text(file)}</code>`).join(' ')}</div>`
      : '') +
    (entry.wheres.length > 0 ? `<div class="where">${text(entry.wheres.join(' · '))}</div>` : '') +
    `<div class="meta">${count(entry.pixels, 'pixel')} across ` +
    `${count(entry.subjects.length, 'subject')}</div>` +
    `<details><summary>subjects</summary><ul>${entry.subjects
      .map((subject) => `<li><code>${text(subject)}</code></li>`)
      .join('')}</ul></details>` +
    '</li>'
  );
}

/** Counted, never listed — the rule the whole docket exists to enforce. */
function collateral(docket: Docket): string {
  const { regions, pixels, components, subjects: seen, unrecorded, unrecordedPixels } = docket.collateral;
  if (regions === 0 && unrecorded === 0) return '';

  return section(
    'Collateral',
    '<p>' +
      `${count(regions, 'region')} across ${count(components, 'component')} in ` +
      `${count(seen, 'subject')} moved without being edited — ${count(pixels, 'pixel')}.` +
      (unrecorded > 0
        ? ` A further ${count(unrecorded, 'region')} (${count(unrecordedPixels, 'pixel')}) ` +
          'were found and not recorded.'
        : '') +
      '</p>',
  );
}

function subjects(changed: readonly ObservationRecord[]): string {
  if (changed.length === 0) return '';
  return section('Subjects', changed.map((entry) => subject(entry)).join(''));
}

function subject(entry: ObservationRecord): string {
  const images = entry.images ?? {};
  const panes: string[] = [];
  if (images.before !== undefined) panes.push(pane('before', images.before));
  if (images.after !== undefined) panes.push(pane('after', images.after));
  if (images.diff !== undefined) panes.push(pane('diff', images.diff));

  const rows = entry.regions
    .map(
      (region) =>
        '<tr>' +
        `<td>${region.cause ? 'cause' : 'collateral'}</td>` +
        `<td>${text(region.component ?? '—')}</td>` +
        `<td><code>${text(region.file ?? '—')}</code></td>` +
        `<td>${text(region.where ?? '')}</td>` +
        `<td class="num">${region.pixels}</td>` +
        '</tr>',
    )
    .join('');

  return (
    '<section class="subject">' +
    `<h3><code>${text(entry.subject)}</code> <span class="verdict ${text(entry.verdict)}">${text(
      entry.verdict,
    )}</span></h3>` +
    `<p class="because">${text(entry.because)}</p>` +
    (panes.length > 0 ? `<div class="panes">${panes.join('')}</div>` : '') +
    (rows === ''
      ? ''
      : '<table><thead><tr><th>role</th><th>component</th><th>file</th><th>where</th>' +
        '<th class="num">pixels</th></tr></thead><tbody>' +
        rows +
        '</tbody></table>') +
    '</section>'
  );
}

function pane(label: string, source: string): string {
  return (
    `<figure><figcaption>${text(label)}</figcaption>` +
    `<img src="${text(source)}" alt="${text(label)}" loading="lazy"></figure>`
  );
}

/**
 * What was not looked at, and it is not optional.
 *
 * A page that showed only findings would read as complete on a run that failed to
 * observe half the suite — the exact green-check-over-an-unwatched-surface this
 * project refuses everywhere else. So a failure is rendered before the reader can
 * conclude anything, and an absent coverage list says so rather than showing zero.
 */
function coverage(docket: Docket): string {
  const parts: string[] = [];

  if (docket.failed.length > 0) {
    parts.push(
      `<p class="alert">${count(docket.failed.length, 'subject')} the run meant to observe and ` +
        'could not. This is not a pass.</p><ul>' +
        docket.failed
          .map((entry) => `<li><code>${text(entry.subject)}</code> — ${text(entry.because)}</li>`)
          .join('') +
        '</ul>',
    );
  }
  if (docket.excluded > 0) {
    parts.push(`<p>${count(docket.excluded, 'subject')} excluded by configuration.</p>`);
  }
  if (docket.missingFonts.size > 0) {
    parts.push(
      '<p>Rendered without: ' +
        [...docket.missingFonts]
          .map(([family, subjectCount]) => `${text(family)} (${subjectCount})`)
          .join(', ') +
        '</p>',
    );
  }

  return parts.length === 0 ? '' : section('Coverage', parts.join(''));
}

function section(title: string, body: string): string {
  return `<section><h2>${text(title)}</h2>${body}</section>`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? '' : 's'}`;
}

/**
 * Every interpolation goes through this, including values this repository wrote.
 *
 * A subject id, a component name and a `where` phrase all come from the page
 * under test, which is to say from somebody else's HTML. Escaping only the fields
 * that look risky is how the one that did not look risky ends up executing.
 */
function text(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Inline, because a stylesheet over the network is a page that renders twice. */
const STYLE = `
:root{color-scheme:light dark;--line:#8884;--dim:#8888;--alert:#c0392b}
body{font:14px/1.5 ui-sans-serif,system-ui,sans-serif;margin:0 auto;padding:2rem;max-width:60rem}
h1{font-size:1.5rem;margin:0 0 1rem}
h2{font-size:1rem;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);
margin:2.5rem 0 .75rem;border-bottom:1px solid var(--line);padding-bottom:.25rem}
h3{font-size:1rem;margin:0 0 .25rem;font-weight:600}
code{font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace}
dl.provenance{display:grid;grid-template-columns:max-content 1fr;gap:.15rem 1rem;margin:0;
color:var(--dim);font-size:12px}
dl.provenance dt{text-align:right}
dl.provenance dd{margin:0}
ol.causes{list-style:decimal;padding-left:1.5rem}
ol.causes li{margin-bottom:1rem}
.caveat{color:var(--alert);font-size:12px;font-weight:400}
.files code{margin-right:.5rem}
.where,.meta{color:var(--dim);font-size:12px}
details summary{cursor:pointer;color:var(--dim);font-size:12px}
details ul{margin:.25rem 0;padding-left:1.25rem}
.subject{margin:1.5rem 0;padding-top:1rem;border-top:1px solid var(--line)}
.verdict{font-size:11px;text-transform:uppercase;letter-spacing:.06em;padding:.1rem .4rem;
border:1px solid var(--line);border-radius:3px;color:var(--dim)}
.because{color:var(--dim);margin:.25rem 0 .75rem}
.panes{display:grid;grid-template-columns:repeat(auto-fit,minmax(14rem,1fr));gap:1rem}
figure{margin:0}
figcaption{font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--dim);
margin-bottom:.25rem}
img{max-width:100%;height:auto;border:1px solid var(--line);display:block}
table{border-collapse:collapse;width:100%;margin-top:1rem;font-size:12px}
th,td{text-align:left;padding:.3rem .5rem;border-bottom:1px solid var(--line)}
th{color:var(--dim);font-weight:500}
.num{text-align:right;font-variant-numeric:tabular-nums}
.alert{color:var(--alert);font-weight:600}
`;
