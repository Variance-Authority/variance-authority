import { chmod, mkdtemp, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  Raster,
  RenderDocument,
  RenderIdentity,
  Viewport,
} from '@variance-authority/core/format';
import {
  accessibilitySnapshot,
  documentDigest,
  identityDigest,
} from '@variance-authority/core/format';
import { RasterStoreError } from '@variance-authority/raster';
import { createDurableStore } from './durable.js';

/**
 * The durable mode: images that cross time, and therefore cross machines.
 *
 * Pixels do not survive that crossing, so every test below is about the store
 * refusing to pretend otherwise — and about the failures that look exactly like
 * an empty directory unless somebody insists they do not.
 */

const VIEWPORT: Viewport = { width: 100, height: 100, deviceScaleFactor: 1, colorScheme: 'light' };

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

/** Same browser, different machine. The case the durable mode exists for. */
const RUNNER: RenderIdentity = { ...MAC, platform: 'linux/x64' };

function rasterOf(identity: RenderIdentity, digest = 'v1:doc', bytes = 'AAAA'): Raster {
  return { documentDigest: digest, identity, width: 10, height: 10, bytes, missingFonts: [] };
}

function documentOf(html: string): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id: 's', kind: 'fixture' },
    html,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-raster-'));
});
afterEach(async () => {
  // Restored first: a test that took a read permission away would otherwise leave
  // a directory this process cannot remove.
  await chmod(root, 0o700).catch(() => {});
  await rm(root, { recursive: true, force: true });
});

/** The layout, spelled out, so a test can damage one half of a pair. */
function pathOf(identity: RenderIdentity, subject: string): string {
  return join(root, identityDigest(identity), subject);
}

/**
 * Permissions are advisory for root, so the two EACCES tests below cannot run
 * there. Skipped by name rather than by silently passing, because a suite that
 * reports a covered case it did not exercise is worse than one that says so.
 */
const asRoot = process.getuid?.() === 0;

describe('the durable mode', () => {
  it('round-trips a baseline for the machine that wrote it', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'todo--empty' }, rasterOf(MAC, 'v1:doc', 'QUJD'));

    const found = await store.find({ subject: 'todo--empty' }, MAC);

    expect(found?.comparable).toBe(true);
    expect(found?.raster.bytes).toBe('QUJD');
  });

  it('round-trips a subject id longer than a filename', async () => {
    // A suite that names subjects after the test that produced them passes 255
    // bytes on ordinary tests. The store answering ENAMETOOLONG would make the
    // longest-named subjects the ones nobody can baseline.
    const store = createDurableStore(root);
    const stem = `mui-material/src/Tabs/Tabs.test/${'keyboard-navigation-'.repeat(12)}`;
    await store.put({ subject: `${stem}/first` }, rasterOf(MAC, 'v1:doc', 'QUJD'));
    await store.put({ subject: `${stem}/second` }, rasterOf(MAC, 'v1:doc', 'REVG'));

    expect((await store.find({ subject: `${stem}/first` }, MAC))?.raster.bytes).toBe('QUJD');
    expect((await store.find({ subject: `${stem}/second` }, MAC))?.raster.bytes).toBe('REVG');
  });

  it('round-trips browser accessibility evidence in both lookup tiers', async () => {
    const accessibility = accessibilitySnapshot(MAC.engine, ['- button "Save"']);
    const store = createDurableStore(root);
    await store.put({ subject: 'button' }, { ...rasterOf(MAC), accessibility });

    expect((await store.find({ subject: 'button' }, MAC))?.raster.accessibility).toEqual(
      accessibility,
    );
    expect((await store.describe({ subject: 'button' }, MAC))?.accessibility).toEqual(
      accessibility,
    );
  });

  it('finds another machine`s baseline and refuses to call it comparable', async () => {
    // The whole rule. Returning `null` here would report "new subject", and
    // "we have never seen this" is a different and far less useful sentence
    // than "we have seen this, on a machine you are not".
    const store = createDurableStore(root);
    await store.put({ subject: 'todo--empty' }, rasterOf(RUNNER));

    const found = await store.find({ subject: 'todo--empty' }, MAC);

    expect(found).not.toBeNull();
    expect(found?.comparable).toBe(false);
    expect(found?.storedUnder.platform).toBe('linux/x64');
  });

  it('separates baselines by scale factor', async () => {
    // A retina laptop and a 1x runner paint different images of the same page.
    // Sharing a baseline between them is a diff of the machines.
    const store = createDurableStore(root);
    await store.put({ subject: 's' }, rasterOf({ ...MAC, deviceScaleFactor: 2 }));

    const found = await store.find({ subject: 's' }, MAC);
    expect(found?.comparable).toBe(false);
  });

  it('separates baselines by label, so one subject can hold several', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 's', label: 'wide' }, rasterOf(MAC, 'v1:a', 'QQ=='));
    await store.put({ subject: 's', label: 'narrow' }, rasterOf(MAC, 'v1:b', 'Qg=='));

    expect((await store.find({ subject: 's', label: 'wide' }, MAC))?.raster.bytes).toBe('QQ==');
    expect((await store.find({ subject: 's', label: 'narrow' }, MAC))?.raster.bytes).toBe('Qg==');
  });

  it('reports nothing for a subject nobody has ever rendered', async () => {
    const store = createDurableStore(root);
    expect(await store.find({ subject: 'never-seen' }, MAC)).toBeNull();
  });

  it('survives a subject id that is not a filename', async () => {
    const store = createDurableStore(root);
    await store.put({ subject: 'components/Button--primary state' }, rasterOf(MAC));

    const found = await store.find({ subject: 'components/Button--primary state' }, MAC);
    expect(found?.comparable).toBe(true);
  });

  it('caches renders across runs, keyed by what is painted', async () => {
    // The deferral lever surviving process exit: an unchanged document under an
    // unchanged identity has an image already, so a run over 300 subjects where
    // two changed pays for two images. Two stores over one root, because
    // surviving *this* process is the whole claim.
    const painted = rasterOf(MAC, documentDigest(documentOf('<div data-va-path="0">x</div>')));

    await createDurableStore(root).renderCache.put(painted);

    expect(await createDurableStore(root).renderCache.get(painted.documentDigest, MAC)).toEqual(
      painted,
    );
  });

  it.todo(
    'every baseline in a durable store is still found after the repository that produced it is rebased — needs a checkout, a rebase that rewrites the commits, and a second run counting how many subjects come back `new`, which is spec §10 with `0 baseline breakage across rebase`',
  );
});

