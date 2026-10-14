import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import { transformAsync } from '@babel/core';
import { build, type Plugin } from 'vite';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveModules } from './captured-modules.js';
import { EXECUTION_GLOBAL, type ExecutionJournal, testSelectionProbes } from './probes.js';

/**
 * React Compiler, run through Babel ahead of Vite's own transforms the way
 * `@vitejs/plugin-react` runs it. It memoises a component: the branch it
 * renders moves inside a cache check, the callback it passes moves into the
 * branch that builds it, and its own map says where each came from.
 */
function reactCompiler(): Plugin {
  return {
    name: 'react-compiler',
    enforce: 'pre',
    async transform(code, id) {
      if (!id.endsWith('.jsx')) return null;
      const out = await transformAsync(code, {
        filename: id,
        babelrc: false,
        configFile: false,
        sourceMaps: true,
        parserOpts: { plugins: ['jsx'] },
        plugins: [['babel-plugin-react-compiler', {}]],
      });
      return out?.code ? { code: out.code, map: out.map } : null;
    },
  };
}

const SOURCE = [
  "import { useState } from 'react';",
  'export function Badge({ count, label }) {',
  '  const [open] = useState(false);',
  '  if (count > 9) {',
  '    return <b onClick={() => console.log(label)}>{label} 9+</b>;',
  '  }',
  "  const text = open ? label + ' ' + count : label;",
  '  return <span title={text}>{text}</span>;',
  '}',
  '',
].join('\n');

const temporary: string[] = [];

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('React Compiler ahead of the probes', () => {
  it('memoises the component the author wrote, and every region of it has a probe in what it wrote', async () => {
    const root = await realpath(await mkdtemp(resolve(tmpdir(), 'variance-react-compiler-')));
    temporary.push(root);
    await mkdir(resolve(root, 'src'), { recursive: true });
    await writeFile(resolve(root, 'src/Badge.jsx'), SOURCE);
    await writeFile(resolve(root, 'src/main.js'), "import { Badge } from './Badge.jsx';\nglobalThis.Badge = Badge;\n");
    const output = await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [testSelectionProbes({ root }), reactCompiler()],
      esbuild: { jsx: 'transform', jsxFactory: 'h' },
      build: {
        write: false,
        minify: false,
        rollupOptions: {
          input: resolve(root, 'src/main.js'),
          external: ['react', 'react/compiler-runtime'],
          output: { format: 'cjs' },
        },
      },
    });
    const [bundle] = Array.isArray(output) ? output : [output];
    const code = 'output' in bundle! ? bundle.output.find((file) => file.type === 'chunk')?.code : undefined;
    const id = /\.r\("(src\/Badge\.jsx@[0-9a-f]{32})"/.exec(code ?? '')?.[1];
    expect(id).toBeDefined();
    const module = (await deriveModules(root, [id!], undefined)).get(id!);
    // The regions are the component as the author wrote it, cut from the file.
    expect(module?.blocks.map((block) => [block.name, block.path, block.startLine, block.endLine])).toEqual([
      ['', 'module', 1, 9],
      ['Badge', 'entry', 2, 9],
      ['Badge', 'if#0/then', 4, 6],
      ['Badge/anon#0', 'entry', 5, 5],
      ['Badge', 'if#0/else', 6, 6],
      ['Badge', 'if#0/after', 7, 8],
    ]);
    const badge = code!.slice(code!.indexOf('function Badge('));
    // The compiler wrote its cache: the probes went in after it.
    expect(badge).toMatch(/const \$ = (?:\w+\.)?c\(\d+\);/);
    // Every region has a probe, each on the path that runs it: the branch's
    // inside the compiled branch, the callback's inside the callback it moved
    // into a cache check, and the branch the author left implicit in an
    // `else` of its own. The cache check that builds the callback maps to the
    // callback, but a cache hit skips it, so the callback is also charged
    // where the author's branch opens: over-selection, never a miss.
    const then = badge.slice(badge.indexOf('if (count > 9) {'), badge.indexOf('return t2;'));
    expect(then).toMatch(/^if \(count > 9\) \{\s+__va\(1\), __va\(2\), __va\(3\);/);
    expect(then).not.toContain('__va(4)');
    expect(badge).toMatch(/=> \(__va\(3\), console\.log\(label\)\)/);
    expect(badge).toMatch(/return t2;\s+\} else \{\s+__va\(4\);\s+\}/);
    expect(badge.slice(badge.indexOf('} else {'))).toMatch(/__va\(5\);\s+const text = open \?/);
    // The compiler maps the component's closing brace to the end of its last
    // statement, in the region after the branch, and that brace is the
    // component's own code: so that region also fires where the component
    // opens. The cache it reads first, `c()`, maps to the import, module code,
    // so the module's region fires on every render too. Both are intended
    // over-selection: a test that returned early is recorded running them, an
    // extra selection; no test that ran one goes unrecorded.
    expect(badge).toMatch(/^function Badge\(t0\) \{\s+__va\(0\), __va\(1\), __va\(5\);/);

    // Rendered, each branch is recorded on the render that took it, and a
    // render that takes the branch is charged with the callback though nothing
    // clicked. The cache lives across renders, as React keeps it
    // for one mounted component, so a second render with the same props reads
    // it and skips every check the compiler wrote — and still records what it
    // ran.
    const sentinel = Symbol.for('react.memo_cache_sentinel');
    let cache: unknown[] | undefined;
    const runtime: Record<string, unknown> = {
      react: { useState: (value: unknown) => [value, () => undefined] },
      'react/compiler-runtime': {
        c: (size: number) => (cache ??= Array.from({ length: size }, () => sentinel)),
      },
    };
    const page = createContext({ h: () => null, exports: {}, require: (name: string) => runtime[name] });
    runInContext(code!, page);
    const collector = `globalThis[${JSON.stringify(EXECUTION_GLOBAL)}]`;
    runInContext(`${collector}.reset()`, page);
    const render = (count: number): string[] => {
      runInContext(`Badge({ count: ${count}, label: 'mail' })`, page);
      const journal = JSON.parse(runInContext(`JSON.stringify(${collector}.drain())`, page)) as ExecutionJournal;
      const hits = journal.modules.find((it) => it.id === id)!.hits;
      return module!.blocks.flatMap((block, ordinal) => (hits.includes(ordinal) ? [`${block.name}/${block.path}`] : []));
    };
    const branch = ['/module', 'Badge/entry', 'Badge/if#0/then', 'Badge/anon#0/entry', 'Badge/if#0/after'];
    expect(render(12)).toEqual(branch);
    expect(render(12)).toEqual(branch);
    const after = ['/module', 'Badge/entry', 'Badge/if#0/else', 'Badge/if#0/after'];
    expect(render(3)).toEqual(after);
    expect(render(3)).toEqual(after);
  });
});
