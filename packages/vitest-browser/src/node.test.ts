import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { CaptureArtifact } from '@variance-authority/core';
import {
  CHROMIUM_PROFILE,
  digestFileName,
  documentDigest,
  environmentKey,
  identityDigest,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
  type SemanticSnapshot,
} from '@variance-authority/core/format';
import { keepImage } from '@variance-authority/png';
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

function imageOf(level: number): string {
  const image = new PNG({ width: 8, height: 8 });
  image.data.fill(level);
  return PNG.sync.write(image).toString('base64');
}

const IMAGE = imageOf(0xff);
/** What a durable store keeps, and hands back, for {@link IMAGE}. */
const KEPT = (await keepImage(Buffer.from(IMAGE, 'base64'))).toString('base64');
const DARK = imageOf(0x00);

function fakeRenderer(
  machine: RenderIdentity = MACHINE,
  bytes: string = IMAGE,
): Renderer & { renders: number; closed: number } {
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
        bytes,
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

/** The tree a collector read for a subject: one box, enough to be kept. */
const SNAPSHOT: SemanticSnapshot = {
  formatVersion: 1,
  subject: { id: 'k', kind: 'fixture' },
  profile: CHROMIUM_PROFILE,
  environment: environmentKey({
    profile: 'chromium',
    engine: 'chromium',
    ruleset: 'r',
    allowlist: 'a',
    viewport: { width: 8, height: 8, deviceScaleFactor: 1, colorScheme: 'light' },
    fonts: [],
    conditions: {},
    assets: {},
  }),
  renderHash: 'v1:r',
  structureHash: 'v1:s',
  styleHash: 'v1:t',
  root: { path: '0', tag: 'div', attributes: {}, style: {}, rect: { x: 0, y: 0, width: 8, height: 8 }, children: [] },
  styleProvenance: [],
  diagnostics: [],
};

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
    expect(found?.raster.bytes).toBe(KEPT);
    // From the run's own render cache: painting again here would store bytes
    // nobody compared.
    expect(renderer.renders).toBe(1);
  });

  it('files a baseline by the test file and the titles the test was declared under', async () => {
    const store = createDurableStore(root, { path: '{dir}/__baselines__/{file}/{title}/{name}-{engine}' });
    const renderer = fakeRenderer();
    const commands = varianceCommands({ store, renderer, accept: true });
    const context = { testPath: join(process.cwd(), 'src', 'ui', 'Button.test.tsx') };

    await commands.varianceObserve(context, {
      artifact: artifactFor('Button > renders primary'),
      titlePath: ['Button', 'renders primary'],
    });

    expect(await readdir(join(root, 'src/ui/__baselines__/Button.test.tsx/Button'))).toEqual([
      'renders-primary-fake.json',
      'renders-primary-fake.webp',
    ]);
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

  it('re-stamps an unchanged baseline that kept no snapshot on `--update`, so it keeps this one', async () => {
    // Written by a run that collected no tree, or before sidecars kept one.
    await varianceCommands({ store: createDurableStore(root), renderer: fakeRenderer(), accept: true }).varianceObserve(
      undefined,
      { artifact: artifactFor('k') },
    );
    const store = createDurableStore(root);
    const renderer = fakeRenderer();

    const observed = await varianceCommands({ store, renderer }).varianceObserve(UPDATING, {
      artifact: { ...artifactFor('k'), snapshot: SNAPSHOT },
    });

    expect(observed.verdict).toBe('unchanged');
    expect((await store.find({ subject: 'k' }, renderer.identity))?.raster.snapshot).toEqual(expect.any(String));
  });

  describe('a baseline painted under another identity', () => {
    // An upgrade moves every subject's identity at once: another machine, or
    // this tool's own recipe. Each is compared anyway, with what moved named as
    // the cause, and `--update` sweeps a change under a moved identity as it
    // sweeps any other.
    const ANOTHER_MACHINE: RenderIdentity = { ...MACHINE, platform: 'linux/x64' };
    const OLD_RECIPE: RenderIdentity = { ...MACHINE, rasterization: 'v1:8040e1a2e35d148b301ebd30e5ed66c6' };
    const NEW_RECIPE: RenderIdentity = { ...MACHINE, rasterization: 'v1:54323cded938fde38b41cdd3865368fe' };

    async function baseline(subject: string, machine: RenderIdentity, bytes?: string): Promise<void> {
      const commands = varianceCommands({
        store: createDurableStore(root),
        renderer: fakeRenderer(machine, bytes),
        accept: true,
      });
      await commands.varianceObserve(undefined, { artifact: artifactFor(subject) });
    }

    it('compares another machine`s baseline and names the platform that moved', async () => {
      await baseline('e', ANOTHER_MACHINE);
      const store = createDurableStore(root);
      const renderer = fakeRenderer();

      const observed = await varianceCommands({ store, renderer }).varianceObserve(undefined, { artifact: artifactFor('e') });

      expect(observed.verdict).toBe('unchanged');
      expect(observed.signals?.identity).toBe('machine');
      expect(observed.signals?.moved).toEqual(['platform linux/x64 → darwin/arm64']);
      expect((await store.find({ subject: 'e' }, renderer.identity))?.comparable).toBe(false);
    });

    it('re-stamps an unchanged subject under this run`s identity on `--update`', async () => {
      await baseline('i', ANOTHER_MACHINE);
      const store = createDurableStore(root);
      const renderer = fakeRenderer();

      await varianceCommands({ store, renderer }).varianceObserve(UPDATING, { artifact: artifactFor('i') });

      expect((await store.find({ subject: 'i' }, renderer.identity))?.comparable).toBe(true);
    });

    it('shows a change under a new recipe, with the recipe as its cause', async () => {
      await baseline('f', OLD_RECIPE, DARK);
      const store = createDurableStore(root);
      const renderer = fakeRenderer(NEW_RECIPE);

      const observed = await varianceCommands({ store, renderer, accept: false }).varianceObserve(UPDATING, {
        artifact: artifactFor('f'),
      });

      expect(observed.verdict).toBe('changed');
      expect(observed.signals?.identity).toBe('recipe');
      expect((await store.find({ subject: 'f' }, renderer.identity))?.comparable).toBe(false);
    });

    it('adopts a change under a new recipe on `--update`, as it adopts any change', async () => {
      await baseline('g', OLD_RECIPE, DARK);
      const store = createDurableStore(root);
      const renderer = fakeRenderer(NEW_RECIPE);

      await varianceCommands({ store, renderer }).varianceObserve(UPDATING, { artifact: artifactFor('g') });

      const found = await store.find({ subject: 'g' }, renderer.identity);
      expect(found?.comparable).toBe(true);
      expect(found?.raster.bytes).toBe(KEPT);
    });

    it('adopts another machine`s changed subject when the run declares itself a baseline writer', async () => {
      await baseline('h', ANOTHER_MACHINE, DARK);
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

describe('the timezone and locale a tab ran in', () => {
  it.todo(
    'paints in the timezone and locale the tab ran in, not UTC and en-US — needs the region the provider opened the tab in, carried across the command protocol',
  );
  it.todo(
    'keys a capture by the timezone and locale the tab ran in — needs the plugin to know whether the provider chose them or inherited the host',
  );
});

describe('the render cache a directory store keeps', () => {
  // A baseline root is one somebody commits, so the cache the run paints into
  // is kept in the checkout's cache, where `variance run` keeps it, and bounded
  // the way that run bounds it. `VARIANCE_AUTHORITY_CACHE` is the cache here.
  let root: string;
  let cache: string;
  let previous: string | undefined;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'va-vitest-renders-'));
    cache = join(root, 'cache');
    previous = process.env['VARIANCE_AUTHORITY_CACHE'];
    process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  });
  afterEach(async () => {
    if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
    else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
    await rm(root, { recursive: true, force: true });
  });

  const byDocument = (under: string): string =>
    join(under, digestFileName(identityDigest(MACHINE)), 'by-document');

  it('paints into the checkout`s cache, and leaves the baseline root to baselines', async () => {
    const baselines = join(root, 'baselines');
    const commands = varianceCommands({ baselines, renderer: fakeRenderer(), accept: true });

    await commands.varianceObserve(undefined, { artifact: artifactFor('a') });

    expect(await readdir(byDocument(join(cache, 'renders')))).toContainEqual(expect.stringMatching(/\.png$/));
    await expect(readdir(byDocument(baselines))).rejects.toThrow();
  });

  it('writes each baseline where `baselinePath` names it', async () => {
    const baselines = join(root, 'baselines');
    const commands = varianceCommands({
      baselines,
      baselinePath: '__baselines__/{title}/{name}-{engine}',
      renderer: fakeRenderer(),
      accept: true,
    });

    await commands.varianceObserve(undefined, {
      artifact: artifactFor('Button > renders primary'),
      titlePath: ['Button', 'renders primary'],
    });

    expect(await readdir(join(baselines, '__baselines__/Button'))).toEqual([
      'renders-primary-fake.json',
      'renders-primary-fake.webp',
    ]);
  });

  it('bounds that cache when the run closes, the way `variance run` does', async () => {
    const stale = join(byDocument(join(cache, 'renders')), 'v1:stale');
    await mkdir(join(stale, '..'), { recursive: true });
    await writeFile(`${stale}.png`, Buffer.alloc(16));
    await writeFile(`${stale}.json`, '{}\n', 'utf8');
    const month = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await utimes(`${stale}.png`, month, month);
    await utimes(`${stale}.json`, month, month);

    await varianceCommands({ baselines: join(root, 'baselines'), renderer: fakeRenderer() }).close();

    await expect(readdir(join(cache, 'renders'))).rejects.toThrow();
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
