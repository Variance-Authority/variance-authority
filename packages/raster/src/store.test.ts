import { describe, expect, it } from 'vitest';
import {
  accessibilitySnapshot,
  type Raster,
  type RenderIdentity,
} from '@variance-authority/core/format';
import { identityFrom, neverFails } from './store.js';
import { createEphemeralStore } from './ephemeral.js';
import { rasterFrom } from './codec.js';

/**
 * The ephemeral mode — and the fact that it needs nothing.
 *
 * Both images are produced now, by one renderer, and thrown away, so the machine
 * cancels out by construction. There is no container to pin, no runner to match,
 * and no stored artifact. This file is where that argument stops being a claim in
 * a comment: it imports no filesystem and no socket, because the mode does not
 * have one.
 *
 * The disk-backed and wire-backed stores are tested where they live —
 * `@variance-authority/store` and `@variance-authority/remote` — against the same
 * contract, which is declared here.
 */


const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

/** Same browser, different machine. */
const RUNNER: RenderIdentity = { ...MAC, platform: 'linux/x64' };

function rasterOf(identity: RenderIdentity, digest = 'v1:doc', bytes = 'AAAA'): Raster {
  return { documentDigest: digest, identity, width: 10, height: 10, bytes, missingFonts: [] };
}

describe('the ephemeral mode', () => {
  it('has no past, so it never claims one', () => {
    // Both images are rendered in this run by one renderer, so there is no
    // stored artifact and no second machine to be wrong about.
    const store = createEphemeralStore();
    return expect(store.find({ subject: 's' }, MAC)).resolves.toBeNull();
  });

  it('serves back an image it was given, under the digest that painted it', async () => {
    const { renderCache } = createEphemeralStore();
    const raster = rasterOf(MAC, 'v1:x');

    expect(await renderCache.get('v1:x', MAC)).toBeNull();
    await renderCache.put(raster);
    expect(await renderCache.get('v1:x', MAC)).toEqual(raster);
  });

  it('misses on a different document, which is what makes the lever content-addressed', async () => {
    // "Identical" is a fact about the document rather than a guess about the
    // branch (Principle 4), so a rebase or a file move costs nothing and an edit
    // costs exactly the subjects it reached.
    const { renderCache } = createEphemeralStore();
    await renderCache.put(rasterOf(MAC, 'v1:x'));

    expect(await renderCache.get('v1:y', MAC)).toBeNull();
  });

  it('does not serve one machine`s render to another', async () => {
    const { renderCache } = createEphemeralStore();
    await renderCache.put(rasterOf(MAC, 'v1:x'));

    expect(await renderCache.get('v1:x', RUNNER)).toBeNull();
  });

  it('drops the least recently used render once the ceiling binds', async () => {
    // The mode that claims to store nothing used to hold every image it ever
    // painted, base64, until the process ended — so a wide suite kept its whole
    // output resident to serve a lookup only the current subject makes.
    const { renderCache } = createEphemeralStore({ heldBytes: 16 });
    const first = rasterOf(MAC, 'v1:a', 'AAAAAAAA');
    const second = rasterOf(MAC, 'v1:b', 'BBBBBBBB');
    const third = rasterOf(MAC, 'v1:c', 'CCCCCCCC');

    await renderCache.put(first);
    await renderCache.put(second);
    await renderCache.put(third);

    expect(await renderCache.get('v1:a', MAC)).toBeNull();
    expect(await renderCache.get('v1:c', MAC)).toEqual(third);
  });

  it('counts a hit as use, so the subject about to be asked again survives', async () => {
    // `again` and `alone` re-read the subject the run just observed, inline and
    // immediately. Evicting by insertion order would drop exactly that one.
    const { renderCache } = createEphemeralStore({ heldBytes: 16 });
    const first = rasterOf(MAC, 'v1:a', 'AAAAAAAA');
    const second = rasterOf(MAC, 'v1:b', 'BBBBBBBB');

    await renderCache.put(first);
    await renderCache.put(second);
    expect(await renderCache.get('v1:a', MAC)).toEqual(first);

    await renderCache.put(rasterOf(MAC, 'v1:c', 'CCCCCCCC'));
    expect(await renderCache.get('v1:a', MAC)).toEqual(first);
    expect(await renderCache.get('v1:b', MAC)).toBeNull();
  });

  it('keeps an image larger than the whole ceiling, rather than refusing the run', async () => {
    // A miss costs a render, and the entry just written is the one the caller is
    // working on: a cache that evicted it would answer nothing to the only
    // question anything was going to ask.
    const { renderCache } = createEphemeralStore({ heldBytes: 4 });
    const huge = rasterOf(MAC, 'v1:huge', 'X'.repeat(64));

    await renderCache.put(huge);
    expect(await renderCache.get('v1:huge', MAC)).toEqual(huge);
  });

  it('has nothing to describe either, and says so the same way', async () => {
    expect(await createEphemeralStore().describe({ subject: 's' }, MAC)).toBeNull();
  });
});

