import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { formatReport } from './report.js';
import { embedImages, reportsFor } from './report-read.js';
import type { CliRunReport } from './run.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function reportOf(images: Record<string, string>): CliRunReport {
  return {
    runVersion: 1,
    at: '2026-09-25T09:00:00.000Z',
    identity: {
      renderer: 'playwright-chromium',
      engine: 'chromium@131',
      platform: 'linux/x64',
      deviceScaleFactor: 1,
      fonts: [],
    },
    retention: 'durable',
    observations: [
      {
        subject: 'story:button',
        verdict: 'new',
        because: 'no baseline under this renderer; nothing to compare against',
        changedPixels: 0,
        regions: [],
        images,
      },
    ],
    notObserved: [],
  } as CliRunReport;
}

describe('embedImages', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'variance-embed-'));
    await mkdir(join(dir, 'images'));
    await writeFile(join(dir, 'images', 'button.after.png'), PNG);
    await writeFile(join(dir, 'images', 'button.after.json'), '{}');
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('carries each picture inside the report, and leaves the sidecar a path', async () => {
    const report = reportOf({ after: 'images/button.after.png', record: 'images/button.after.json' });
    const images = (await embedImages(report, dir)).observations[0]?.images;

    expect(images?.after).toBe(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(images?.record).toBe('images/button.after.json');
  });

  it('keeps the path of a picture it cannot read, so the page still has its slot', async () => {
    const report = reportOf({ after: 'images/button.after.png', before: 'images/gone.before.png' });
    const images = (await embedImages(report, dir)).observations[0]?.images;

    expect(images?.before).toBe('images/gone.before.png');
    expect(images?.after).toMatch(/^data:image\/png;base64,/);
  });

  it('resolves pictures against the report that named them, and the page carries them', async () => {
    const path = join(dir, 'run.json');
    await writeFile(path, JSON.stringify(reportOf({ after: 'images/button.after.png' })));
    const config = { report: join(tmpdir(), 'elsewhere', 'run.json') } as Config;

    const page = formatReport({ report: await reportsFor([path], config, true), format: 'html' });

    expect(page).toContain(`src="data:image/png;base64,${PNG.toString('base64')}"`);
    expect(page).not.toContain('src="images/button.after.png"');
  });
});
