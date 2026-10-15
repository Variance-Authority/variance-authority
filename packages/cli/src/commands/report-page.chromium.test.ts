import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { chromium, type Browser, type Page } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { main } from '../bin.js';

/**
 * The page `report --format html --embed-images` writes, opened in a browser.
 *
 * A carried picture is base64 text until something turns it into an image, and
 * turning it is the cost: the text decoded into bytes, the bytes into a bitmap
 * of width × height × 4. The page pays it for the pictures a reviewer is
 * looking at, and the rest stay text until a view shows them.
 */

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn('\npackages/cli report page in a browser: skipped.' + '\n  no browser — npx playwright install chromium\n');
}

/** A solid PNG of the given size: decodable, so the browser loads it. */
function png(width: number, height: number): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x80)]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

let root: string;
let browser: Browser | undefined;
let page: Page | undefined;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-page-browser-'));
  await mkdir(join(root, 'images'));
  if (BROWSER_AVAILABLE) {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  }
});

afterAll(async () => {
  await browser?.close();
  await rm(root, { recursive: true, force: true });
});

/** The page for one changed subject whose card opens on its change picture. */
async function written(): Promise<string> {
  const images: Record<string, string> = {};
  for (const side of ['before', 'diff', 'after', 'change'] as const) {
    images[side] = `images/page.${side}.png`;
    await writeFile(join(root, images[side]), side === 'change' ? png(320, 600) : png(320, 200));
  }
  await writeFile(
    join(root, 'variance.config.json'),
    JSON.stringify({
      project: 'page',
      profile: 'chromium',
      viewport: { width: 1280, height: 800 },
      retention: 'ephemeral',
      subjects: { kind: 'list', ids: ['route:/'], collector: './collector.mjs' },
      fonts: [],
      report: 'report.json',
    }),
  );
  await writeFile(
    join(root, 'report.json'),
    JSON.stringify({
      runVersion: 1,
      at: '2026-10-15T09:00:00.000Z',
      identity: {
        renderer: 'playwright-chromium',
        engine: 'chromium@131',
        platform: 'linux/x64',
        deviceScaleFactor: 1,
        fonts: [],
      },
      retention: 'ephemeral',
      observations: [
        {
          subject: 'route:/page',
          verdict: 'changed',
          because: '86 pixel(s) differ across 1 region(s)',
          changedPixels: 86,
          regions: [{ x: 0, y: 40, width: 200, height: 20, pixels: 86, cause: true }],
          images,
        },
      ],
      notObserved: [],
    }),
  );
  const writes: string[] = [];
  await main(
    ['report', '--config', join(root, 'variance.config.json'), '--format', 'html', '--embed-images', '--exit-zero-on-changes'],
    { out: (text) => void writes.push(text), err: () => undefined },
  );
  return writes.join('');
}

/** Which of the card's pictures are images yet, and which are still text. */
async function state(at: Page): Promise<Record<string, { shown: boolean; text: boolean }>> {
  return at.evaluate(() => {
    const out: Record<string, { shown: boolean; text: boolean }> = {};
    for (const img of Array.from(document.querySelectorAll<HTMLImageElement>('.stage img'))) {
      const number = img.getAttribute('data-picture');
      out[img.className] = {
        shown: img.src.startsWith('blob:'),
        text: document.getElementById(`picture-${number}`) !== null,
      };
    }
    return out;
  });
}

describe.skipIf(!BROWSER_AVAILABLE)('a carried picture in the browser', () => {
  it('turns into an image only when a view shows it', async () => {
    const at = page as Page;
    await at.setContent(await written(), { waitUntil: 'load' });
    await at.waitForFunction(() => (document.querySelector('img.change') as HTMLImageElement).src.startsWith('blob:'));

    // The card opens on the change: its picture is an image, and the three
    // pages the other views need are still the text they arrived as.
    expect(await state(at)).toEqual({
      before: { shown: false, text: true },
      diff: { shown: false, text: true },
      after: { shown: false, text: true },
      change: { shown: true, text: false },
    });

    await at.click('.modes button[data-mode="trio"]');
    await at.waitForFunction(() =>
      Array.from(document.querySelectorAll<HTMLImageElement>('.stage img')).every((img) => img.src.startsWith('blob:')),
    );
    expect(await state(at)).toEqual({
      before: { shown: true, text: false },
      diff: { shown: true, text: false },
      after: { shown: true, text: false },
      change: { shown: true, text: false },
    });
  });

  it('turns every picture into an image as it arrives in a browser with no IntersectionObserver', async () => {
    const at = page as Page;
    const html = (await written()).replace('<head>', '<head><script>delete window.IntersectionObserver</script>');
    await at.setContent(html, { waitUntil: 'load' });

    expect(await state(at)).toEqual({
      before: { shown: true, text: false },
      diff: { shown: true, text: false },
      after: { shown: true, text: false },
      change: { shown: true, text: false },
    });
  });
});
