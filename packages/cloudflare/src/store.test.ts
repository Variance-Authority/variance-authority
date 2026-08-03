import { PNG } from 'pngjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { documentDigest, identityDigest, type Raster, type RenderIdentity } from '@variance-authority/core';
import { RasterStoreError } from '@variance-authority/raster';
import { createCloudflareStore } from './store.js';
import { createMemoryR2, createSqliteD1, type MemoryR2, type SqliteD1 } from './testing.js';

/**
 * What this file is for, and what `parity.test.ts` is for.
 *
 * The verdicts are settled next door: this store is one of the implementations in
 * [`observe/parity.test.ts`](../../observe/src/parity.test.ts), which runs the
 * same four scenarios through every backend and pins each expected answer. There
 * is no value in re-asserting `unchanged` here.
 *
 * What is left is everything specific to *these two services* — the split pair,
 * the write order, the failure translation, and the label encoding — which is
 * exactly the surface the shared parity test cannot see, because a directory has
 * none of it.
 */

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

const RUNNER: RenderIdentity = { ...MAC, platform: 'linux/x64' };

const WHITE = image([255, 255, 255]);
const BLACK = image([0, 0, 0]);

function image(colour: readonly [number, number, number]): string {
  const png = new PNG({ width: 4, height: 4 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = colour[0];
    png.data[index + 1] = colour[1];
    png.data[index + 2] = colour[2];
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png).toString('base64');
}

function raster(identity: RenderIdentity, bytes = WHITE): Raster {
  return {
    documentDigest: documentDigest({
      documentVersion: 1,
      subject: { id: 'story:a', kind: 'story' },
      html: bytes === WHITE ? '<i>before</i>' : '<i>after</i>',
      frame: { html: {}, body: {}, ancestors: [] },
      css: [],
      viewport: { width: 4, height: 4, deviceScaleFactor: 1, colorScheme: 'light' },
      inherited: {},
      fonts: [],
      diagnostics: [],
    }),
    identity,
    width: 4,
    height: 4,
    bytes,
    missingFonts: [],
  };
}

let db: SqliteD1;
let bucket: MemoryR2;

beforeEach(async () => {
  db = await createSqliteD1();
  bucket = createMemoryR2();
});

function store(project = 'todomvc'): ReturnType<typeof createCloudflareStore> {
  return createCloudflareStore({ db, bucket, project });
}

describe('a baseline split across D1 and R2', () => {
  it('reads back byte-identically', async () => {
    await store().put({ subject: 's' }, raster(MAC));

    const found = await store().find({ subject: 's' }, MAC);

    expect(found?.raster.bytes).toBe(WHITE);
    expect(found?.comparable).toBe(true);
    expect(found?.raster.identity).toEqual(MAC);
  });

  it('keeps one project out of another', async () => {
    // One deployment, several repositories. Nothing in the key of the *subject*
    // distinguishes them, so if the project did not scope both the row and the
    // object, two teams' `story:card` would be one baseline and the first symptom
    // would be a mass `changed` neither of them caused.
    await store('todomvc').put({ subject: 'story:card' }, raster(MAC, WHITE));
    await store('kitchen-sink').put({ subject: 'story:card' }, raster(MAC, BLACK));

    expect((await store('todomvc').find({ subject: 'story:card' }, MAC))?.raster.bytes).toBe(WHITE);
    expect((await store('kitchen-sink').find({ subject: 'story:card' }, MAC))?.raster.bytes).toBe(
      BLACK,
    );
  });

  it('replaces a baseline in place rather than accumulating one row per run', async () => {
    await store().put({ subject: 's' }, raster(MAC, WHITE));
    await store().put({ subject: 's' }, raster(MAC, BLACK));

    const rows = await db
      .prepare('SELECT COUNT(*) AS n FROM baselines')
      .bind()
      .first<{ readonly n: number }>();

    expect(rows?.n).toBe(1);
    expect((await store().find({ subject: 's' }, MAC))?.raster.bytes).toBe(BLACK);
  });

  it('names the machine that wrote a baseline this one cannot use', async () => {
    await store().put({ subject: 's' }, raster(RUNNER));

    const found = await store().find({ subject: 's' }, MAC);

    expect(found?.comparable).toBe(false);
    expect(found?.storedUnder.platform).toBe('linux/x64');
  });

  it('prefers this identity over another that also has the subject', async () => {
    // Both exist. Answering with the sibling would report `incomparable` for a
    // subject this very machine has a baseline for — a suite that goes red on a
    // machine that is entirely able to compare.
    await store().put({ subject: 's' }, raster(RUNNER, BLACK));
    await store().put({ subject: 's' }, raster(MAC, WHITE));

    const found = await store().find({ subject: 's' }, MAC);

    expect(found?.comparable).toBe(true);
    expect(found?.raster.bytes).toBe(WHITE);
  });
});

describe('the cheap lookup and the full one agree', () => {
  it('describes without moving the image', async () => {
    await store().put({ subject: 's' }, raster(MAC));

    const described = await store().describe({ subject: 's' }, MAC);

    expect(described).toEqual({
      documentDigest: raster(MAC).documentDigest,
      comparable: true,
      storedUnder: MAC,
    });
    expect(described).not.toHaveProperty('raster');
  });

  it('refuses to describe a baseline whose image is gone', async () => {
    // The failure this costs a HEAD to prevent. If `describe` answered from the
    // row alone it would report a comparable baseline, the caller would settle the
    // subject on 32 hex characters, and the image backing that answer would not
    // exist. The verdict would then depend on which question was asked.
    await store().put({ subject: 's' }, raster(MAC));
    await bucket.delete(bucket.keys());

    await expect(store().describe({ subject: 's' }, MAC)).rejects.toThrow(RasterStoreError);
    await expect(store().find({ subject: 's' }, MAC)).rejects.toThrow(/half there/);
  });

  it('answers null for a subject no identity has stored', async () => {
    expect(await store().describe({ subject: 'never-seen' }, MAC)).toBeNull();
    expect(await store().find({ subject: 'never-seen' }, MAC)).toBeNull();
  });
});

describe('a store failure is never a verdict', () => {
  it('raises an operator error when the bucket cannot be read', async () => {
    await store().put({ subject: 's' }, raster(MAC));
    bucket.fail('R2 is unavailable');

    // The specific thing being refused: not that it throws, but that it does not
    // return `null`. `null` becomes `new`, and `new` records whatever this build
    // painted over the only evidence of what the subject looked like before.
    await expect(store().find({ subject: 's' }, MAC)).rejects.toThrow(RasterStoreError);
  });

  it('raises an operator error when D1 cannot be reached', async () => {
    const broken = createCloudflareStore({
      db: {
        prepare: () => {
          throw new Error('no such table: baselines');
        },
        batch: async () => undefined,
      },
      bucket,
      project: 'todomvc',
    });

    await expect(broken.find({ subject: 's' }, MAC)).rejects.toThrow(/operator error/);
  });

  it('leaves no row behind when the image could not be written', async () => {
    // Object first, row second. The reverse order would leave a row pointing at
    // nothing, and that baseline throws on every run until a person deletes it.
    bucket.fail('R2 is unavailable');

    await expect(store().put({ subject: 's' }, raster(MAC))).rejects.toThrow(RasterStoreError);
    expect(await store().find({ subject: 's' }, MAC)).toBeNull();
  });

  it('refuses a sidecar row it cannot read as a raster record', async () => {
    await store().put({ subject: 's' }, raster(MAC));
    await db
      .prepare('UPDATE baselines SET identity = ? WHERE subject = ?')
      .bind('{"renderer":"only-this"}', 's')
      .run();

    await expect(store().find({ subject: 's' }, MAC)).rejects.toThrow(/not a raster record/);
  });
});

describe('the label encoding', () => {
  it('keeps a labelled baseline apart from an unlabelled one', async () => {
    await store().put({ subject: 's' }, raster(MAC, WHITE));
    await store().put({ subject: 's', label: 'narrow' }, raster(MAC, BLACK));

    expect((await store().find({ subject: 's' }, MAC))?.raster.bytes).toBe(WHITE);
    expect((await store().find({ subject: 's', label: 'narrow' }, MAC))?.raster.bytes).toBe(BLACK);
  });

  it('refuses an empty label rather than folding it into absence', async () => {
    await expect(store().put({ subject: 's', label: '' }, raster(MAC))).rejects.toThrow(
      /empty label/,
    );
  });
});

describe('the render cache', () => {
  it('returns an image already painted under this identity', async () => {
    const painted = raster(MAC);
    await store().cache(painted);

    expect(await store().cached(painted.documentDigest, MAC)).toEqual(painted);
  });

  it("does not hand another machine's render back as this one's", async () => {
    const painted = raster(RUNNER);
    await store().cache(painted);

    expect(await store().cached(painted.documentDigest, MAC)).toBeNull();
  });

  it('keeps the cache out of the baseline lookup', async () => {
    // A cached render is an image this run produced, not a baseline anybody
    // approved. If `find` could see it, the first run on a fresh subject would
    // compare against itself and report `unchanged` forever.
    await store().cache(raster(MAC));

    expect(await store().find({ subject: 'story:a' }, MAC)).toBeNull();
    expect(identityDigest(MAC)).not.toBe(identityDigest(RUNNER));
  });
});
