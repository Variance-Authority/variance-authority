import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { recordOf, renderComment } from '@variance-authority/cli';
import { hashComponents } from '@variance-authority/core/attribute';
import { normalize } from '@variance-authority/core/rules';
import { observeRasters, packSnapshot } from '@variance-authority/observe';
import { acquireFromAgent, createHarness } from '@variance-authority/playwright';
import { createPlaywrightRenderer } from '@variance-authority/playwright/renderer';
import { changeImages } from '@variance-authority/png';
import { toolByName } from '@variance-authority/mcp/tools';
import { indexDeclarations } from '@variance-authority/sense';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = join(HERE, '..');
export const REPOSITORY_ROOT = join(PACKAGE_ROOT, '..', '..');
export const ARTIFACT_ROOT = join(PACKAGE_ROOT, 'artifacts');

const SOURCE_FILE = join(PACKAGE_ROOT, 'src', 'plans.js');
const AGENT_ENTRY = join(PACKAGE_ROOT, 'src', 'page-agent.js');
const HARNESS_PAGE = join(PACKAGE_ROOT, 'page', 'harness.html');
const SUBJECT = 'pricing/plans';
const VIEWPORT = { width: 480, height: 440, deviceScaleFactor: 1, colorScheme: 'light' };
/** Where the comment's pictures resolve: this example's artifacts on `main`. */
const IMAGE_ROOT =
  'https://raw.githubusercontent.com/Variance-Authority/variance-authority/main/examples/visual-review-case/artifacts';
const FONTS = ['Arial/400/normal/system', 'Arial/600/normal/system'];

async function agentBundle() {
  const result = await build({ entryPoints: [AGENT_ENTRY], bundle: true, format: 'iife', target: 'es2022', write: false });
  const [output] = result.outputFiles;
  if (output === undefined) throw new Error('esbuild produced no page-agent bundle');
  return output.text;
}

/**
 * One side: the page agent's document and snapshot, read from one mount through
 * `acquireFromAgent` as the shipped collectors read theirs, and the document
 * painted by the shipped Playwright renderer, which stamps the raster's
 * document digest, identity and missing fonts itself.
 */
async function read(harness, renderer, variant) {
  const json = await acquireFromAgent(harness.page, undefined, {
    subject: 'plans',
    variant,
    subjectId: SUBJECT,
    viewport: VIEWPORT,
    engine: harness.engine,
    fonts: FONTS,
  });
  const { document, capture } = JSON.parse(json);
  const snapshot = normalize(capture);
  const raster = await renderer.render(document);
  if (raster.bytes === undefined) throw new Error(`the ${variant} side painted no pixels`);
  return { snapshot, raster, png: Buffer.from(raster.bytes, 'base64') };
}

/**
 * Run the comparison whose artifacts the visual-review pages show.
 *
 * No shipped command runs this end to end: `variance run` reads its subjects
 * through a collector, and this page is a plain script. So the script calls the
 * pieces `variance run` calls, each for its own value, and assembles only the
 * run report itself, in the shape `variance run` writes.
 */
export async function runVisualReviewCase() {
  const harness = await createHarness({
    url: pathToFileURL(HARNESS_PAGE).href,
    bundle: await agentBundle(),
    viewport: VIEWPORT,
    fonts: FONTS,
    subjectId: () => SUBJECT,
  });
  const renderer = await createPlaywrightRenderer({ fonts: FONTS });

  try {
    const before = await read(harness, renderer, 'before');
    const after = await read(harness, renderer, 'after');
    const sourcePath = relative(REPOSITORY_ROOT, SOURCE_FILE);
    const source = indexDeclarations(sourcePath, await readFile(SOURCE_FILE, 'utf8'));

    // The pair the comparison decoded and the row pairing it settled, which
    // `variance run` draws its pictures from rather than aligning again.
    let compared;
    // The evidence a run attaches to the rasters it compares: on the before
    // side, what `variance run` writes beside a candidate it may promote to a
    // baseline; on the after side, the component hashes of this run's snapshot.
    const observation = await observeRasters(
      SUBJECT,
      { ...before.raster, components: hashComponents(before.snapshot), snapshot: packSnapshot(before.snapshot) },
      { ...after.raster, components: hashComponents(after.snapshot) },
      {
        snapshot: after.snapshot,
        source,
        keep: (pixels) => {
          compared = pixels;
        },
      },
    );
    // The pictures `variance run` writes beside a changed subject: the whole
    // difference, and the sheet that cuts it at the regions, before beside after.
    if (compared === undefined) throw new Error('the comparison kept no pixels to draw from');
    const { diff, change } = changeImages(
      compared.before,
      compared.after,
      observation.isolation?.regions ?? [],
      undefined,
      { subject: SUBJECT, before: 'baseline', after: 'this run' },
      compared.aligned,
    );
    const record = {
      ...recordOf(observation, { source }),
      images: { before: 'before.png', after: 'after.png', diff: 'diff.png', change: 'change.png' },
    };
    // Assembled here, in the fields `variance run` writes: no shipped function
    // builds a run report outside that command.
    const runReport = {
      runVersion: 1,
      at: new Date().toISOString(),
      identity: renderer.identity,
      retention: 'durable',
      observations: [record],
      notObserved: [],
    };
    const report = toolByName('variance_describe').run(runReport, { subject: SUBJECT });
    // The pull-request comment `variance comment` posts for this run, its
    // pictures read from where the example keeps them.
    const comment = renderComment({ project: 'visual-review-case', report: runReport, imageRoot: IMAGE_ROOT });

    return {
      before: before.snapshot,
      after: after.snapshot,
      observation,
      record,
      runReport,
      report,
      comment,
      beforePng: before.png,
      afterPng: after.png,
      diffPng: diff,
      changePng: change,
      engine: renderer.identity.engine,
    };
  } finally {
    await renderer.close();
    await harness.close();
  }
}
