import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { treeOf } from '@variance-authority/mcp/tools';
import { readHelp } from '@variance-authority/package/help';
import { updateSourceIndex } from '@variance-authority/sense';
import { readDependencyLexicon, refreshDependencyLexicon } from '../dependency-lexicon.js';
import { answerSearch, searchIndexOf } from './search.js';
import { stack } from './stack.js';

/**
 * A package that ships agent skills under `skills/<name>/SKILL.md` has them
 * named where the package is: `stack` lists each skill under its package with
 * the file to read, and `search` reaches the package by the words of a skill's
 * description. Nothing is installed or copied; the agent reads the file.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterEach(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

const SKILLS = {
  'skills/env-loading/SKILL.md': '---\nname: env-loading\ndescription: >-\n  Load variables from a .env file.\n  Use when configuring an app.\nlicense: MIT\n---\n\n# Loading\n',
  'skills/encrypted/SKILL.md': '---\nname: encrypted\ndescription: "Encrypt the secrets a .env file holds."\n---\n',
  'skills/nameless/SKILL.md': '# No front matter\n',
  'skills/empty/README.md': 'Not a skill: no SKILL.md.\n',
  'lib/tools/skills/deep/SKILL.md': '---\nname: deep\ndescription: Shipped below the package root.\n---\n',
};

async function workspace(): Promise<string> {
  process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-skills-cache-'));
  const root = mkdtempSync(join(tmpdir(), 'va-skills-fixture-'));
  execFileSync('git', ['init', '--quiet', root]);
  const files: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'fixture', dependencies: { 'env-kit': '1.0.0', 'plain-kit': '1.0.0' } }),
    'src/index.ts': "import { load } from 'env-kit';\nexport const fixture = load;\n",
    'node_modules/env-kit/package.json': JSON.stringify({
      name: 'env-kit', version: '1.0.0', description: 'Configuration loader',
      exports: { '.': { types: './index.d.ts' }, './extra': { types: './extra.d.ts' } },
    }),
    'node_modules/env-kit/index.d.ts': 'export declare function load(): void;\n',
    'node_modules/env-kit/extra.d.ts': 'export declare function extra(): void;\n',
    'node_modules/plain-kit/package.json': JSON.stringify({ name: 'plain-kit', version: '1.0.0', description: 'Configuration helpers', types: 'index.d.ts' }),
    'node_modules/plain-kit/index.d.ts': 'export declare function plain(): void;\n',
  };
  for (const [path, text] of Object.entries(SKILLS)) files[`node_modules/env-kit/${path}`] = text;
  for (const [path, value] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), value);
  }
  execFileSync('git', ['add', '-f', '.'], { cwd: root });
  await updateSourceIndex(root);
  await refreshDependencyLexicon(root);
  return root;
}

it('lists the skills a package ships under the package, each with the file to read and what its front matter says', async () => {
  const root = await workspace();
  const answer = stack.run(readHelp(root), { from: 'src/index.ts' }, { root });
  expect(answer).toContain('1 package ships agent skills, each listed under its package with its SKILL.md.');
  const kit = answer.split('\n');
  const at = kit.findIndex((row) => row.startsWith('  env-kit@1.0.0'));
  expect(kit.slice(at + 1, at + 4)).toEqual([
    '    skill encrypted: node_modules/env-kit/skills/encrypted/SKILL.md — Encrypt the secrets a .env file holds.',
    '    skill env-loading: node_modules/env-kit/skills/env-loading/SKILL.md — Load variables from a .env file. Use when configuring an app.',
    '    skill nameless: node_modules/env-kit/skills/nameless/SKILL.md — no description in its front matter',
  ]);
  expect(answer).not.toContain('skills/empty');
  expect(answer).not.toContain('lib/tools/skills/deep');
  expect(answer.split('\n').find((row) => row.startsWith('  plain-kit@1.0.0'))).toBeDefined();
  expect(answer.split('\n').filter((row) => row.startsWith('    skill '))).toHaveLength(3);
});

it('reaches a package by the words of its skills, and names each skill once, under its first hit', async () => {
  const root = await workspace();
  const said = answerSearch(searchIndexOf(readHelp(root)), { query: 'encrypt secrets' }, treeOf([], root), root);
  expect(said).toContain('2 packages describe `encrypt secrets`');
  expect(said).toContain('env-kit @1.0.0 · dependency in package.json · imported 1×');
  expect(said).toContain('    skill encrypted: node_modules/env-kit/skills/encrypted/SKILL.md — Encrypt the secrets a .env file holds.');
  expect(said).not.toContain('plain-kit');
  expect(said.split('\n').filter((row) => row.startsWith('    skill encrypted: '))).toHaveLength(1);
});

it('reads a skill again when its SKILL.md is edited, though nothing else in the package moved', async () => {
  const root = await workspace();
  writeFileSync(join(root, 'node_modules/env-kit/skills/encrypted/SKILL.md'), '---\nname: encrypted\ndescription: Rotate the keys a vault holds.\n---\n');
  await refreshDependencyLexicon(root);
  const answer = stack.run(readHelp(root), { from: 'src/index.ts' }, { root });
  expect(answer).toContain('    skill encrypted: node_modules/env-kit/skills/encrypted/SKILL.md — Rotate the keys a vault holds.');
});

it('reads a skill added to a package that already shipped skills', async () => {
  const root = await workspace();
  mkdirSync(join(root, 'node_modules/env-kit/skills/added'));
  writeFileSync(join(root, 'node_modules/env-kit/skills/added/SKILL.md'), '---\nname: added\ndescription: Arrived after the first refresh.\n---\n');
  await refreshDependencyLexicon(root);
  const answer = stack.run(readHelp(root), { from: 'src/index.ts' }, { root });
  expect(answer).toContain('    skill added: node_modules/env-kit/skills/added/SKILL.md — Arrived after the first refresh.');
});

it('says skills were not read when the lexicon was written before they were recorded', async () => {
  const root = await workspace();
  const { path } = readDependencyLexicon(root);
  const lexicon = JSON.parse(readFileSync(path, 'utf8')) as { entries: { api: { skills?: unknown } }[] };
  for (const entry of lexicon.entries) delete entry.api.skills;
  writeFileSync(path, JSON.stringify({ ...lexicon, version: 8 }));
  const answer = stack.run(readHelp(root), { from: 'src/index.ts' }, { root });
  expect(answer).toContain('Skills were not read: the dependency lexicon predates them; run `variance index` to read them.');
  expect(answer).not.toContain('    skill ');
});
