import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { jsxSource } from '@variance-authority/jsx-source/vite';
import { withTestSelection } from '@variance-authority/sense/vitest';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

// The probes go in before every transform here: esbuild strips the types, runs
// the legacy decorators and compiles the JSX with its source locations, a
// compiler declared `enforce: 'pre'` writes a line above the author's first, as
// `vite-plugin-solid` hoists its templates, and a React Refresh-style plugin
// registers each component, as `@vitejs/plugin-react` does, on lines below the
// author's last.
const root = fileURLToPath(new URL('.', import.meta.url));
const source = resolve(root, 'src');
const coverageFile = process.env['VARIANCE_AUTHORITY_COVERAGE'];
if (coverageFile === undefined) throw new Error('VARIANCE_AUTHORITY_COVERAGE is required');

const compiler: Plugin = {
  name: 'compile-ahead',
  enforce: 'pre',
  transform(code, id) {
    if (!id.endsWith('/compiled.ts')) return null;
    return { code: `globalThis.compiledAhead = true;\n${code}`, map: null };
  },
};

const refresh: Plugin = {
  name: 'refresh-registration',
  transform(code, id) {
    if (!id.endsWith('.tsx')) return null;
    const names = [...code.matchAll(/^export function ([A-Z]\w*)/gm)].map((match) => match[1]);
    const registered = names.map((name) => `globalThis.$RefreshReg$?.(${name}, ${JSON.stringify(name)});`).join('');
    return { code: `${code}\n${registered}`, map: null };
  },
};

export default withTestSelection(
  defineConfig({
    root,
    plugins: [jsxSource(), compiler, refresh],
    esbuild: {
      jsx: 'automatic',
      jsxDev: true,
      tsconfigRaw: { compilerOptions: { experimentalDecorators: true } },
    },
    test: { include: ['test/*.case.ts?(x)'] },
  }),
  {
    coverageFile,
    include: (file) => file.startsWith(source),
  },
);
