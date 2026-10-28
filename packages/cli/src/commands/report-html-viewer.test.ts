import { describe, expect, it } from 'vitest';
import { CHANGED, reportHtml, reportOf } from './report-html-fixture.js';

/** The viewer: which pictures a subject shows, in what order, and which mode it opens on. */
describe('the viewer shows the change a reviewer can read', () => {
  it('puts the diff between the two images it is a diff of', () => {
    // Three pictures in the order the record happens to list them makes the
    // reader's eye travel past both things they are comparing to reach the
    // reason the page is open.
    const html = reportHtml(reportOf({ observations: [CHANGED] }));

    const before = html.indexOf('images/toggle.before.png');
    const diff = html.indexOf('images/toggle.diff.png');
    const after = html.indexOf('images/toggle.after.png');

    expect(before).toBeGreaterThan(-1);
    expect(diff).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(diff);
  });

  it('offers the comparisons an arrangement of pictures cannot make', () => {
    // A wipe, a blend and an overlay are what turn three images into a
    // comparison; a 4-pixel shift is invisible in any of them side by side.
    const html = reportHtml(reportOf({ observations: [CHANGED] }));

    for (const mode of ['regions', 'wipe', 'blend', 'blink', 'trio']) {
      expect(html).toContain(`data-mode="${mode}"`);
    }
  });

  it('opens on the change at its own size when the run cut one', () => {
    // A full-page capture fitted to the column is a strip a few pixels wide per
    // sentence; the crop is the part of it a reviewer can read.
    const change = { ...CHANGED, images: { ...CHANGED.images, change: 'images/toggle.change.png' } };
    const html = reportHtml(reportOf({ observations: [change] }));

    expect(html).toContain('<div class="stage" data-mode="change">');
    expect(html).toMatch(/<div class="modes"><button type="button" data-mode="change" class="on">/);
    expect(html).toContain('<img class="change" src="images/toggle.change.png"');
  });

  it('opens on the regions when no change was cut', () => {
    const html = reportHtml(reportOf({ observations: [CHANGED] }));

    expect(html).toContain('<div class="stage" data-mode="regions">');
    expect(html).not.toContain('data-mode="change"');
  });

  it('carries the boxes the overlay draws, since no raster size is recorded', () => {
    const html = reportHtml(reportOf({ observations: [CHANGED] }));

    expect(html).toContain('data-box="4,4,16,16"');
  });
});
