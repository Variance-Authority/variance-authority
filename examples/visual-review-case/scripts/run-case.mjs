import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { formatSource, hashComponents, rankRegions, resolveSource } from '@variance-authority/core/attribute';
import { digestValue } from '@variance-authority/core/format';
import { normalize } from '@variance-authority/core/rules';
import { observeRasters, packSnapshot } from '@variance-authority/observe';
import { createHarness } from '@variance-authority/playwright';
import { diffImage } from '@variance-authority/png';
import { STRONG_GRADE } from '@variance-authority/raster';
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
const FONTS = ['Arial/400/normal/system', 'Arial/600/normal/system'];

async function agentBundle() {
  const result = await build({ entryPoints: [AGENT_ENTRY], bundle: true, format: 'iife', target: 'es2022', write: false });
  const [output] = result.outputFiles;
  if (output === undefined) throw new Error('esbuild produced no page-agent bundle');
  return output.text;
}

/** One side: the normalized snapshot, and its root shot to a raster. */
async function read(harness, variant, identity) {
  const snapshot = normalize(await harness.capture('plans', variant));
  const rect = snapshot.root.rect;
  if (rect === undefined) throw new Error('the snapshot has no root box to shoot');
  const png = await harness.page.screenshot({ clip: rect });
  const raster = {
    documentDigest: digestValue(snapshot),
    identity,
    width: rect.width,
    height: rect.height,
    bytes: png.toString('base64'),
    missingFonts: [],
    components: hashComponents(snapshot),
  };
  return { snapshot, png, raster };
}

/** One line per region, causes first: what changed, how strongly, where, and in which line. */
function regionLine(region, source) {
  const declared = region.component === undefined ? null : resolveSource(region.component, source);
  const file = region.source !== undefined ? formatSource(region.source) : declared === null ? '' : formatSource(declared);
  return [
    `  ${region.component ?? 'unattributed'}`,
    region.cause ? 'cause' : 'displaced',
    region.region.change ?? 'unread',
    region.region.grade >= STRONG_GRADE ? 'strong' : 'faint',
    `${region.region.pixels}px`,
    region.where ?? '',
    file,
  ]
    .filter((field) => field !== '')
    .join(' · ');
}

/** Run the comparison whose artifacts the visual-review pages show. */
export async function runVisualReviewCase() {
  const harness = await createHarness({
    url: pathToFileURL(HARNESS_PAGE).href,
    bundle: await agentBundle(),
    viewport: VIEWPORT,
    fonts: FONTS,
    subjectId: () => SUBJECT,
  });

  try {
    const identity = {
      renderer: 'playwright-chromium',
      engine: harness.engine,
      platform: `${process.platform}/${process.arch}`,
      deviceScaleFactor: VIEWPORT.deviceScaleFactor,
      fonts: FONTS,
    };
    const before = await read(harness, 'before', identity);
    const after = await read(harness, 'after', identity);
    const sourcePath = relative(REPOSITORY_ROOT, SOURCE_FILE);
    const source = indexDeclarations(sourcePath, await readFile(SOURCE_FILE, 'utf8'));

    const observation = await observeRasters(
      SUBJECT,
      { ...before.raster, snapshot: packSnapshot(before.snapshot) },
      after.raster,
      { snapshot: after.snapshot, source },
    );
    const ranked = rankRegions(observation.regions, observation.causes ?? []);

    const report = [
      `${observation.subject}: ${observation.verdict} — ${observation.because}`,
      'components whose hashes changed:',
      ...(observation.moved ?? []).map(
        (entry) => `  ${entry.component} · ${entry.cause ? 'cause' : 'displaced'} · ${entry.bands.join(', ')}`,
      ),
      'regions, causes first:',
      ...ranked.map((region) => regionLine(region, source)),
    ].join('\n');

    return {
      before: before.snapshot,
      after: after.snapshot,
      observation,
      ranked,
      report,
      beforePng: before.png,
      afterPng: after.png,
      diffPng: await diffImage(before.png, after.png),
      engine: harness.engine,
    };
  } finally {
    await harness.close();
  }
}