/**
 * A store that cannot read is not a store that read nothing.
 *
 * Every test here is the same test. `null` from a lookup means `new`, `new`
 * records whatever this build painted, and the baseline it overwrites was the
 * only copy of what the subject looked like before. So a lookup may answer `null`
 * for exactly one reason — both halves of the pair are absent — and must throw
 * for every other, including the ones that arrive as an errno rather than as a
 * decision: a truncated cache restore, a permission change, a descriptor
 * exhausted by a wide run.
 */
describe('a baseline the store cannot read', () => {
  it('refuses an image whose sidecar is missing rather than reporting a new subject', async () => {
    // A `.png` with no `.json` is a corrupted baseline, not a missing one. A CI
    // cache restore that ran out of space leaves exactly this, and reporting it as
    // absent destroys the image that survived on the next `accept`.
    const store = createDurableStore(root);
    await store.put({ subject: 'todo--empty' }, rasterOf(MAC));
    await unlink(`${pathOf(MAC, 'todo--empty')}.json`);

    await expect(store.find({ subject: 'todo--empty' }, MAC)).rejects.toBeInstanceOf(
      RasterStoreError,
    );
    await expect(store.find({ subject: 'todo--empty' }, MAC)).rejects.toThrow(/half there/);
  });

  it('refuses a sidecar whose image is missing rather than reporting a new subject', async () => {
    // The other half of the same pair, and the direction an interrupted `put`
    // cannot produce — which is why finding it means something is wrong with the
    // directory rather than with the write that made it.
    const store = createDurableStore(root);
    await store.put({ subject: 'todo--empty' }, rasterOf(MAC));
    await unlink(`${pathOf(MAC, 'todo--empty')}.png`);

    await expect(store.find({ subject: 'todo--empty' }, MAC)).rejects.toThrow(/half there/);
  });

  it('refuses a sidecar that is not readable JSON rather than reporting a new subject', async () => {
    // The shape a truncated write actually takes: valid bytes, cut off mid-object.
    const store = createDurableStore(root);
    await store.put({ subject: 's' }, rasterOf(MAC));
    await writeFile(`${pathOf(MAC, 's')}.json`, '{"documentDigest":"v1:do', 'utf8');

    await expect(store.find({ subject: 's' }, MAC)).rejects.toThrow(/not readable JSON/);
  });

  it('refuses a sidecar that parses to something that is not a raster', async () => {
    // A sidecar written by another tool, or by a version of this one that spelled
    // the fields differently. Casting it would put `undefined` where a digest goes
    // and compare it against a real one, which is a verdict invented by a parser.
    const store = createDurableStore(root);
    await store.put({ subject: 's' }, rasterOf(MAC));
    await writeFile(`${pathOf(MAC, 's')}.json`, '{"documentDigest":"v1:doc"}', 'utf8');

    await expect(store.find({ subject: 's' }, MAC)).rejects.toThrow(/not a raster record/);
  });

  it.skipIf(asRoot)(
    'refuses a sidecar it is not permitted to read rather than reporting a new subject',
    async () => {
      // EACCES after a permissions change, and the errno the finding is really
      // about: it is transient, it is not about this subject, and read as a miss it
      // would take the baseline with it.
      const store = createDurableStore(root);
      await store.put({ subject: 's' }, rasterOf(MAC));
      await chmod(`${pathOf(MAC, 's')}.json`, 0o000);

      await expect(store.find({ subject: 's' }, MAC)).rejects.toThrow(/could not read/);
    },
  );

  it('answers the same damage two ways, because a cache and a baseline are not one thing', async () => {
    // **Reversed on 2026-08-04**, and the comment that stood here is the argument
    // the split refuted: *"a store that decides for itself which failures are
    // survivable has two rules"*. There are two rules and there always were —
    // they belong to two different objects. A baseline that cannot be read is
    // the only copy of what the subject looked like, so absence must never be
    // reported. A cache entry that cannot be read is a copy of something this
    // run is about to paint anyway. What changed is that the rule now lives in
    // the type rather than in each backend's judgement.
    //
    // Both halves asserted in one test on purpose: identical damage, one store,
    // two answers, and that is the whole of what the split bought.
    const store = createDurableStore(root);

    await store.renderCache.put(rasterOf(MAC, 'v1:doc'));
    await unlink(join(root, identityDigest(MAC), 'by-document', 'v1:doc.json'));
    expect(await store.renderCache.get('v1:doc', MAC)).toBeNull();

    await store.put({ subject: 'todo--empty' }, rasterOf(MAC));
    await unlink(`${pathOf(MAC, 'todo--empty')}.json`);
    await expect(store.find({ subject: 'todo--empty' }, MAC)).rejects.toBeInstanceOf(
      RasterStoreError,
    );
  });
});

