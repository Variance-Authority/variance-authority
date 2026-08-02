/**
 * Builds the page half of the collector, in memory.
 *
 * In memory rather than to a committed file: the bundle is derived from
 * `@variance-authority/dom` and `@variance-authority/react`, and a stale copy on
 * disk would let a run be about yesterday's collector while every other signal
 * said it was about today's.
 *
 * IIFE, not ESM. See `page-agent.js`.
 */
import { build } from 'esbuild';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Kept beside the entry point so the collector and the page agree on one name. */
export const AGENT = '__VA_STORYBOOK_COLLECTOR__';

export async function bundle() {
  const result = await build({
    entryPoints: [resolve(here, 'page-agent.js')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    write: false,
    minify: false,
    define: { 'process.env.NODE_ENV': '"production"' },
  });

  const [output] = result.outputFiles;
  if (output === undefined) throw new Error('esbuild produced no output for the page agent');
  return output.text;
}
