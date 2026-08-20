import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { causesBetween, hashComponents, indexSource, normalize } from '@variance-authority/core';
import { createHarness } from '@variance-authority/playwright';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';
import { SUBJECTS } from '../src/system.js';

/**
 * The half of a run the CLI cannot write — and, under ephemeral retention, the
 * half that has to be able to produce **two** documents per subject.
 *
 * That is the whole cost of rung 0 in [`flows.md`](../../../docs/flows.md): no
 * store, no bucket, no credentials, no pinned runner, because both images are
 * rendered now by one renderer and thrown away. A collector that can only mount
 * the current checkout does not satisfy it, and the run says so per subject
 * rather than reporting those subjects clean.
 *
 * Here the two revisions are a parameter, which is the cheapest possible way to
 * hold both — a real project would check the other one out, or mount it from a
 * built bundle. Everything downstream of `collect()` is unaware of the
 * difference.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, '..');
const REPOSITORY_ROOT = join(PACKAGE_ROOT, '..', '..');
const SYSTEM_SOURCE = join(PACKAGE_ROOT, 'src', 'system.js');
const AGENT_BUNDLE = join(PACKAGE_ROOT, 'dist', 'page-agent.bundle.js');

/**
 * Read the page half; never build it.
 *
 * A collector is adopter code — the CLI `import()`s it by the path a config
 * names — so it may not drag a bundler into anyone's install. A missing bundle
 * is a build-ordering problem and says so here, rather than arriving in a
 * browser as an agent that is simply not installed.
 */
async function agentBundle() {
  try {
    return await readFile(AGENT_BUNDLE, 'utf8');
  } catch {
    throw new Error(
      `no page-agent bundle at ${AGENT_BUNDLE}; run \`node scripts/agent-bundle.mjs\` first`,
    );
  }
}

async function acquire(page, request) {
  const raw = await page.evaluate(
    ([global, sent]) => {
      const agent = globalThis[global];
      if (agent === undefined) throw new Error(`missing page agent ${global}`);
      return agent.acquire(sent);
    },
    [AGENT_GLOBAL, request],
  );
  return JSON.parse(raw);
}

export default async function agentClaimCollector(context) {
  const { config } = context;
  const harness = await createHarness({
    url: pathToFileURL(join(PACKAGE_ROOT, 'page', 'harness.html')).href,
    bundle: await agentBundle(),
    viewport: config.viewport,
    fonts: config.fonts,
  });

  // Component to file, so a change names an edit rather than an identifier.
  const source = indexSource(
    relative(REPOSITORY_ROOT, SYSTEM_SOURCE),
    await readFile(SYSTEM_SOURCE, 'utf8'),
  );

  return {
    async plan() {
      return {
        subjects: Object.keys(SUBJECTS).map((id) => ({ subject: { id, kind: 'fixture' } })),
        notObserved: [],
        warnings: [],
      };
    },

    async collect(planned) {
      const request = {
        subjectId: planned.subject.id,
        viewport: planned.viewport ?? config.viewport,
        engine: harness.engine,
        fonts: config.fonts,
      };

      const before = await acquire(harness.page, { ...request, revision: 'before' });
      const after = await acquire(harness.page, { ...request, revision: 'after' });

      const wasSnapshot = normalize(before.capture);
      const snapshot = normalize(after.capture);

      return {
        ok: true,
        document: after.document,
        before: before.document,
        snapshot,
        source,
        // The one thing a durable run cannot compute and this one can: naming
        // the *roots* of the change needs both snapshots, and ephemeral
        // retention is the mode that has them. Without it, region ordering falls
        // back to area — which ranks the displaced above the displacer.
        causes: causesBetween(hashComponents(wasSnapshot), hashComponents(snapshot)),
      };
    },

    async close() {
      await harness.close();
    },
  };
}
