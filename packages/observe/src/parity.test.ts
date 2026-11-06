import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';
import type {
  Raster,
  RenderDocument,
  RenderIdentity,
  Viewport,
} from '@variance-authority/core/format';
import { documentDigest } from '@variance-authority/core/format';
import {
  createRemoteStore,
  serveRasterStore,
  type StoreServer,
} from '@variance-authority/remote/store';
import { RasterStoreError } from '@variance-authority/raster';
import {
  DEFAULT_POLICY,
  identityAtScale,
  neverFails,
  type BaselineKey,
  type RasterStore,
  type Renderer,
} from '@variance-authority/raster';
import { createDurableStore } from '@variance-authority/store/durable';
import { createLfsStore, type CommandRunner } from '@variance-authority/store/lfs';
import { createBucketStore } from '@variance-authority/tribunal/store';
import { createMemoryR2, createSqliteD1 } from '@variance-authority/tribunal/testing';
import { observeAgainstBaseline, type RasterVerdict } from './observe.js';
import { keptRaster } from '@variance-authority/store/keep';

/**
 * Acceptance 4: where a baseline is kept decides nothing about what it means.
 *
 * A store is a place to put bytes. If moving that place changes a verdict, then
 * the verdict was never about the subject, and every argument this project makes
 * about attributing a change to a component collapses — the report would be
 * describing the deployment.
 *
 * The three stores are exercised through {@link observeAgainstBaseline} rather
 * than through their own methods, because the interesting surface is the verdict
 * and the verdict is produced above them. Each scenario pins its expected answer
 * as well as comparing the three: three stores agreeing on a wrong answer is not
 * a pass, and a test that only checked agreement could not tell the difference.
 */

const VIEWPORT: Viewport = { width: 10, height: 10, deviceScaleFactor: 1, colorScheme: 'light' };

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: [],
};

const RUNNER: RenderIdentity = { ...MAC, platform: 'linux/x64' };

const WHITE = png([255, 255, 255]);
const BLACK = png([0, 0, 0]);

/** A real PNG, because the comparison decodes one and a stub would not survive it. */
function png(colour: readonly [number, number, number]): string {
  const image = new PNG({ width: 10, height: 10 });
  for (let index = 0; index < image.data.length; index += 4) {
    image.data[index] = colour[0];
    image.data[index + 1] = colour[1];
    image.data[index + 2] = colour[2];
    image.data[index + 3] = 255;
  }
  return PNG.sync.write(image).toString('base64');
}

function documentOf(html: string): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id: 'story:a', kind: 'story' },
    html,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

const SAME = documentOf('<div data-va-path="0">as before</div>');
const EDITED = documentOf('<div data-va-path="0">edited</div>');

/** Paints what the document says, so a changed document is a changed image. */
function renderer(identity: RenderIdentity): Renderer & { calls: number } {
  const painted = {
    calls: 0,
    identity,
    identityFor: (document: RenderDocument): RenderIdentity =>
      identityAtScale(identity, document),
    async render(document: RenderDocument): Promise<Raster> {
      painted.calls += 1;
      return {
        documentDigest: documentDigest(document),
        identity: identityAtScale(identity, document),
        width: 10,
        height: 10,
        bytes: document.html.includes('edited') ? BLACK : WHITE,
        missingFonts: [],
      };
    },
    async close(): Promise<void> {},
  };
  return painted;
}

function baseline(identity: RenderIdentity): Raster {
  return {
    documentDigest: documentDigest(SAME),
    identity,
    width: 10,
    height: 10,
    bytes: WHITE,
    missingFonts: [],
  };
}

const TRACKED: CommandRunner = async (_command, args) =>
  args[1] === 'version'
    ? { code: 0, stdout: 'git-lfs/3.7.1\n', stderr: '' }
    : { code: 0, stdout: 'probe.png: filter: lfs\n', stderr: '' };

const directories: string[] = [];
const servers: StoreServer[] = [];
const databases: { close(): void }[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(servers.splice(0).map((server) => server.close()));
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

/**
 * A subject's key with the file that declares it, so a store that places by
 * `{dir}` can file it and one that does not still reads the subject alone.
 */
function at(subject: string): BaselineKey {
  return { subject, file: 'src/ui/Button.stories.tsx', title: 'Ui/Button', name: subject };
}

async function directory(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), 'va-parity-'));
  directories.push(made);
  return made;
}

