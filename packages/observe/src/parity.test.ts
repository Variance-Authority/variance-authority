import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { afterEach, describe, expect, it } from 'vitest';
import type { Raster, RenderDocument, RenderIdentity, Viewport } from '@variance-authority/core';
import { documentDigest } from '@variance-authority/core';
import {
  createRemoteStore,
  serveRasterStore,
  type StoreServer,
} from '@variance-authority/remote';
import { RasterStoreError } from '@variance-authority/raster';
import {
  DEFAULT_POLICY,
  identityAtScale,
  type RasterStore,
  type Renderer,
} from '@variance-authority/raster';
import {
  createDurableStore,
  createLfsStore,
  type CommandRunner,
} from '@variance-authority/store';
import { createBucketStore } from '@variance-authority/tribunal/store';
import { createMemoryR2, createSqliteD1 } from '@variance-authority/tribunal/testing';
import { observeAgainstBaseline, type RasterVerdict } from './observe.js';

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
      return createBucketStore({ db, bucket: createMemoryR2(), project: 'parity' });
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
    prepare: (store) => store.put({ subject: 's' }, baseline(MAC)),
    document: SAME,
  },
  {
    name: 'a subject that moved',
    verdict: 'changed',
    changed: 100,
    prepare: (store) => store.put({ subject: 's' }, baseline(MAC)),
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
    verdict: 'incomparable',
    changed: undefined,
    prepare: (store) => store.put({ subject: 's' }, baseline(RUNNER)),
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

        const observation = await observeAgainstBaseline(scenario.document, { subject: 's' }, {
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
      await store.put({ subject: 'mine' }, baseline(MAC));
      await store.put({ subject: 'theirs' }, baseline(RUNNER));

      answers[implementation.name] = {
        mine: await store.describe({ subject: 'mine' }, MAC),
        theirs: await store.describe({ subject: 'theirs' }, MAC),
        neither: await store.describe({ subject: 'never-seen' }, MAC),
      };
    }

    const expected = {
      mine: { documentDigest: documentDigest(SAME), comparable: true, storedUnder: MAC },
      theirs: { documentDigest: documentDigest(SAME), comparable: false, storedUnder: RUNNER },
      neither: null,
    };
    expect(answers).toEqual({
      durable: expected,
      'git-LFS': expected,
      remote: expected,
      bucket: expected,
    });
  });

  it('explains an incomparable baseline by naming the machine that wrote it', async () => {
    // The verdict alone is not the deliverable. A wrong-machine run has to be one
    // sentence with a platform in it, or it is a mass failure nobody can attribute
    // — which is the whole reason `find` looks under other identities at all.
    for (const implementation of IMPLEMENTATIONS) {
      const store = await implementation.open();
      await store.put({ subject: 's' }, baseline(RUNNER));

      const observation = await observeAgainstBaseline(SAME, { subject: 's' }, {
        renderer: renderer(MAC),
        store,
      });

      expect(observation.because).toContain('linux/x64');
      expect(observation.because).toContain('darwin/arm64');
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
      observeAgainstBaseline(SAME, { subject: 's' }, { renderer: painter, store }),
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
