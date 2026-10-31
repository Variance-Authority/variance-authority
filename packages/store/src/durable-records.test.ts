import { mkdtemp, readdir, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { createDurableStore } from './durable.js';
import { RED, kept } from './image.fixture.js';

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

/** Same browser, different machine. */
const RUNNER: RenderIdentity = { ...MAC, platform: 'linux/x64' };

function rasterOf(identity: RenderIdentity, digest = 'v1:doc', bytes = RED): Raster {
  return { documentDigest: digest, identity, width: 10, height: 10, bytes, missingFonts: [] };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-raster-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/**
 * `recordRoot`: version control sees the images and not the paperwork.
 *
 * A record changes whenever the document does, and the document changes for a
 * class name. Beside the image it makes a tracked diff out of every edit,
 * including every edit that moved no pixel — which is the one thing a reviewer
 * looking at an image diff cannot be asked to ignore.
 *
 * What does *not* change is the pair. Both halves are still written and both are
 * still read, so a record that went missing is still damage and still stops the
 * run.
 */
describe('the record location', () => {
  it('keeps both halves under the baseline root when nothing says otherwise', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'todo--empty' }, rasterOf(MAC));

    expect(await readdir(root)).toEqual(['todo--empty-chromium.json', 'todo--empty-chromium.webp']);
  });

  it('leaves the baseline root holding images alone when it is pointed elsewhere', async () => {
    const records = await mkdtemp(join(tmpdir(), 'variance-records-'));
    try {
      const store = createDurableStore(root, { recordRoot: records });
      await store.put({ subject: 'todo--empty' }, rasterOf(MAC, 'v1:doc', RED));

      expect(await readdir(root)).toEqual(['todo--empty-chromium.webp']);
      expect(await readdir(records)).toEqual(['todo--empty-chromium.json']);

      // And the halves are still one baseline to every reader.
      const found = await store.find({ subject: 'todo--empty' }, MAC);
      expect(found?.comparable).toBe(true);
      expect(found?.raster.bytes).toBe(await kept(RED));
      expect((await store.describe({ subject: 'todo--empty' }, MAC))?.pictured).toBe(true);
    } finally {
      await rm(records, { recursive: true, force: true });
    }
  });

  it('writes nothing at all under the baseline root for a subject with no pixels', async () => {
    // The case the split is for. A subject that occupies no pixels is entirely
    // record, so a split root leaves version control with no file to show — and
    // the baseline still has to be found, or the next run records it as new.
    const records = await mkdtemp(join(tmpdir(), 'variance-records-'));
    try {
      const store = createDurableStore(root, { recordRoot: records });
      await store.put(
        { subject: 'todo--empty' },
        { documentDigest: 'v1:doc', identity: MAC, missingFonts: [] },
      );

      expect(await readdir(root)).toEqual([]);
      expect((await store.describe({ subject: 'todo--empty' }, MAC))?.pictured).toBe(false);
      expect((await store.find({ subject: 'todo--empty' }, MAC))?.raster.bytes).toBeUndefined();
    } finally {
      await rm(records, { recursive: true, force: true });
    }
  });

  it('scans the record root for siblings, so a pixel-less baseline still names the machine that wrote it', async () => {
    // The sibling scan is the only thing that says "another machine has this"
    // rather than "nobody has". Scanning the images would answer the second for
    // every subject that has none.
    const records = await mkdtemp(join(tmpdir(), 'variance-records-'));
    try {
      const store = createDurableStore(root, { recordRoot: records });
      await store.put(
        { subject: 'todo--empty' },
        { documentDigest: 'v1:doc', identity: RUNNER, missingFonts: [] },
      );

      const found = await store.find({ subject: 'todo--empty' }, MAC);
      expect(found?.comparable).toBe(false);
      expect(found?.storedUnder.platform).toBe('linux/x64');
    } finally {
      await rm(records, { recursive: true, force: true });
    }
  });

  it('still refuses half a pair, and names the file in the root it was looked for in', async () => {
    const records = await mkdtemp(join(tmpdir(), 'variance-records-'));
    try {
      const store = createDurableStore(root, { recordRoot: records });
      await store.put({ subject: 'todo--empty' }, rasterOf(MAC));
      await unlink(join(records, 'todo--empty-chromium.json'));

      await expect(store.find({ subject: 'todo--empty' }, MAC)).rejects.toThrow(
        new RegExp(`half there.+${records}`, 's'),
      );
    } finally {
      await rm(records, { recursive: true, force: true });
    }
  });
});

/**
 * The other half of the plan.
 *
 * A discovered subject list makes an addition loud and a removal silent: the
 * new page is `new` and red, and the dropped page is simply never mentioned
 * again while its approved image stays where it was. These are about the store
 * being able to say which images those are.
 */