/**
 * The lookup that answers from 32 hex characters instead of a megabyte.
 *
 * Whether a subject needs a comparison at all is decided by the document digest
 * in the sidecar and by which machine wrote it — both text, both a few hundred
 * bytes. `find` answers that question by reading the PNG and base64 encoding it,
 * which over three hundred subjects is the difference between a lookup pass and a
 * load. `describe` answers it from the sidecar, and is held to exactly the same
 * rule about failure.
 */
describe('a baseline lookup that does not need the image', () => {
  it.skipIf(asRoot)('answers without reading the image at all', async () => {
    // Unreadable bytes are how "did not read them" is stated as a fact rather than
    // as a timing. The full lookup on the same baseline fails, which is what makes
    // the claim mean something.
    const store = createDurableStore(root);
    await store.put({ subject: 'todo--empty' }, rasterOf(MAC, 'v1:painted'));
    await chmod(`${pathOf(MAC, 'todo--empty')}.png`, 0o000);

    const described = await store.describe({ subject: 'todo--empty' }, MAC);

    expect(described).toEqual({
      documentDigest: 'v1:painted',
      comparable: true,
      storedUnder: MAC,
      missingFonts: [],
    });
    await expect(store.find({ subject: 'todo--empty' }, MAC)).rejects.toBeInstanceOf(
      RasterStoreError,
    );
  });

  it('names the machine that wrote another machine`s baseline', async () => {
    // The cheap lookup has to carry the partition, or a run on the wrong machine
    // would settle to `new` and re-record — the failure the partition exists for.
    const store = createDurableStore(root);
    await store.put({ subject: 's' }, rasterOf(RUNNER));

    const described = await store.describe({ subject: 's' }, MAC);

    expect(described?.comparable).toBe(false);
    expect(described?.storedUnder.platform).toBe('linux/x64');
  });

  it('reports nothing for a subject nobody has ever rendered', async () => {
    expect(await createDurableStore(root).describe({ subject: 'never-seen' }, MAC)).toBeNull();
  });

  it('refuses a half-written baseline exactly as the full lookup does', async () => {
    // The two lookups must not disagree about whether a baseline exists. If the
    // cheap one could report `new` where the expensive one refuses, the verdict
    // would depend on which question the caller happened to ask.
    const store = createDurableStore(root);
    await store.put({ subject: 's' }, rasterOf(MAC));
    await unlink(`${pathOf(MAC, 's')}.png`);

    await expect(store.describe({ subject: 's' }, MAC)).rejects.toThrow(/half there/);
  });
});

