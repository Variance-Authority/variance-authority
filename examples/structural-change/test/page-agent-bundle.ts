import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function pageAgentBundle(): Promise<string> {
  const result = await build({
    entryPoints: [join(HERE, '../src/page-agent.js')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    write: false,
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new Error('esbuild produced no page-agent bundle');
  return output.text;
}
