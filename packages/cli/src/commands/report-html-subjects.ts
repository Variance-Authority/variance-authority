import type {
  ObservationRecord,
  PresentationEffectEvidence,
  PresentationEffectRecord,
} from '@variance-authority/report';
import type { CliObservationRecord } from './run-report.js';
import { cmd, copy, markers, px, section, slug, text } from './report-html-elements.js';

/**
 * A subject: the comparison, what moved in it, and what to type next.
 *
 * The largest rung of the page and the only one with a program behind it, so it
 * is its own file. Every decision it renders was made elsewhere — the regions
 * are in the record in the order `rankRegions` put them, and re-sorting them
 * here would be a second opinion.
 */

/* --- subjects ------------------------------------------------------------- */

export function subjects(reviewable: readonly CliObservationRecord[]): string {
  if (reviewable.length === 0) return '';
  return section(
    'Subjects',
    `${reviewable.length} to look at`,
    reviewable.map((entry) => subject(entry)).join(''),
  );
}

/** Relationship consequences stay visible without changing which verdicts need review. */
export function presentationImpact(observations: readonly ObservationRecord[]): string {
  const entries = observations.flatMap((entry) => {
    const signal = entry.signals?.presentation;
    if (signal === undefined || signal.verdict === 'unchanged') return [];
    if (signal.verdict === 'incomparable') {
      return [
        `<li><code>${text(entry.subject)}</code> ` +
          `<span class="mark warn">incomparable</span>${text(signal.because)}</li>`,
      ];
    }
    const information = signal.information.contentPreserved
      ? '<span class="mark ok">content preserved</span>'
      : '<span class="mark warn">content changed</span>';
    return [
      `<li><code>${text(entry.subject)}</code>${information}<ul>` +
        signal.effects.map(effectHtml).join('') +
        '</ul></li>',
    ];
  });
  if (entries.length === 0) return '';
  return section(
    'Presentation impact',
    `${entries.length} subject${entries.length === 1 ? '' : 's'}`,
    `<ul class="findings presentation">${entries.join('')}</ul>`,
  );
}

function effectHtml(effect: PresentationEffectRecord): string {
  const identity =
    `<span class="mark warn">${text(effect.transition)}</span>` +
    `<code>${text(effect.rule)}</code>` +
    (effect.contract === undefined ? '' : `<code>${text(effect.contract)}</code>`) +
    `<span>${text(effect.owner)}</span>`;
  if (effect.transition === 'introduced') return `<li>${identity}${evidenceHtml('after', effect.after!)}</li>`;
  if (effect.transition === 'resolved') return `<li>${identity}${evidenceHtml('before', effect.before!)}</li>`;
  return `<li>${identity}${evidenceHtml('before', effect.before!)}${evidenceHtml('after', effect.after!)}</li>`;
}

function evidenceHtml(side: string, evidence: PresentationEffectEvidence): string {
  const measurements = Object.entries(evidence.measurements)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join(', ');
  return `<span class="where">${text(`${side} ${evidence.finding}: ${measurements}`)}</span>`;
}

/**
 * One subject: the comparison, what moved in it, and what to type next.
 *
 * The viewer's default is `regions` for the reason `tribunal`'s is — a reviewer
 * arriving at a subject should first be told *which boxes moved and who owns
 * them*, because that is the question a screenshot cannot answer and the one that
 * decides whether the change is the one somebody meant to make. The other modes
 * are the category's and are genuinely useful once you already know that.
 *
 * When three images exist the arrangement is **before · diff · after**: the diff
 * is the reason the page is open, and putting it third makes the reader's eye
 * travel past the two things they are trying to compare in order to reach it.
 */
function subject(entry: CliObservationRecord): string {
  const images = entry.images ?? {};
  const has = {
    before: images.before !== undefined,
    after: images.after !== undefined,
    diff: images.diff !== undefined,
  };
  const modes = modesFor(has, entry.regions.length);

  const stage =
    modes.length === 0
      ? '<p class="none">no images kept</p>'
      : '<div class="stage" data-mode="' +
        text(modes[0] ?? 'trio') +
        '">' +
        (has.before ? `<img class="before" src="${text(images.before ?? '')}" alt="before">` : '') +
        (has.diff ? `<img class="diff" src="${text(images.diff ?? '')}" alt="diff">` : '') +
        (has.after ? `<img class="after" src="${text(images.after ?? '')}" alt="after">` : '') +
        '<div class="boxes"></div><div class="handle"></div>' +
        '</div>';

  const toolbar =
    modes.length < 2
      ? ''
      : '<div class="modes">' +
        modes
          .map(
            (mode, index) =>
              `<button type="button" data-mode="${text(mode)}"${index === 0 ? ' class="on"' : ''}>` +
              `${text(mode)}<kbd>${index + 1}</kbd></button>`,
          )
          .join('') +
        '<span class="grow"></span>' +
        '<input type="range" class="blend" min="0" max="100" value="50" aria-label="blend">' +
        '</div>';

  return (
    `<article class="subject" id="s-${text(slug(entry.subject))}" data-subject="${text(entry.subject)}" ` +
    `data-verdict="${text(entry.verdict)}" tabindex="-1">` +
    '<div class="top">' +
    `<i class="dot ${text(entry.verdict)}"></i>` +
    `<code class="id">${text(entry.subject)}</code>` +
    `<span class="verdict ${text(entry.verdict)}">${text(entry.verdict)}</span>` +
    markers(entry) +
    '<span class="grow"></span>' +
    `<span class="px">${px(entry.changedPixels)}</span>` +
    '</div>' +
    `<p class="because">${text(entry.because)}</p>` +
    toolbar +
    stage +
    regions(entry) +
    findings(entry) +
    commands(entry) +
    '</article>'
  );
}

