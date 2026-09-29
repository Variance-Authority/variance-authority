import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { updateSourceIndex } from '@variance-authority/sense';
import type { FixturePackage } from './dependency-jobs.js';
import { refreshDependencyLexicon } from './dependency-lexicon.js';

// compass: variance-authority.report.agent-surface

/**
 * A checkout whose one workspace declares `declared` and whose `node_modules`
 * holds each of `packages` as it publishes itself, indexed and refreshed the way
 * `variance index` does. Points the cache at a directory of its own.
 */
export async function workspaceOf(packages: readonly FixturePackage[], declared: readonly string[]): Promise<string> {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-jobs-cache-'));
  const root = mkdtempSync(join(tmpdir(), 'va-jobs-fixture-'));
  execFileSync('git', ['init', '--quiet', root]);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture', dependencies: Object.fromEntries(declared.map((name) => [name, '1.0.0'])) }),
    'src/index.ts': 'export const fixture = 1;\n',
  };
  for (const item of packages) {
    const base = `node_modules/${item.name}`;
    files[`${base}/package.json`] = JSON.stringify({ name: item.name, version: '1.0.0', description: item.description, keywords: item.keywords, types: 'index.d.ts' });
    files[`${base}/index.d.ts`] = Object.entries(item.names ?? {}).map(([name, doc]) => `/** ${doc} */\nexport declare function ${name}(): void;\n`).join('') || 'export {};\n';
    if (item.headings !== undefined) files[`${base}/README.md`] = item.headings.map((heading) => `## ${heading}\n`).join('\n');
  }
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await updateSourceIndex(root);
  refreshDependencyLexicon(root);
  return root;
}
