import { readFileSync } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import type { CliRunReport } from './run.js';
import { text } from './report-html-elements.js';
import { needsReview } from './report-html-subjects.js';

/**
 * Where the page's pictures come from: beside it, or inside it.
 *
 * By default an `<img>` names its picture by the path the report gave it, and
 * the page belongs beside `report.json`. `--embed-images` is for a page opened
 * where the pictures are not — a CI artifact in a browser, a file sent to a
 * phone — so the page carries them.
 *
 * ## Carried after the page, one at a time
 *
 * A carried picture is not a `data:` URL in its `<img>`. A run's pictures are
 * the bulk of the page — 142 full-page screenshots, three each, are hundreds of
 * megabytes — and inlined they made the page one string past V8's ceiling,
 * and, below it, a page whose subjects the browser could not lay out until it
 * had parsed every picture before them.
 *
 * So the markup comes first, whole, with each `<img>` holding a number and the
 * picture's size and no source. The pictures follow at the end of the file, in
 * the order the page shows them, each as base64 in a script element the browser
 * does not run and a one-line call that turns it into a `blob:` URL and drops
 * the text. A reviewer filters, reads regions and copies commands while the
 * pictures are still arriving, the first subjects' pictures arrive first, and
 * the width and height keep the page from moving as they land.
 *
 * Only the pictures of subjects the page shows are carried, each once: an
 * unchanged subject has no card, and its picture is weight with nothing to
 * show it.
 */

/** A picture the page carries: the file it is read from and what is known of it before then. */
export interface Picture {
  /** Absolute, so shards from different directories cannot name one file twice. */
  readonly file: string;
  readonly media: string;
  readonly width?: number;
  readonly height?: number;
}

/** Pictures the page carries, by the path its `<img>` elements name them. */
export type Pictures = ReadonlyMap<string, Picture>;

/** How the page's `<img>` elements reach their pictures, and what it writes after its markup. */
export interface Placement {
  /** The attributes an `<img>` showing the picture at `path` carries. */
  attributes(path: string): string;
  /** The payloads of the pictures placed so far, in the order they were placed. */
  carried(): Iterable<string>;
}

/** Every picture by its path, relative to the report: the page belongs beside it. */
export const BY_PATH: Placement = {
  attributes: (path) => `src="${text(path)}"`,
  carried: () => [],
};

/**
 * Pictures carried inside the page, after its markup.
 *
 * A path `pictures` does not hold keeps its `src`, so a picture that could not
 * be read shows as missing where it would have been rather than taking the
 * subject's slot with it.
 */
export function carrying(pictures: Pictures): Placement {
  const placed = new Map<string, number>();
  return {
    attributes(path) {
      const picture = pictures.get(path);
      if (picture === undefined) return BY_PATH.attributes(path);
      const number = placed.get(path) ?? placed.size;
      placed.set(path, number);
      return (
        `data-picture="${number}"` +
        (picture.width === undefined ? '' : ` width="${picture.width}"`) +
        (picture.height === undefined ? '' : ` height="${picture.height}"`)
      );
    },
    *carried() {
      for (const [path, number] of placed) {
        const picture = pictures.get(path) as Picture;
        // Read when its turn comes, so what is held is one picture. A file gone
        // since it was located fails the command rather than the page lying.
        const bytes = readFileSync(picture.file);
        yield `<script type="application/octet-stream" id="picture-${number}" data-media="${text(picture.media)}">`;
        // In slices whose length is a multiple of three, so their encodings join
        // into the picture's and no piece of the page is the size of a picture.
        for (let at = 0; at < bytes.length; at += SLICE) {
          yield bytes.subarray(at, at + SLICE).toString('base64');
        }
        yield `</script><script>variancePicture(${number})</script>\n`;
      }
    },
  };
}

const SLICE = 3 * (1 << 13);

const MEDIA: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * The report with every picture the page shows located, and the pictures found.
 *
 * Applied per shard, before the merge, because an image path is relative to
 * the report that named it and the merged report has no directory. A located
 * path is rewritten to the absolute file and is the key the page names it by.
 * Only `before`, `diff` and `after` are pictures; `record` is a sidecar and
 * stays a path. A picture that cannot be opened keeps its path.
 *
 * Read one file at a time and only as far as a PNG's header, so locating a
 * run costs its count of pictures, not their bytes.
 */
export async function locatePictures(
  report: CliRunReport,
  dir: string,
  found: Map<string, Picture>,
): Promise<CliRunReport> {
  const observations = [];
  for (const entry of report.observations) {
    if (entry.images === undefined || !needsReview(entry.verdict)) {
      observations.push(entry);
      continue;
    }
    const images = { ...entry.images };
    for (const side of ['before', 'diff', 'after'] as const) {
      const path = images[side];
      const media = path === undefined ? undefined : MEDIA[extname(path).toLowerCase()];
      if (path === undefined || media === undefined) continue;
      const file = resolve(dir, path);
      const size = found.has(file) ? {} : await sizeOf(file);
      if (size === undefined) continue;
      if (!found.has(file)) found.set(file, { file, media, ...size });
      images[side] = file;
    }
    observations.push({ ...entry, images });
  }
  return { ...report, observations };
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * A picture's width and height when its header says them, `{}` when it is not
 * a PNG, and `undefined` when it cannot be opened.
 */
async function sizeOf(file: string): Promise<{ width?: number; height?: number } | undefined> {
  const handle = await open(file, 'r').catch(() => undefined);
  if (handle === undefined) return undefined;
  try {
    const header = Buffer.alloc(24);
    const { bytesRead } = await handle.read(header, 0, 24, 0);
    if (bytesRead < 24 || !header.subarray(0, 8).equals(SIGNATURE) || header.toString('latin1', 12, 16) !== 'IHDR') {
      return {};
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    await handle.close();
  }
}
