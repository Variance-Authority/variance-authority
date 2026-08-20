import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds the page half, before anything asks a browser for it.
 *
 * It sits in `scripts/` rather than in the collector because a bundler is not
 * something adopting a visual-regression tool should install, and
 * `tools/shape.check.ts` refuses one in any package's `dependencies`. The
 * collector is the code an adopter copies; it reads the built bundle and needs
 * no build tool of its own.
 *
 * IIFE, not ESM: the harness injects it with `addScriptTag({ content })`, and a
 * module evaluates asynchronously — the harness's "did the bundle install the
 * agent?" check would then race the bundle instead of catching a broken one.
 */

const HERE = dirname(fileURLToPath(import.meta.url));

export const AGENT_BUNDLE = resolve(HERE, '..', 'dist', 'page-agent.bundle.js');

export async function buildAgentBundle() {
  const result = await build({
    entryPoints: [resolve(HERE, '..', 'src', 'page-agent.js')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    write: false,
  });

  const [output] = result.outputFiles;
  if (output === undefined) throw new Error('esbuild produced no output for the page agent');

  await mkdir(dirname(AGENT_BUNDLE), { recursive: true });
  await writeFile(AGENT_BUNDLE, output.text);
  return AGENT_BUNDLE;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(await buildAgentBundle());
}
