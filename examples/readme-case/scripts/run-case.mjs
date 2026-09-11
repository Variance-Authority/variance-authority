import { readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { indexSource } from '@variance-authority/core/attribute';
import { diffSnapshots } from '@variance-authority/core/compare';
import { adjudicate, buildDocket, summarizeAdjudication } from '@variance-authority/core/judge';
import { normalize } from '@variance-authority/core/rules';
import { createHarness } from '@variance-authority/playwright';
import { comparePngs, diffImage } from '@variance-authority/png';

const HERE = dirname(fileURLToPath(import.meta.url));
export const PACKAGE_ROOT = join(HERE, '..');
export const REPOSITORY_ROOT = join(PACKAGE_ROOT, '..', '..');
export const ARTIFACT_ROOT = join(PACKAGE_ROOT, 'artifacts');

const SOURCE_ROOT = join(PACKAGE_ROOT, 'src');
const BUTTON_SOURCE = join(SOURCE_ROOT, 'Button.js');
const AGENT_ENTRY = join(SOURCE_ROOT, 'page-agent.js');
const HARNESS_PAGE = join(PACKAGE_ROOT, 'page', 'harness.html');
const VIEWPORT = {
  width: 320,
  height: 160,
  deviceScaleFactor: 1,
  colorScheme: 'light',
};

async function agentBundle() {
  const result = await build({
    entryPoints: [AGENT_ENTRY],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    write: false,
  });

  const [output] = result.outputFiles;
  if (output === undefined) throw new Error('esbuild produced no page-agent bundle');
  return output.text;
}

/** Run the exact comparison whose artifacts appear in the root README. */
export async function runReadmeCase() {
  const harness = await createHarness({
    url: pathToFileURL(HARNESS_PAGE).href,
    bundle: await agentBundle(),
    viewport: VIEWPORT,
    fonts: ['Arial/600/normal/system'],
    subjectId: () => 'component/button',
  });

  try {
    const beforeCapture = await harness.capture('button', 'before');
    const beforePng = await harness.page.locator('#frame').screenshot();

    const afterCapture = await harness.capture('button', 'after');
    const afterPng = await harness.page.locator('#frame').screenshot();

    const before = normalize(beforeCapture);
    const after = normalize(afterCapture);
    const semantic = diffSnapshots(before, after);
    const sourcePath = relative(REPOSITORY_ROOT, BUTTON_SOURCE);
    const source = indexSource(sourcePath, await readFile(BUTTON_SOURCE, 'utf8'));
    const report = summarizeAdjudication(
      adjudicate(buildDocket([semantic]), { claims: [] }),
      { source },
    );

    return {
      before,
      after,
      semantic,
      report,
      beforePng,
      afterPng,
      diffPng: diffImage(beforePng, afterPng),
      comparison: comparePngs(beforePng, afterPng),
      engine: harness.engine,
    };
  } finally {
    await harness.close();
  }
}
