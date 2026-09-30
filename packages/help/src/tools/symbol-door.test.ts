import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { readHelp } from '@variance-authority/package/help';
import { updateSourceIndex } from '@variance-authority/sense';
import { symbol } from './symbol.js';

/**
 * TanStack Query's shape: every adapter re-exports `@tanstack/query-core`, and
 * `@tanstack/angular-query-experimental` sorts before the core. The name is
 * answered through the door the workspace imports it by, not the first one read.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

it('answers a re-exported name through the door the workspace imports it by', async () => {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-symbol-door-cache-'));
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'va-symbol-door-')));
  execFileSync('git', ['init', '--quiet', root]);
  const manifest = (name: string, dependencies: Record<string, string> = {}): string =>
    JSON.stringify({ name, exports: { '.': './src/index.ts' }, dependencies });
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'query', private: true, workspaces: ['packages/*'] }),
    'packages/query-core/package.json': manifest('@tanstack/query-core'),
    'packages/query-core/src/queryObserver.ts': '/** Watches one query. */\nexport class QueryObserver {}\n',
    'packages/query-core/src/index.ts': "export { QueryObserver } from './queryObserver';\n",
    'packages/angular-query-experimental/package.json': manifest('@tanstack/angular-query-experimental', { '@tanstack/query-core': 'workspace:*' }),
    'packages/angular-query-experimental/src/index.ts': "export * from '@tanstack/query-core';\n",
    'packages/react-query/package.json': manifest('@tanstack/react-query', { '@tanstack/query-core': 'workspace:*' }),
    'packages/react-query/src/index.ts': "export * from '@tanstack/query-core';\nexport { useBaseQuery } from './useBaseQuery';\n",
    'packages/react-query/src/useBaseQuery.ts':
      "import { QueryObserver } from '@tanstack/query-core';\nexport const useBaseQuery = (): QueryObserver => new QueryObserver();\n",
    'packages/solid-query/package.json': manifest('@tanstack/solid-query', { '@tanstack/query-core': 'workspace:*' }),
    'packages/solid-query/src/index.ts': "import { QueryObserver } from '@tanstack/query-core';\nexport const observer = new QueryObserver();\n",
  };
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await updateSourceIndex(root);

  const answer = symbol.run(readHelp(root), { name: 'QueryObserver' }, { root });
  expect(answer).toContain("import { QueryObserver } from '@tanstack/query-core';");
  expect(answer).toContain('used by 2 packages: @tanstack/react-query, @tanstack/solid-query');
  expect(answer).toContain('Also published by: @tanstack/angular-query-experimental, @tanstack/react-query');
});