/**
 * The `beside` layout: a baseline in the directory holding the thing it depicts.
 *
 * The placement exists so baselines arrive with a checkout, move when a component
 * moves, and are deleted by the commit that deletes it. What must not move with
 * it is the identity partition — a baseline painted elsewhere still has to land
 * somewhere this machine does not read.
 */
describe('the beside layout', () => {
  it('puts the image in the subject`s own directory', async () => {
    const store = createDurableStore(root, { layout: 'beside' });
    await store.put({ subject: 'src/ui/Button/primary' }, rasterOf(MAC, 'v1:doc', 'QUJD'));

    const files = await readdir(join(root, 'src', 'ui', 'Button', identityDigest(MAC)));

    expect(files.sort()).toEqual(['primary.json', 'primary.png']);
  });

  it('round-trips through the directory it wrote to', async () => {
    const store = createDurableStore(root, { layout: 'beside' });
    await store.put({ subject: 'src/ui/Button/primary' }, rasterOf(MAC, 'v1:doc', 'QUJD'));

    const found = await store.find({ subject: 'src/ui/Button/primary' }, MAC);

    expect(found?.comparable).toBe(true);
    expect(found?.raster.bytes).toBe('QUJD');
  });

  it('still refuses another machine`s baseline as incomparable', async () => {
    // The sibling scan moved down to the leaf directory; it did not go away.
    // Losing it here would turn a wrong-machine run back into `new`, which is
    // the one downgrade this whole layout is not allowed to buy.
    const store = createDurableStore(root, { layout: 'beside' });
    await store.put({ subject: 'src/ui/Button/primary' }, rasterOf(RUNNER));

    const found = await store.find({ subject: 'src/ui/Button/primary' }, MAC);

    expect(found?.comparable).toBe(false);
    expect(found?.storedUnder.platform).toBe('linux/x64');
  });

  it('does not read a neighbouring component`s directory as a machine identity', async () => {
    // `beside` puts partitions among ordinary directories. A scan that took
    // `Button/` for a machine would answer `incomparable` naming a component.
    const store = createDurableStore(root, { layout: 'beside' });
    await store.put({ subject: 'src/ui/Button/primary' }, rasterOf(MAC));
    await store.put({ subject: 'src/ui/Card/primary' }, rasterOf(MAC));

    expect(await store.find({ subject: 'src/ui/missing' }, MAC)).toBeNull();
  });

  it('refuses a subject id that would write outside the root', async () => {
    // The only layout whose write location is steered by the plan, so it is the
    // only one where a collector naming a subject `../../etc/hosts` matters.
    const store = createDurableStore(root, { layout: 'beside' });

    await expect(
      store.put({ subject: '../escaped/primary' }, rasterOf(MAC)),
    ).rejects.toThrow(RasterStoreError);
  });

  it('is not what a flat store does with the same id', async () => {
    const store = createDurableStore(root, { layout: 'flat' });
    await store.put({ subject: 'src/ui/Button/primary' }, rasterOf(MAC));

    const files = await readdir(join(root, identityDigest(MAC)));

    expect(files.sort()).toEqual(['src%2Fui%2FButton%2Fprimary.json', 'src%2Fui%2FButton%2Fprimary.png']);
  });
});

/**
 * `cacheRoot`: the tracked root holds baselines and nothing else.
 *
 * Every on-disk placement is a directory somebody commits. The render cache is
 * keyed by document digest, so it gains an entry per edit and is worth nothing
 * after the next one — committed alongside the baselines it is the larger half
 * of the directory within a week.
 */
describe('the render cache location', () => {
  it('lands under the baseline root when nothing says otherwise', async () => {
    const store = createDurableStore(root);
    await store.renderCache.put(rasterOf(MAC, 'v1:doc'));

    expect(await store.renderCache.get('v1:doc', MAC)).not.toBeNull();
    expect(await readdir(join(root, identityDigest(MAC)))).toContain('by-document');
  });

  it('leaves the baseline root untouched when it is pointed elsewhere', async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), 'variance-cache-'));
    try {
      const store = createDurableStore(root, { cacheRoot: elsewhere });
      await store.put({ subject: 'todo--empty' }, rasterOf(MAC));
      await store.renderCache.put(rasterOf(MAC, 'v1:doc'));

      expect(await store.renderCache.get('v1:doc', MAC)).not.toBeNull();
      expect(await readdir(join(root, identityDigest(MAC)))).toEqual([
        'todo--empty.json',
        'todo--empty.png',
      ]);
      expect(await readdir(join(elsewhere, identityDigest(MAC)))).toEqual(['by-document']);
    } finally {
      await rm(elsewhere, { recursive: true, force: true });
    }
  });
});
