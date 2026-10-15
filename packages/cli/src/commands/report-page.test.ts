import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fileNameFor } from '@variance-authority/core/format';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';

/**
 * `variance report --format html --embed-images` on a run whose pictures are
 * too many to hold as one string.
 *
 * A run of 142 tall full-page screenshots died here with V8's
 * `RangeError: Invalid string length`: the page was joined into one string
 * with every picture inside it, and a string has a ceiling (2^29 - 24 code
 * units on 64-bit) that a run's pictures pass long before the run is unusual.
 *
 * These tests do not allocate that much. They hold the page to the property
 * that makes the ceiling unreachable: what the command hands to standard
 * output in one write is bounded by a batch, not by a picture or the run. `out` is the
 * only way the page leaves the process, so the longest string it is handed is
 * the longest string the page needed — a page joined whole arrives as one
 * write the size of every picture together.
 *
 * Driven through `main`, because the claim is about the command a CI step
 * runs, not about a helper it might stop calling.
 */

/** A PNG's signature and header, then noise: enough for its size to be read. */
function png(width: number, height: number, bytes: number): Buffer {
  const header = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header, 0);
  header.writeUInt32BE(13, 8);
  header.write('IHDR', 12, 'latin1');
  header.writeUInt32BE(width, 16);
  header.writeUInt32BE(height, 20);
  return Buffer.concat([header, randomBytes(bytes - header.length)]);
}

const IDENTITY = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'variance-page-'));
  await mkdir(join(root, 'images'));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * A run of `count` changed pages, three pictures each, every picture `bytes`
 * long, written as `<named(at)>.<side>.png` beside the report.
 */
async function run(
  count: number,
  bytes: number,
  extra: readonly object[] = [],
  named: (at: number) => string = (at) => `images/page-${at}`,
): Promise<Map<string, Buffer>> {
  const pictures = new Map<string, Buffer>();
  const observations: object[] = [];
  for (let at = 0; at < count; at += 1) {
    const images: Record<string, string> = {};
    for (const side of ['before', 'diff', 'after'] as const) {
      const path = `${named(at)}.${side}.png`;
      const picture = png(1280, 22000, bytes);
      pictures.set(path, picture);
      await mkdir(dirname(join(root, path)), { recursive: true });
      await writeFile(join(root, path), picture);
      images[side] = path;
    }
    observations.push({
      subject: `route:/page-${at}`,
      verdict: 'changed',
      because: '86 pixel(s) differ across 1 region(s)',
      changedPixels: 86,
      regions: [],
      images,
    });
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
      identity: IDENTITY,
      retention: 'ephemeral',
      observations: [...observations, ...extra],
      notObserved: [],
    }),
  );
  return pictures;
}

/** Every write the command made, in order. */
async function page({ embed = true }: { readonly embed?: boolean } = {}): Promise<string[]> {
  const writes: string[] = [];
  await main(
    ['report', '--config', join(root, 'variance.config.json'), '--format', 'html', ...(embed ? ['--embed-images'] : []), '--exit-zero-on-changes'],
    { out: (text) => void writes.push(text), err: () => undefined },
  );
  return writes;
}

