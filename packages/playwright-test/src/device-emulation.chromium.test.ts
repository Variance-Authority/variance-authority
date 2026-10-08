import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Browser, type BrowserContextOptions, type TestInfo } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CHROMIUM_RASTER_ARGS, observe } from './index.js';

const BROWSER_AVAILABLE = ((): boolean => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\npackages/playwright-test device emulation: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

const WINDOW = { width: 390, height: 844 };
const TOUCH: BrowserContextOptions = { viewport: WINDOW, hasTouch: true, isMobile: true };

// No viewport meta, on purpose: under `isMobile` the page lays out at 980 px
// inside the 390 px window, so the narrow-screen rule does not apply there, and
// the button is taller on a coarse pointer.
const PAGE = `<style>
  button { padding: 4px; font: 16px sans-serif; }
  @media (pointer: coarse) { button { padding: 20px; } }
  @media (max-width: 600px) { main { padding-bottom: 30px; } }
</style><main id="subject"><button>Pay</button></main>`;

let browser: Browser | undefined;

beforeAll(async () => {
  if (BROWSER_AVAILABLE) {
    browser = await chromium.launch({ headless: true, args: [...CHROMIUM_RASTER_ARGS] });
  }
});

afterAll(async () => {
  await browser?.close();
});

function info(): TestInfo {
  return {
    titlePath: ['device emulation', 'pay'],
    config: { updateSnapshots: 'all' },
    project: { use: { colorScheme: 'light', deviceScaleFactor: 1 } },
  } as unknown as TestInfo;
}

/** The accepted baseline's size, read out of the one PNG the store keeps for the subject. */
async function storedSize(root: string): Promise<{ width: number; height: number }> {
  const entries = await readdir(root, { recursive: true });
  const images = entries.filter((entry) => entry.endsWith('.png'));
  expect(images).toHaveLength(1);
  const png = await readFile(join(root, images[0]!));
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/** Accept one baseline of the subject on a page opened with `options`. */
async function acceptedOn(
  options: BrowserContextOptions,
): Promise<{ drawn: { width: number; height: number }; stored: { width: number; height: number } }> {
  const baselines = await mkdtemp(join(tmpdir(), 'variance-device-emulation-'));
  const page = await browser!.newPage(options);
  try {
    await page.setContent(PAGE);
    const locator = page.locator('#subject');
    const box = (await locator.boundingBox())!;
    await observe(page, locator, info(), { baselines, subjectId: 'device-emulation/pay' });
    return {
      drawn: { width: Math.round(box.width), height: Math.round(box.height) },
      stored: await storedSize(baselines),
    };
  } finally {
    await page.close();
    await rm(baselines, { recursive: true, force: true });
  }
}

const chromium_ = BROWSER_AVAILABLE ? describe : describe.skip;

chromium_('a page the suite opened with device emulation', () => {
  it('leaves a desktop baseline painted without the rules its stylesheet keeps for touch', async () => {
    const { drawn, stored } = await acceptedOn({ viewport: WINDOW });
    expect(stored).toEqual(drawn);
  }, 60_000);

  it('leaves a touch baseline with the rules for the width the page laid out at, not the window it was given', async () => {
    const { drawn, stored } = await acceptedOn(TOUCH);
    expect(drawn.width).toBeGreaterThan(WINDOW.width);
    expect(stored).toEqual(drawn);
  }, 60_000);
});
