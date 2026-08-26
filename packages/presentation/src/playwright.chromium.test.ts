import { existsSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Browser } from '@playwright/test';
import { comparePresentation } from './compare.js';
import { focusPresentation } from './focus.js';
import { clearPresentationPaint, paintPresentationFocus, sensePresentation } from './playwright.js';

const READY = existsSync(chromium.executablePath());
const live = READY ? describe : describe.skip;

if (!READY) {
  console.warn(
    '\npackages/presentation: browser sensing skipped.\n  no browser — npx playwright install chromium\n',
  );
}

live('live presentation sensing', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser?.close();
  });

  it('retains ARIA, reports collapsed repeated records, and paints its evidence', async () => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.setContent(collapsedRecords(31));

    const report = await sensePresentation(page, page.getByRole('main'));
    const rules = report.findings?.map((finding) => finding.rule);
    const pattern = report.patterns?.find((candidate) => candidate.instances.length === 31);
    const focus = focusPresentation(report, pattern!.parent, {
      paint: ['repetition', 'findings'],
    });

    expect(report.semantic.browserAccessibility?.roots[0]).toContain('main "Demands"');
    expect(pattern).toBeDefined();
    expect(rules).toContain('SEPARATION_COLLISION');
    expect(rules).toContain('SPACING_RELATION_COLLISION');
    expect(rules).toContain('REPETITION_GRAMMAR_COLLAPSE');
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(focus.paint.length).toBeLessThan(report.paint?.length ?? 0);
    expect(await paintPresentationFocus(page, focus)).toBe(focus.paint.length);
    expect(await page.locator('[data-variance-authority-presentation-overlay] [data-layer="repetition"]').count())
      .toBeGreaterThanOrEqual(31);

    await clearPresentationPaint(page);
    expect(await page.locator('[data-variance-authority-presentation-overlay]').count()).toBe(0);
    await page.close();
  });

  it('keeps density and large margins as telemetry and state variance as evidence', async () => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await page.setContent(statefulRecords());

    const report = await sensePresentation(page, page.getByRole('main'));
    const pattern = report.patterns?.find((candidate) => candidate.instances.length === 4);
    const feedback = comparePresentation(report, report);

    expect(report.telemetry.utilization?.horizontal).toBe(0.5);
    expect(report.telemetry.density?.charactersPer1000Px2).toBeGreaterThan(0);
    expect(pattern?.outliers).toEqual([expect.objectContaining({ explainedByState: true })]);
    expect(report.findings?.some((finding) => finding.rule === 'PRESENTATION_GRAMMAR_DRIFT')).toBe(false);
    expect(feedback.information.characters.before).toBe(feedback.information.characters.after);
    await page.close();
  });
});

function collapsedRecords(count: number): string {
  const records = Array.from({ length: count }, (_, index) => `
    <article aria-label="Demand ${index}">
      <h3>WHO</h3>
      <p>Demand ${index}</p>
    </article>
  `).join('');
  return `
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font: 14px/16px Arial; color: rgb(20, 20, 20); }
      main { width: 320px; }
      article { height: 40px; padding: 0; margin: 0 0 4px; }
      h3, p { height: 16px; margin: 0; font: inherit; }
      p { margin-top: 4px; }
    </style>
    <main aria-label="Demands">${records}</main>
  `;
}

function statefulRecords(): string {
  const records = Array.from({ length: 4 }, (_, index) => `
    <article aria-label="Run ${index}" ${index === 2 ? 'aria-invalid="true" class="failed"' : ''}>
      <span>Status</span>
    </article>
  `).join('');
  return `
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; font: 12px/14px Arial; }
      main { width: 512px; margin-left: 256px; }
      article { width: 512px; height: 40px; margin-bottom: 8px; padding: 10px 8px; }
      article.failed { background: rgb(255, 230, 230); }
    </style>
    <main aria-label="Runs">${records}</main>
  `;
}