describe('report --format html --embed-images', () => {
  it('writes the page in batches smaller than one picture, never as one string holding the run', async () => {
    const bytes = 96 * 1024;
    const pictures = await run(6, bytes);
    const writes = await page();
    const html = writes.join('');

    // Every picture is in the page, once.
    for (const picture of pictures.values()) {
      const encoded = picture.toString('base64');
      expect(html.indexOf(encoded)).toBeGreaterThan(-1);
      expect(html.indexOf(encoded)).toBe(html.lastIndexOf(encoded));
    }

    // And no write held even one of them whole. 18 pictures of 128 KiB of base64
    // are 2.3 MB together, and a page joined whole is one write of all of it; a
    // page written in batches never hands over more than a batch, whatever the
    // pictures weigh.
    const one = Math.ceil(bytes / 3) * 4;
    const longest = Math.max(...writes.map((write) => write.length));
    expect(longest).toBeLessThan(one);
  });

  it('lays out every subject before the first picture arrives', async () => {
    // The page a browser can use while the pictures are still downloading: a
    // reviewer can filter, read regions and copy commands from the first
    // kilobytes, instead of after a file the size of the run.
    await run(3, 4096);
    const html = (await page()).join('');

    const firstPicture = html.indexOf('type="application/octet-stream"');
    expect(firstPicture).toBeGreaterThan(-1);
    expect(html.lastIndexOf('<article class="subject"')).toBeLessThan(firstPicture);
    expect(html.lastIndexOf('</nav>')).toBeLessThan(firstPicture);
    expect(html.trimEnd().endsWith('</body></html>')).toBe(true);
  });

  it('gives each carried picture its size, so the page does not move as pictures land', async () => {
    await run(1, 4096);
    const html = (await page()).join('');

    const images = html.match(/<img [^>]*>/g) ?? [];
    expect(images).toHaveLength(3);
    for (const image of images) {
      expect(image).toContain('width="1280"');
      expect(image).toContain('height="22000"');
      expect(image).toContain('loading="lazy"');
      expect(image).toContain('decoding="async"');
      expect(image).not.toContain('src=');
    }
  });

  it('carries no picture of a subject the page does not show', async () => {
    const quiet = png(1280, 800, 4096);
    await writeFile(join(root, 'images', 'quiet.after.png'), quiet);
    await run(1, 4096, [
      {
        subject: 'route:/quiet',
        verdict: 'unchanged',
        because: 'nothing moved',
        changedPixels: 0,
        regions: [],
        images: { after: 'images/quiet.after.png' },
      },
    ]);
    const html = (await page()).join('');

    expect(html).not.toContain(quiet.toString('base64'));
    expect(html.match(/type="application\/octet-stream"/g)).toHaveLength(3);
  });

  it('carries a picture two subjects name once, and both show it', async () => {
    // A second page whose baseline is the first page's: three pictures of its
    // own would be six carried; sharing one is five.
    for (const side of ['diff', 'after']) await writeFile(join(root, 'images', `twin.${side}.png`), png(1280, 800, 4096));
    await run(1, 4096, [
      {
        subject: 'route:/twin',
        verdict: 'changed',
        because: '86 pixel(s) differ across 1 region(s)',
        changedPixels: 86,
        regions: [],
        images: { before: 'images/page-0.before.png', diff: 'images/twin.diff.png', after: 'images/twin.after.png' },
      },
    ]);
    const html = (await page()).join('');

    expect(html.match(/type="application\/octet-stream"/g)).toHaveLength(5);
    const shown = [...html.matchAll(/<img [^>]*data-picture="(\d+)"/g)].map((found) => found[1]);
    expect(shown).toHaveLength(6);
    expect(new Set(shown).size).toBe(5);
  });

  /**
   * A subject with a change picture, its full pages `pageHeight` rows tall and
   * the change `changeHeight`, each picture written as `<name>.<side>.png`.
   */
  async function cropped(name: string, pageHeight: number, changeHeight: number): Promise<Map<string, Buffer>> {
    const pictures = new Map<string, Buffer>();
    const images: Record<string, string> = {};
    for (const side of ['before', 'diff', 'after', 'change'] as const) {
      const path = `images/${name}.${side}.png`;
      const picture = png(1280, side === 'change' ? changeHeight : pageHeight, 4096);
      pictures.set(side, picture);
      await writeFile(join(root, path), picture);
      images[side] = path;
    }
    return new Map([
      ...pictures,
      [
        'entry',
        Buffer.from(
          JSON.stringify({
            subject: `route:/${name}`,
            verdict: 'changed',
            because: '86 pixel(s) differ across 1 region(s)',
            changedPixels: 86,
            regions: [{ x: 0, y: 40, width: 200, height: 20, pixels: 86, cause: true }],
            images,
          }),
        ),
      ],
    ]);
  }

  it('carries a long page as its change picture, and names the full pages it leaves out', async () => {
    // A reference page captured whole is 57,691 rows: three of them were 42 MB
    // of a page whose change was a few lines, and the card opens on the crop.
    const long = await cropped('long', 57691, 1397);
    await run(0, 4096, [JSON.parse(long.get('entry')!.toString())]);
    const html = (await page()).join('');

    expect(html).toContain(long.get('change')!.toString('base64'));
    for (const side of ['before', 'diff', 'after']) {
      expect(html).not.toContain(long.get(side)!.toString('base64'));
      expect(html).not.toMatch(new RegExp(`<img class="${side}"`));
    }
    expect(html.match(/type="application\/octet-stream"/g)).toHaveLength(1);
    expect(html).toMatch(/<p class="left"[^>]*>[^<]*before 1280×57691/);
    for (const mode of ['trio', 'wipe', 'blend', 'blink']) expect(html).not.toContain(`data-mode="${mode}"`);
  });

  it('carries an ordinary full page whole, though it is larger than the change picture', async () => {
    // A 3,000-row page with a small change: the crop is a few hundred rows,
    // and the card keeps its wipe, blend, blink and trio.
    const short = await cropped('short', 3000, 600);
    await run(0, 4096, [JSON.parse(short.get('entry')!.toString())]);
    const html = (await page()).join('');

    for (const side of ['before', 'diff', 'after', 'change']) {
      expect(html).toContain(short.get(side)!.toString('base64'));
    }
    expect(html).not.toContain('<p class="left"');
    for (const mode of ['trio', 'wipe', 'blend', 'blink']) expect(html).toContain(`data-mode="${mode}"`);
  });

  for (const order of ['first', 'second'] as const) {
    it(`carries a long page once when a card without a change picture names it, listed ${order}`, async () => {
      // The card with no change picture has nothing else to open on, so the
      // page is carried, and the card that would have left it out shows it too.
      const long = await cropped('long', 57691, 1397);
      const bare = {
        subject: 'route:/bare',
        verdict: 'changed',
        because: '86 pixel(s) differ across 1 region(s)',
        changedPixels: 86,
        regions: [],
        images: { before: 'images/long.before.png', after: 'images/long.after.png' },
      };
      const entry = JSON.parse(long.get('entry')!.toString());
      await run(0, 4096, order === 'first' ? [entry, bare] : [bare, entry]);
      const html = (await page()).join('');

      const encoded = long.get('before')!.toString('base64');
      expect(html.indexOf(encoded)).toBeGreaterThan(-1);
      expect(html.indexOf(encoded)).toBe(html.lastIndexOf(encoded));
      expect(html.match(/<img class="before"/g)).toHaveLength(2);
      expect(html).not.toMatch(/<p class="left"[^>]*>[^<]*before 1280×57691/);
      expect(html.match(/<img class="after"/g)).toHaveLength(2);
      expect(html).toMatch(/<p class="left"[^>]*>[^<]*diff 1280×57691/);
    });
  }

  it('carries a change picture another card names as a page past the limit', async () => {
    const long = await cropped('long', 57691, 1397);
    const reused = {
      ...JSON.parse(long.get('entry')!.toString()),
      subject: 'route:/reused',
      images: { change: 'images/long.before.png' },
    };
    await run(0, 4096, [JSON.parse(long.get('entry')!.toString()), reused]);
    const html = (await page()).join('');

    expect(html).toContain(long.get('before')!.toString('base64'));
  });

  it('carries the picture every card opens on before any other picture', async () => {
    // The first subject opens on its pages, the second on its change. The
    // second's change is on screen as soon as the first's pages are, rather
    // than after every picture the first subject's other views need.
    const pictures = await run(1, 4096);
    const short = await cropped('short', 3000, 600);
    await writeFile(
      join(root, 'report.json'),
      JSON.stringify({
        ...JSON.parse((await import('node:fs')).readFileSync(join(root, 'report.json'), 'utf8')),
        observations: [
          {
            subject: 'route:/page-0',
            verdict: 'changed',
            because: '86 pixel(s) differ across 1 region(s)',
            changedPixels: 86,
            regions: [],
            images: { before: 'images/page-0.before.png', diff: 'images/page-0.diff.png', after: 'images/page-0.after.png' },
          },
          JSON.parse(short.get('entry')!.toString()),
        ],
      }),
    );
    const html = (await page()).join('');

    const at = (picture: Buffer): number => html.indexOf(picture.toString('base64'));
    const opening = [pictures.get('images/page-0.before.png')!, pictures.get('images/page-0.after.png')!, short.get('change')!];
    const rest = [pictures.get('images/page-0.diff.png')!, short.get('before')!, short.get('diff')!, short.get('after')!];
    expect(Math.max(...opening.map(at))).toBeLessThan(Math.min(...rest.map(at)));
    expect(Math.min(...opening.map(at))).toBeGreaterThan(-1);
  });

  it('names pictures by their path without --embed-images, carries none, and loads them near the screen', async () => {
    await run(1, 4096);
    const html = (await page({ embed: false })).join('');

    expect(html).not.toContain('type="application/octet-stream"');
    const images = html.match(/<img [^>]*>/g) ?? [];
    expect(images).toHaveLength(3);
    for (const image of images) {
      expect(image).toMatch(/src="[^"]*images\/page-0\.(before|diff|after)\.png"/);
      expect(image).toContain('loading="lazy"');
      expect(image).toContain('decoding="async"');
    }
  });

  it('names each picture by the URL of its file, whatever the file name spells', async () => {
    // The run writes a picture under its subject id percent-encoded, so the
    // after picture of `route:/page-0` is `route%3A%2Fpage-0.after.png` on disk.
    // A browser reads `src` as a URL and decodes `%2F` to `/`, so a name written
    // into it raw asks for a file that does not exist. The directory holds a
    // space and a `#`, which a URL reads as an escape and a fragment.
    await run(1, 4096, [], (at) => `shots #1/${fileNameFor(`route:/page-${at}`)}`);
    const html = (await page({ embed: false })).join('');

    const shown = [...html.matchAll(/<img class="(before|diff|after)" src="([^"]*)"/g)];
    expect(shown).toHaveLength(3);
    const report = pathToFileURL(join(root, 'report.json'));
    for (const [, side, source] of shown) {
      const file = join(root, 'shots #1', `route%3A%2Fpage-0.${side}.png`);
      expect(new URL(source as string, report).href).toBe(pathToFileURL(file).href);
    }
  });
});
