// compass: variance-authority.reach.crossings
/**
 * `variance view`: the recording as one page to explore.
 *
 * The page is the coverage page's shell with a view beside each thing the
 * recording holds: the tests, the timeline, and the coverage answer when one
 * could be counted. It arranges what it is handed and computes nothing.
 */

import { COVERAGE_SCRIPT, COVERAGE_STYLE, coverageView } from './coverage-html.js';
import { chip, text } from './report-html-elements.js';
import { MARK } from './report-html-style.js';
import type { Coverage } from './coverage.js';
import type { ViewData } from './view-data.js';
import { shell, type View } from './view-shell.js';
import { TESTS_STYLE, testsView } from './view-tests.js';
import { TIMELINE_STYLE, timelineView } from './view-timeline.js';

function masthead(data: ViewData, coverage: Coverage | { readonly missed: string } | undefined): string {
  const chips: string[] = [];
  if (data.suite !== undefined) chips.push(chip('suite', data.suite));
  if (data.commit !== undefined) chips.push(chip('commit', data.commit.slice(0, 8), data.commit));
  if (data.recording !== undefined) chips.push(chip('record', data.recording.split('/').slice(-2).join('/'), data.recording));
  const files = data.timeline.files.length + data.timeline.unplaced;
  chips.push(chip('files', `${files} recorded, ${data.timeline.files.length} placed on the clock`));
  if (coverage !== undefined && 'missed' in coverage) chips.push(chip('coverage', 'not counted', coverage.missed));
  return (
    `<header><div class="brand">${MARK}<span>variance</span></div>` +
    `<h1>${text('view')}<span class="more">${text('the recording, as it was written')}</span></h1>` +
    `<div class="chips">${chips.join('')}</div></header>`
  );
}

/** The recording as one self-contained page, opened on its Tests. */
export function viewPage(data: ViewData, coverage?: Coverage | { readonly missed: string }): string {
  const views: View[] = [testsView(data.tests), timelineView(data.timeline)];
  if (coverage !== undefined && !('missed' in coverage)) views.push(coverageView(coverage, true));
  return shell({
    title: 'variance view',
    header: masthead(data, coverage),
    views,
    first: 'tests',
    style: `${COVERAGE_STYLE}${TESTS_STYLE}${TIMELINE_STYLE}`,
    script: COVERAGE_SCRIPT,
  });
}
