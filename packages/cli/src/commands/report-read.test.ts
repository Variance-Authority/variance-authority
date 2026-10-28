import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Config } from '../config.js';
import { htmlPage } from './report.js';
import { carrying, locatePictures, type Picture } from './report-html-pictures.js';
import { reportWithPictures } from './report-read.js';
import type { CliRunReport } from './run.js';

/** A PNG's signature and header, saying 320 by 200. */
const PNG = Buffer.alloc(24);
Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(PNG, 0);
PNG.writeUInt32BE(13, 8);
PNG.write('IHDR', 12, 'latin1');
PNG.writeUInt32BE(320, 16);
PNG.writeUInt32BE(200, 20);

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

describe('locatePictures', () => {
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

  it('finds each picture with the size its header says, and leaves the sidecar a path', async () => {
    const found = new Map<string, Picture>();
    const report = reportOf({ after: 'images/button.after.png', record: 'images/button.after.json' });
    const images = (await locatePictures(report, dir, found)).observations[0]?.images;

    const file = join(dir, 'images', 'button.after.png');
    expect(images?.after).toBe(file);
    expect(found.get(file)).toEqual({ file, media: 'image/png', width: 320, height: 200 });
    expect(images?.record).toBe('images/button.after.json');
  });

  it('finds the change at its own size too, since a tall page is read by it', async () => {
    await writeFile(join(dir, 'images', 'button.change.png'), PNG);
    const found = new Map<string, Picture>();
    const report = reportOf({ after: 'images/button.after.png', change: 'images/button.change.png' });
    const images = (await locatePictures(report, dir, found)).observations[0]?.images;

    const file = join(dir, 'images', 'button.change.png');
    expect(images?.change).toBe(file);
    expect(found.get(file)).toEqual({ file, media: 'image/png', width: 320, height: 200 });
  });

  it('keeps the path of a picture it cannot read, so the page still has its slot', async () => {
    const found = new Map<string, Picture>();
    const report = reportOf({ after: 'images/button.after.png', before: 'images/gone.before.png' });
    const images = (await locatePictures(report, dir, found)).observations[0]?.images;

    expect(images?.before).toBe('images/gone.before.png');
    expect(found.size).toBe(1);
  });

  it('resolves pictures against the report that named them, and the page carries them', async () => {
    const path = join(dir, 'run.json');
    await writeFile(path, JSON.stringify(reportOf({ after: 'images/button.after.png' })));
    const config = { report: join(tmpdir(), 'elsewhere', 'run.json') } as Config;

    const { report, pictures } = await reportWithPictures([path], config);
    const page = [...htmlPage({ report, placement: carrying(pictures) })].join('');

    expect(page).toContain('data-picture="0" width="320" height="200"');
    expect(page).toContain(`data-media="image/png">${PNG.toString('base64')}</script>`);
    expect(page).not.toContain('src="images/button.after.png"');
  });
});
