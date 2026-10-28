import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, expect, it, vi } from 'vitest';
import { realPath } from './resolve.js';

/**
 * Which configs the conditions reader opens under project references.
 *
 * `oxc-resolver` loads a governing config's references one level deep: a
 * referenced project contributes its own `files`, `include` and `exclude`, and
 * the projects it references in turn are never read. A monorepo whose packages
 * reference each other is a graph of thousands of configs, and walking it to
 * answer one file is the cost the reader must not pay.
 */

const opened = vi.hoisted(() => new Set<string>());

vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    readFileSync: ((path: Parameters<typeof fs.readFileSync>[0], ...rest: unknown[]) => {
      if (typeof path === 'string') opened.add(path);
      return (fs.readFileSync as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof fs.readFileSync,
  };
});

const { customConditionsFor } = await import('./conditions.js');

const roots: string[] = [];

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
});

it("reads a governing config's references and none of theirs", async () => {
  const root = realPath(await mkdtemp(join(tmpdir(), 'variance-references-')));
  roots.push(root);
  const files: Record<string, string> = {
    'packages/app/tsconfig.json': JSON.stringify({
      compilerOptions: { customConditions: ['@acme/source'] },
      include: ['src'],
      references: [{ path: '../lib' }],
    }),
    'packages/lib/tsconfig.json': JSON.stringify({ include: ['src'], references: [{ path: '../deep' }] }),
    'packages/deep/tsconfig.json': JSON.stringify({ include: ['src'] }),
    'packages/app/src/index.ts': 'export {};\n',
  };
  for (const [path, contents] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), contents);
  }

  expect(customConditionsFor('auto')(join(root, 'packages/app/src/index.ts'))).toEqual(['@acme/source']);
  expect(opened).toContain(join(root, 'packages/lib/tsconfig.json'));
  expect(opened).not.toContain(join(root, 'packages/deep/tsconfig.json'));
});
