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

function fakeRenderer(): Renderer & { renders: number; closed: number } {
  const renderer = {
    identity: MACHINE,
    renders: 0,
    closed: 0,
    identityFor(document: Pick<RenderDocument, 'viewport'>): RenderIdentity {
      return { ...MACHINE, deviceScaleFactor: document.viewport.deviceScaleFactor };
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

function artifactFor(subject: string): CaptureArtifact {
  const document: RenderDocument = {
    documentVersion: 1,
    subject: { id: subject, kind: 'fixture' },
    html: '<div data-va-path="0">Save</div>',
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
