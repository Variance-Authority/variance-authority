import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const HERE = dirname(fileURLToPath(import.meta.url));

export async function pageAgentBundle(): Promise<string> {
  const result = await build({
    entryPoints: [join(HERE, '../src/page-agent.tsx')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    write: false,
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"development"' },
  });
  const output = result.outputFiles[0];
  if (output === undefined) throw new Error('esbuild produced no page agent');
  return output.text;
}
