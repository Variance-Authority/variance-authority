import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CaptureArtifact } from '@variance-authority/core';
import {
  documentDigest,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
} from '@variance-authority/core/format';
import type { Renderer } from '@variance-authority/raster';
import { createDurableStore } from '@variance-authority/store/durable';
import { OBSERVE_COMMAND } from './protocol.js';
import { varianceCommands, variancePlugin } from './node.js';

/**
 * The Vitest-process half, with the browser replaced by a counter.
 *
 * What is under test is the lifetime and the acceptance rule — when a browser
 * opens, whose job it is to close it, and what has to be true before a
 * candidate becomes a baseline. None of that is about pixels, so the renderer
 * here paints one flat image and says so.
 */

const MACHINE: RenderIdentity = {
  renderer: 'fake',
  engine: 'fake@1',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

const IMAGE = ((): string => {
  const image = new PNG({ width: 8, height: 8 });
  image.data.fill(0xff);
  return PNG.sync.write(image).toString('base64');
})();

function fakeRenderer(machine: RenderIdentity = MACHINE): Renderer & { renders: number; closed: number } {
  const renderer = {
    identity: machine,
    renders: 0,
    closed: 0,
    identityFor(document: Pick<RenderDocument, 'viewport'>): RenderIdentity {
      return { ...machine, deviceScaleFactor: document.viewport.deviceScaleFactor };
    },
    async render(document: RenderDocument): Promise<Raster> {
      renderer.renders += 1;
      return {
        documentDigest: documentDigest(document),
        identity: renderer.identityFor(document),
        width: 8,
        height: 8,
        bytes: IMAGE,
        missingFonts: [],
      };
    },
    async close(): Promise<void> {
      renderer.closed += 1;
    },
  };
  return renderer;
}

function artifactFor(subject: string, html = '<div data-va-path="0">Save</div>'): CaptureArtifact {
  const document: RenderDocument = {
    documentVersion: 1,
    subject: { id: subject, kind: 'fixture' },
    html,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: { width: 320, height: 200, deviceScaleFactor: 1, colorScheme: 'light' },
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
  return {
    artifactVersion: 1,
    subject: document.subject,
    material: { kind: 'document', document },
  };
}

/** What Vitest hands a command when the run was started with `--update`. */
const UPDATING = { project: { vitest: { config: { snapshotOptions: { updateSnapshot: 'all' } } } } };

describe('the command the browser half calls', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'va-vitest-browser-'));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('reports a subject with no baseline as new, and stores nothing', async () => {
    const store = createDurableStore(root);
    const renderer = fakeRenderer();
    const commands = varianceCommands({ store, renderer, accept: false });

    const observed = await commands.varianceObserve(undefined, { artifact: artifactFor('a') });

    expect(observed.verdict).toBe('new');
    expect(observed.message).not.toBe('');
    expect(await store.find({ subject: 'a' }, renderer.identity)).toBeNull();
  });

  it('promotes the image this run painted when the run is accepting', async () => {
    const store = createDurableStore(root);
    const renderer = fakeRenderer();
    const commands = varianceCommands({ store, renderer, accept: true });

    await commands.varianceObserve(undefined, { artifact: artifactFor('b') });

    const found = await store.find({ subject: 'b' }, renderer.identity);
    expect(found?.raster.bytes).toBe(IMAGE);
    // From the run's own render cache: painting again here would store bytes
    // nobody compared.
    expect(renderer.renders).toBe(1);
  });

  it('reads the runner`s own `--update` when nothing was declared', async () => {
    const store = createDurableStore(root);
    const renderer = fakeRenderer();
    const commands = varianceCommands({ store, renderer });

    await commands.varianceObserve({}, { artifact: artifactFor('c') });
    expect(await store.find({ subject: 'c' }, renderer.identity)).toBeNull();

    await commands.varianceObserve(UPDATING, { artifact: artifactFor('c') });
    expect(await store.find({ subject: 'c' }, renderer.identity)).not.toBeNull();
  });

  describe('under `--update`, an image nothing compared', () => {
    // `--update` is a sweep: it reaches every selected test, and nobody named
    // this subject. An `incomparable` was compared with nothing, so the sweep
    // adopts only what `variance accept --all` would: the document the baseline
    // was painted from, re-painted under a new recipe and nothing else.
    const ANOTHER_MACHINE: RenderIdentity = { ...MACHINE, platform: 'linux/x64' };
    const OLD_RECIPE: RenderIdentity = { ...MACHINE, rasterization: 'v1:8040e1a2e35d148b301ebd30e5ed66c6' };
    const NEW_RECIPE: RenderIdentity = { ...MACHINE, rasterization: 'v1:54323cded938fde38b41cdd3865368fe' };

    async function baseline(subject: string, machine: RenderIdentity, html?: string): Promise<void> {
      const commands = varianceCommands({ store: createDurableStore(root), renderer: fakeRenderer(machine), accept: true });
      await commands.varianceObserve(undefined, { artifact: artifactFor(subject, html) });
    }

    it('keeps another machine`s baseline out of this run`s partition', async () => {
      await baseline('e', ANOTHER_MACHINE);
      const store = createDurableStore(root);
      const renderer = fakeRenderer();

      const observed = await varianceCommands({ store, renderer }).varianceObserve(UPDATING, { artifact: artifactFor('e') });

      expect(observed.verdict).toBe('incomparable');
      expect((await store.find({ subject: 'e' }, renderer.identity))?.comparable).toBe(false);
    });

    it('keeps a re-painted recipe whose document moved too', async () => {
      await baseline('f', OLD_RECIPE, '<div data-va-path="0">Cancel</div>');
      const store = createDurableStore(root);
      const renderer = fakeRenderer(NEW_RECIPE);

      const observed = await varianceCommands({ store, renderer }).varianceObserve(UPDATING, { artifact: artifactFor('f') });

      expect(observed.verdict).toBe('incomparable');
      expect((await store.find({ subject: 'f' }, renderer.identity))?.comparable).toBe(false);
    });

    it('adopts the same document re-painted under a new recipe alone', async () => {
      await baseline('g', OLD_RECIPE);
      const store = createDurableStore(root);
      const renderer = fakeRenderer(NEW_RECIPE);

      await varianceCommands({ store, renderer }).varianceObserve(UPDATING, { artifact: artifactFor('g') });

      expect((await store.find({ subject: 'g' }, renderer.identity))?.comparable).toBe(true);
    });

    it('adopts another machine`s subject when the run declares itself a baseline writer', async () => {
      await baseline('h', ANOTHER_MACHINE);
      const store = createDurableStore(root);
      const renderer = fakeRenderer();

      await varianceCommands({ store, renderer, accept: true }).varianceObserve(undefined, { artifact: artifactFor('h') });

      expect((await store.find({ subject: 'h' }, renderer.identity))?.comparable).toBe(true);
    });
  });

  it('leaves a renderer it was handed to the caller that handed it over', async () => {
    const renderer = fakeRenderer();
    const commands = varianceCommands({ store: createDurableStore(root), renderer, accept: false });

    await commands.varianceObserve(undefined, { artifact: artifactFor('d') });
    await commands.close();

    expect(renderer.closed).toBe(0);
  });
});

describe('the plugin a Vitest config registers', () => {
  it('registers the command under the name the tab calls', async () => {
    const plugin = variancePlugin({
      renderer: fakeRenderer(),
      store: createDurableStore(await mkdtemp(join(tmpdir(), 'va-vitest-plugin-'))),
    });

    expect(plugin.name).toBe('variance-authority');
    expect(typeof plugin.config().test.browser.commands[OBSERVE_COMMAND]).toBe('function');
  });
});