/**
 * The checks a record passes before it is believed, wherever it arrived from.
 *
 * A disk and a socket hand over the same value by different routes, so they are
 * checked by the same code. Two copies of this would be two ideas of what a
 * baseline is, and where a baseline is kept must decide nothing about what it
 * means.
 */
describe('a record that claims to be a raster', () => {
  it('is refused when it does not carry the machine that painted it', () => {
    expect(rasterFrom({ documentDigest: 'v1:d', width: 1, height: 1, bytes: 'AA' })).toBeNull();
  });

  it('is refused when the identity is missing the scale it was painted at', () => {
    // The field that went wrong once already: a lookup keyed on an identity
    // without a scale finds a 1x baseline for a 2x image and calls it comparable.
    expect(identityFrom({ ...MAC, deviceScaleFactor: undefined })).toBeNull();
  });

  it('is accepted whole, or not at all', () => {
    expect(rasterFrom(rasterOf(MAC))).toEqual(rasterOf(MAC));
  });

  it('accepts empty and boundary-partial ARIA trees as observed evidence', () => {
    const empty = accessibilitySnapshot(MAC.engine, ['']);
    const childless = accessibilitySnapshot(MAC.engine, ['- button "Save"']);

    expect(rasterFrom({ ...rasterOf(MAC), accessibility: empty })?.accessibility).toEqual(empty);
    expect(rasterFrom({ ...rasterOf(MAC), accessibility: childless })?.accessibility).toEqual(
      childless,
    );
  });

  it('carries every field the identity digest covers, including the optional ones', () => {
    // The failure this exists to stop, which is not "a field is missing" but "a
    // field is *dropped*". `stabilization` was absent from the codec, so an
    // identity survived being written and came back shortened — `accept` then
    // stored a baseline under one digest and the next `run` looked it up under
    // another, reporting `incomparable` on every subject forever, in a sentence
    // that named the same machine on both sides.
    //
    // Field-by-field rather than `toEqual` on the whole record, so that adding a
    // field to `RenderIdentity` and forgetting the codec fails here rather than
    // in somebody's durable workflow six weeks later.
    const stabilized: RenderIdentity = {
      ...MAC,
      stabilization: 'v1:recipe',
      rasterization: 'v1:launch',
    };

    expect(identityFrom(stabilized)).toEqual(stabilized);
    expect(Object.keys(identityFrom(stabilized) ?? {}).sort()).toEqual(
      Object.keys(stabilized).sort(),
    );
  });

  it('refuses a stabilization that is present and is not a digest', () => {
    // Refused rather than dropped, for the same reason: a value of the wrong
    // type is a writer this reader does not understand, and quietly discarding
    // it produces exactly the silent shortening above.
    expect(identityFrom({ ...MAC, stabilization: 7 })).toBeNull();
  });

  it('refuses a rasterization recipe that is present and is not a digest', () => {
    expect(identityFrom({ ...MAC, rasterization: 7 })).toBeNull();
  });
});

describe('a render cache never throws', () => {
  /** A backend whose every operation fails, which is what an outage looks like. */
  const broken = {
    async get(): Promise<Raster | null> {
      throw new Error('EACCES');
    },
    async put(): Promise<void> {
      throw new Error('ENOSPC');
    },
  };

  it('answers a failed lookup as a miss, because the response to both is to paint', async () => {
    // The rule the split exists for. A baseline that cannot be read is fatal —
    // reporting it as absent would record whatever is on screen over the only
    // copy of what the subject looked like. A cache that cannot be read costs a
    // render, and a build that goes red for it is red about an optimisation.
    expect(await neverFails(broken).get('v1:x', MAC)).toBeNull();
  });

  it('resolves a failed write, because the image is already in hand', async () => {
    await expect(neverFails(broken).put(rasterOf(MAC))).resolves.toBeUndefined();
  });

  it('still returns what a working cache returns', async () => {
    // The guard must not become the reason a hit is missed. A wrapper that
    // swallowed everything, including the answer, would turn the lever off
    // without turning any test red.
    const { renderCache } = createEphemeralStore();
    await renderCache.put(rasterOf(MAC, 'v1:x'));

    expect(await neverFails(renderCache).get('v1:x', MAC)).toEqual(rasterOf(MAC, 'v1:x'));
  });
});
