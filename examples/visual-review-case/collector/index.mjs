import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { normalize } from '@variance-authority/core/rules';
import { acquireFromAgent, createHarness } from '@variance-authority/playwright';
import { indexDeclarations } from '@variance-authority/sense';

/**
 * The half of `variance run` the CLI cannot write: mount the pricing plans and
 * hand back their document, snapshot and source index.
 *
 * Which revision is mounted is `VISUAL_REVIEW_VARIANT`, `before` or `after`,
 * the cheapest way to hold two revisions in one checkout; a real project checks
 * the other one out. The run accepted on `before` is the baseline the run on
 * `after` is compared with.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(HERE, '..');
const REPOSITORY_ROOT = join(PACKAGE_ROOT, '..', '..');
const SOURCE_FILE = join(PACKAGE_ROOT, 'src', 'plans.js');
const AGENT_BUNDLE = join(PACKAGE_ROOT, 'dist', 'page-agent.bundle.js');
const SUBJECT = 'pricing-plans';

/** Read the page half; never build it, since the CLI imports this file. */
async function agentBundle() {
  try {
    return await readFile(AGENT_BUNDLE, 'utf8');
  } catch {
    throw new Error(`no page-agent bundle at ${AGENT_BUNDLE}; run \`node scripts/generate.mjs\``);
  }
}

export default async function visualReviewCollector({ config }) {
  const variant = process.env.VISUAL_REVIEW_VARIANT;
  if (variant !== 'before' && variant !== 'after') {
    throw new Error(`VISUAL_REVIEW_VARIANT is ${JSON.stringify(variant)}; set it to \`before\` or \`after\``);
  }
  const harness = await createHarness({
    url: pathToFileURL(join(PACKAGE_ROOT, 'page', 'harness.html')).href,
    bundle: await agentBundle(),
    viewport: config.viewport,
    fonts: config.fonts,
    subjectId: () => SUBJECT,
  });
  const source = indexDeclarations(relative(REPOSITORY_ROOT, SOURCE_FILE), await readFile(SOURCE_FILE, 'utf8'));

  return {
    async plan() {
      return { subjects: [{ subject: { id: SUBJECT, kind: 'fixture' } }], notObserved: [], warnings: [] };
    },

    async collect(planned) {
      const json = await acquireFromAgent(harness.page, undefined, {
        subject: 'plans',
        variant,
        subjectId: planned.subject.id,
        viewport: planned.viewport ?? config.viewport,
        engine: harness.engine,
        fonts: config.fonts,
      });
      const { document, capture } = JSON.parse(json);
      return { ok: true, document, snapshot: normalize(capture), source };
    },

    async close() {
      await harness.close();
    },
  };
}
