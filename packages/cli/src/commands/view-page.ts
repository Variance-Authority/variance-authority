// compass: variance-authority.reach.crossings
/**
 * `variance view`: the recording as one page to explore.
 *
 * The page is the coverage page's shell with a view beside each thing the
 * recording holds: the tests, the timeline, and the coverage answer when one
 * could be counted. It arranges what it is handed and computes nothing.
 */

import { COVERAGE_STYLE, coverageView } from './coverage-html.js';
import { chip, text } from './report-html-elements.js';
import { MARK } from './report-html-style.js';
import type { Coverage } from './coverage.js';
import type { ViewData } from './view-data.js';
import { detailView } from './view-detail.js';
import { enteredSection } from './view-entered.js';
import { shell, type View } from './view-shell.js';
import { TESTS_STYLE, testsView } from './view-tests.js';
import { TIMELINE_STYLE, timelineView } from './view-timeline.js';

function masthead(data: ViewData, coverage: Coverage | { readonly missed: string } | undefined): string {
  const chips: string[] = [];
  if (data.suite !== undefined) chips.push(chip('suite', data.suite));
  if (data.commit !== undefined) chips.push(chip('commit', data.commit.slice(0, 8), data.commit));
  if (data.recording !== undefined) chips.push(chip('record', data.recording.split('/').slice(-2).join('/'), data.recording));
  if (data.timeline.recorded > 0) chips.push(chip('files', `${data.timeline.recorded} recorded, ${data.timeline.placed} placed on the clock`));
  if (coverage !== undefined && 'missed' in coverage) chips.push(chip('coverage', 'not counted', coverage.missed));
  return (
    `<header><div class="brand">${MARK}<span>variance</span></div>` +
    `<h1>${text('view')}<span class="more">${text('the recording, as it was written')}</span></h1>` +
    `<div class="chips">${chips.join('')}</div></header>`
  );
}

/** The recording as one self-contained page, opened on its Tests. */
export function viewPage(data: ViewData, coverage?: Coverage | { readonly missed: string }): string {
  const views: View[] = [testsView(data.tests), timelineView(data.timeline), detailView(data)];
  const entered = enteredSection(data.reach);
  if (coverage !== undefined && !('missed' in coverage)) {
    const counted = coverageView(coverage, true);
    views.push({ ...counted, body: counted.body + entered });
  } else if (data.reach.files.length > 0) views.push({ id: 'coverage', label: 'Coverage', body: entered });
  return shell({
    title: 'variance view',
    header: masthead(data, coverage),
    views,
    first: 'tests',
    style: `${COVERAGE_STYLE}${TESTS_STYLE}${TIMELINE_STYLE}`,
  });
}