function modesFor(
  has: { before: boolean; after: boolean; diff: boolean },
  regionCount: number,
): readonly string[] {
  const modes: string[] = [];
  if (has.after && regionCount > 0) modes.push('regions');
  if (has.before && has.after) modes.push('wipe', 'blend', 'blink');
  if (has.before && has.diff && has.after) modes.push('trio');
  else if (has.diff) modes.push('diff');
  if (modes.length === 0 && has.after) modes.push('trio');
  return modes;
}

/**
 * Every region, with its own fingerprint reachable.
 *
 * The rows are wired to the overlay in both directions — hovering a row lights
 * its box, hovering a box lights the row — because a table of coordinates that
 * the reader has to project onto the image themselves is the failure the region
 * overlay exists to fix. `cause` first: `rankRegions` already sorted them, and a
 * table that re-sorted would be a second opinion.
 */
function regions(entry: ObservationRecord): string {
  if (entry.regions.length === 0 && entry.truncated === undefined) return '';

  const rows = entry.regions
    .map(
      (region, index) =>
        `<tr data-region="${index}" data-box="${region.x},${region.y},${region.width},${region.height}"` +
        `${region.cause ? ' class="cause"' : ''}>` +
        `<td>${region.cause ? '<span class="mark cause">cause</span>' : '<span class="mark quiet">collateral</span>'}` +
        (region.unattributed === true
          ? '<span class="mark warn" title="No box contained this region — a wrong scale or origin.">unattributed</span>'
          : '') +
        '</td>' +
        `<td>${region.component === undefined ? '<span class="nil">—</span>' : `<code>${text(region.component)}</code>`}</td>` +
        `<td>${region.file === undefined ? '<span class="nil">—</span>' : copy(region.file)}</td>` +
        `<td class="where">${region.where === undefined ? '' : text(region.where)}</td>` +
        `<td class="num">${region.x}×${region.y} ${region.width}·${region.height}</td>` +
        `<td class="num">${px(region.pixels)}</td>` +
        `<td>${region.fingerprint === undefined ? '<span class="nil">—</span>' : copy(region.fingerprint, 12)}</td>` +
        '</tr>',
    )
    .join('');

  const truncated =
    entry.truncated === undefined
      ? ''
      : `<p class="truncated"><span class="mark warn">+${entry.truncated.regions} not recorded</span>` +
        `<span class="px">${px(entry.truncated.pixels)}</span></p>`;

  return (
    '<table class="regions"><thead><tr>' +
    '<th>role</th><th>component</th><th>file</th><th>where</th>' +
    '<th class="num">box</th><th class="num">px</th><th>fingerprint</th>' +
    `</tr></thead><tbody>${rows}</tbody></table>${truncated}`
  );
}

/**
 * Defects in this render, with no baseline consulted.
 *
 * The half a comparison structurally cannot produce: a control that never had an
 * accessible name compares equal to itself forever, so approving the first
 * baseline approves the defect. `[]` is *inspected and clean* and absent is
 * *nothing looked* — so an empty array prints a marker rather than nothing at
 * all, which is the only way the two states are distinguishable on a page.
 */
function findings(entry: ObservationRecord): string {
  if (entry.findings === undefined) return '';
  if (entry.findings.length === 0) {
    return '<p class="findings"><span class="mark ok" title="This render was inspected and no defect was found. Absent would mean nothing looked.">inspected</span></p>';
  }
  return (
    '<ul class="findings">' +
    entry.findings
      .map(
        (finding) =>
          `<li><span class="mark warn">${text(finding.rule)}</span>${text(finding.what)}` +
          (finding.component === undefined ? '' : `<code>${text(finding.component)}</code>`) +
          (finding.file === undefined ? '' : `<span class="file">${text(finding.file)}</span>`) +
          '</li>',
      )
      .join('') +
    '</ul>'
  );
}

/**
 * What to type next, ready to paste.
 *
 * The page's whole reason to exist is deciding, and every decision this tool
 * supports is a command. A reviewer who has to reconstruct the subject id by hand
 * is a reviewer who will do it wrong once. `again` before `alone` because reading
 * a subject twice is the cheaper question and it invalidates the other one:
 * something that will not read the same way twice has nothing for `alone` to
 * reproduce.
 */
function commands(entry: CliObservationRecord): string {
  const id = entry.subject;
  const out = [
    cmd(`variance accept ${id}`),
    cmd(`variance again ${id}`, 'read twice'),
    cmd(`variance alone ${id}`, 'read alone'),
    cmd(`variance report --subject ${id}`),
  ];
  return `<div class="cmds">${out.join('')}</div>`;
}