/** Every durable implementation there is. Ephemeral is a different mode, not a store. */
const IMPLEMENTATIONS: readonly { readonly name: string; open(): Promise<RasterStore> }[] = [
  {
    name: 'durable',
    async open(): Promise<RasterStore> {
      return createDurableStore(await directory());
    },
  },
  {
    // The same store with every baseline beside the file that declares its
    // subject, under a readable name. Where the image sits is the one thing a
    // template changes, so it is the one thing that may not move a verdict.
    name: 'durable, beside the code',
    async open(): Promise<RasterStore> {
      return createDurableStore(await directory(), {
        path: '{dir}/__baselines__/{file}/{title}/{name}-{engine}',
      });
    },
  },
  {
    name: 'git-LFS',
    async open(): Promise<RasterStore> {
      return createLfsStore({ root: await directory(), git: TRACKED });
    },
  },
  {
    name: 'remote',
    async open(): Promise<RasterStore> {
      const server = await serveRasterStore(createDurableStore(await directory()));
      servers.push(server);
      return createRemoteStore({ endpoint: server.url });
    },
  },
  {
    // A database and an object store, which is the first backend here that keeps
    // the sidecar and the image in two different services. If a split pair can
    // change a verdict, this is where it shows.
    name: 'bucket',
    async open(): Promise<RasterStore> {
      const db = await createSqliteD1();
      databases.push(db);
      // A clock that moves between accepts, as one does between two runs: the
      // last accept is told apart by when it was made.
      let tick = Date.parse('2026-01-01T00:00:00Z');
      return createBucketStore({ db, bucket: createMemoryR2(), project: 'parity', now: () => new Date((tick += 1000)) });
    },
  },
];

interface Scenario {
  readonly name: string;
  readonly verdict: RasterVerdict;
  /** Pixels the default policy counts. `undefined` where no comparison happened. */
  readonly changed: number | undefined;
  prepare(store: RasterStore): Promise<void>;
  readonly document: RenderDocument;
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: 'a subject that did not move',
    verdict: 'unchanged',
    changed: 0,
    prepare: async (store) => store.put(at('s'), await keptRaster(baseline(MAC))),
    document: SAME,
  },
  {
    name: 'a subject that moved',
    verdict: 'changed',
    changed: 100,
    prepare: async (store) => store.put(at('s'), await keptRaster(baseline(MAC))),
    document: EDITED,
  },
  {
    name: 'a subject with no baseline',
    verdict: 'new',
    changed: undefined,
    prepare: async () => {},
    document: SAME,
  },
  {
    name: 'a baseline from another machine',
    verdict: 'unchanged',
    changed: 0,
    prepare: async (store) => store.put(at('s'), await keptRaster(baseline(RUNNER))),
    document: SAME,
  },
];

describe('switching where baselines are kept', () => {
  for (const scenario of SCENARIOS) {
    it(`reaches the same verdict on ${scenario.name} through every store`, async () => {
      const answers: Record<string, { verdict: RasterVerdict; changed: number | undefined }> = {};

      for (const implementation of IMPLEMENTATIONS) {
        const store = await implementation.open();
        await scenario.prepare(store);

        const observation = await observeAgainstBaseline(scenario.document, at('s'), {
          renderer: renderer(MAC),
          store,
        });

        answers[implementation.name] = {
          verdict: observation.verdict,
          changed: observation.comparison?.changed[DEFAULT_POLICY.id],
        };
      }

      const expected = { verdict: scenario.verdict, changed: scenario.changed };
      expect(answers).toEqual({
        durable: expected,
        'durable, beside the code': expected,
        'git-LFS': expected,
        remote: expected,
        bucket: expected,
      });
    });
  }

  it('answers the cheap lookup identically wherever the baseline is kept', async () => {
    // The metadata lookup decides whether a subject is compared at all, so a store
    // that answered it differently would change verdicts without ever touching a
    // pixel — acceptance 4 broken by the one query that never reads an image.
    // Absence is included deliberately: `null` is the answer that leads to `new`,
    // and `new` re-records.
    const answers: Record<string, unknown> = {};

    for (const implementation of IMPLEMENTATIONS) {
      const store = await implementation.open();
      await store.put(at('mine'), await keptRaster(baseline(MAC)));
      await store.put(at('theirs'), await keptRaster(baseline(RUNNER)));

      answers[implementation.name] = {
        mine: await store.describe(at('mine'), MAC),
        theirs: await store.describe(at('theirs'), MAC),
        neither: await store.describe(at('never-seen'), MAC),
      };
    }

    const expected = {
      mine: {
        documentDigest: documentDigest(SAME),
        comparable: true,
        storedUnder: MAC,
        pictured: true,
        keepsSnapshot: false,
        missingFonts: [],
      },
      theirs: {
        documentDigest: documentDigest(SAME),
        comparable: false,
        storedUnder: RUNNER,
        pictured: true,
        keepsSnapshot: false,
        missingFonts: [],
      },
      neither: null,
    };
    expect(answers).toEqual({
      durable: expected,
      'durable, beside the code': expected,
      'git-LFS': expected,
      remote: expected,
      bucket: expected,
    });
  });

  it('survives its render cache being broken, wherever the baseline is kept', async () => {
    // Acceptance for the split: a cache failure costs a render in every backend,
    // and a backend that forgot the wrapper still type-checks. So each one is
    // handed a cache that fails both ways and asked for the two answers a caller
    // depends on — a miss, and a write that resolves.
    //
    // The baseline half is deliberately not softened anywhere, and the parity
    // cases above are what keep that true: a store that started swallowing
    // baseline failures would go red there, not here.
    const answers: Record<string, unknown> = {};

    for (const implementation of IMPLEMENTATIONS) {
      const store = await implementation.open();
      const broken = neverFails({
        async get(): Promise<Raster | null> {
          throw new Error('the cache is unreachable');
        },
        async put(): Promise<void> {
          throw new Error('the cache is unreachable');
        },
      });

      answers[implementation.name] = {
        miss: await broken.get(documentDigest(SAME), MAC),
        wrote: await broken.put(baseline(MAC)).then(() => 'resolved'),
        // And the real cache still works, so the guard is not the reason a hit
        // is missed — the failure that would turn the lever off silently.
        hit: await store.renderCache
          .put(baseline(MAC))
          .then(() => store.renderCache.get(documentDigest(SAME), MAC))
          .then((raster) => raster?.documentDigest ?? null),
      };
    }

    const expected = { miss: null, wrote: 'resolved', hit: documentDigest(SAME) };
    expect(answers).toEqual({
      durable: expected,
      'durable, beside the code': expected,
      'git-LFS': expected,
      remote: expected,
      bucket: expected,
    });
  });

  it('carries the fonts the baseline was painted without, wherever it is kept', async () => {
    // The field that makes the cheap lookup usable for a verdict at all, and the
    // one every backend had in hand and dropped until 2026-08-04. A store that
    // answers `[]` here is not slightly wrong: settling reports a bare
    // `unchanged` for a baseline that is an image of a substituted typeface, and
    // no later stage can recover the fact because no image is read.
    //
    // Separate from the parity case above because that one asserts agreement on
    // an empty list, which every backend satisfies by forgetting the field.
    const answers: Record<string, unknown> = {};

    for (const implementation of IMPLEMENTATIONS) {
      const store = await implementation.open();
      await store.put(at('substituted'), await keptRaster({ ...baseline(MAC), missingFonts: ['Inter'] }));
      answers[implementation.name] = (await store.describe(at('substituted'), MAC))
        ?.missingFonts;
    }

    expect(answers).toEqual({
      durable: ['Inter'],
      'durable, beside the code': ['Inter'],
      'git-LFS': ['Inter'],
      remote: ['Inter'],
      bucket: ['Inter'],
    });
  });

  it('reads the last accept on this engine family when two machines both accept', async () => {
    // A laptop accepts, then CI accepts the same subject. A file keeps one
    // baseline per engine family, so the laptop now reads CI's, names the
    // machine as the cause, and compares. A store that kept both and preferred
    // the laptop's own would answer `unchanged` where the file answers with
    // CI's image. Another engine's later accept is not this family's.
    const WEBKIT: RenderIdentity = { ...MAC, renderer: 'playwright-webkit', engine: 'webkit@18.2' };
    const answers: Record<string, unknown> = {};

    for (const implementation of IMPLEMENTATIONS) {
      const store = await implementation.open();
      await store.put(at('s'), await keptRaster(baseline(MAC)));
      await store.put(at('s'), await keptRaster(baseline(RUNNER)));
      await store.put(at('s'), await keptRaster(baseline(WEBKIT)));

      const found = await store.describe(at('s'), MAC);
      answers[implementation.name] = { comparable: found?.comparable, storedUnder: found?.storedUnder };
    }

    const expected = { comparable: false, storedUnder: RUNNER };
    expect(answers).toEqual({
      durable: expected,
      'durable, beside the code': expected,
      'git-LFS': expected,
      remote: expected,
      bucket: expected,
    });
  });

  // FIXME: the bucket store's rows and the remote store's keys carry no
  // `project`, so two Playwright projects under `{project}` share one baseline
  // there while a file store keeps two.
  it.todo('two projects under {project} keep two baselines on every backend — needs `project` in the bucket row and the remote key');

  it('names the machine that wrote a baseline from another machine as the cause', async () => {
    // The verdict alone is not the deliverable. A wrong-machine run has to carry
    // the platform that moved, or an avalanche is a mass failure nobody can
    // attribute — which is the whole reason `find` looks under other identities.
    for (const implementation of IMPLEMENTATIONS) {
      const store = await implementation.open();
      await store.put(at('s'), await keptRaster(baseline(RUNNER)));

      const observation = await observeAgainstBaseline(SAME, at('s'), {
        renderer: renderer(MAC),
        store,
      });

      expect(observation.because).toContain('linux/x64');
      expect(observation.because).toContain('darwin/arm64');
      expect(observation.signals?.identity).toBe('machine');
    }
  });

  it('does not record a new baseline when the store cannot be reached', async () => {
    // Acceptance 3, end to end, and the reason a store failure is not a verdict:
    // the run fails, the renderer is never asked, and nothing is written. The
    // alternative is overwriting a baseline with whatever this build happens to
    // paint, and calling it a pass.
    const painter = renderer(MAC);
    const store = createRemoteStore({ endpoint: await deadEndpoint() });

    await expect(
      observeAgainstBaseline(SAME, at('s'), { renderer: painter, store }),
    ).rejects.toBeInstanceOf(RasterStoreError);

    expect(painter.calls).toBe(0);
  });
});

/** A URL nothing is listening on, obtained by binding a port and giving it back. */
async function deadEndpoint(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'va-dead-'));
  const shortLived = await serveRasterStore(createDurableStore(root));
  const url = shortLived.url;
  await shortLived.close();
  await rm(root, { recursive: true, force: true });
  return url;
}
