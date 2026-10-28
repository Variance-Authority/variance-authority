import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { readOfferings } from './manifest.js';

/**
 * Which manifests a workspace lists, asked through the one reading that uses
 * the answer.
 *
 * The workspace files under `__fixtures__/workspace-lists` are cut from the
 * `pnpm-workspace.yaml` that TanStack Query, Material UI and Docusaurus commit:
 * the members and the keys around them are theirs, trimmed to what the list
 * needs.
 */

const LISTS = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__/workspace-lists');
const listed = (name: string): string => readFileSync(join(LISTS, name), 'utf8');

const temporary: string[] = [];

/** A workspace written from a map of relative path to contents. */
function workspace(files: Readonly<Record<string, unknown>>): string {
  const root = mkdtempSync(join(tmpdir(), 'variance-members-'));
  temporary.push(root);
  for (const [path, contents] of Object.entries(files)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  }
  return root;
}

/** A published member at `dir`, named `name`. */
const member = (dir: string, name: string) => ({ [`${dir}/package.json`]: { name } });

const names = (root: string): readonly string[] => readOfferings(root).map((offering) => offering.name);

afterAll(() => {
  for (const root of temporary) rmSync(root, { recursive: true, force: true });
});

describe('the members a root manifest lists', () => {
  const tree = {
    ...member('packages/beta', 'beta'),
    ...member('packages/alpha', 'alpha'),
    ...member('extra/solo', 'solo'),
  };

  it('reads `workspaces` as an array, in the order it is written and by name within a glob', () => {
    const root = workspace({ ...tree, 'package.json': { private: true, workspaces: ['extra/solo', 'packages/*'] } });
    expect(names(root)).toEqual(['solo', 'alpha', 'beta']);
  });

  it('reads `workspaces` as an object with `packages`, as yarn writes it', () => {
    const root = workspace({
      ...tree,
      'package.json': { private: true, workspaces: { packages: ['packages/*', 'extra/solo'], nohoist: ['**/x'] } },
    });
    expect(names(root)).toEqual(['alpha', 'beta', 'solo']);
  });

  it('reads an entry written with a leading `./`', () => {
    const root = workspace({ ...tree, 'package.json': { private: true, workspaces: ['./packages/*'] } });
    expect(names(root)).toEqual(['alpha', 'beta']);
  });

  it('skips a listed path with no manifest in it, and a glob whose directory is not there', () => {
    const root = workspace({
      ...tree,
      'packages/notes/README.md': '# not a package\n',
      'package.json': { private: true, workspaces: ['packages/*', 'missing', 'gone/*'] },
    });
    expect(names(root)).toEqual(['alpha', 'beta']);
  });

  it('leaves a directory whose name starts with a dot out of a wildcard, as pnpm does', () => {
    const root = workspace({
      ...member('packages/.internal', 'dotted'),
      ...member('packages/alpha', 'alpha'),
      'package.json': { private: true, workspaces: ['packages/*'] },
    });
    expect(names(root)).toEqual(['alpha']);
  });

  it('is one package when the root lists no workspaces at all', () => {
    const root = workspace({ ...tree, 'package.json': { name: 'only' } });
    expect(names(root)).toEqual(['only']);
  });

  it('is one package when the root lists an empty `workspaces`', () => {
    const root = workspace({ ...tree, 'package.json': { name: 'only', workspaces: [] } });
    expect(names(root)).toEqual(['only']);
  });

  it('reads the root manifest before a `pnpm-workspace.yaml` beside it', () => {
    const root = workspace({
      ...tree,
      'package.json': { private: true, workspaces: ['extra/solo'] },
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
    });
    expect(names(root)).toEqual(['solo']);
  });

  it('reads a member two entries both match once', () => {
    const root = workspace({ ...tree, 'package.json': { private: true, workspaces: ['packages/*', 'packages/alpha'] } });
    expect(names(root)).toEqual(['alpha', 'beta']);
  });

  it('reads every member under a `**` glob', () => {
    const root = workspace({
      ...member('packages/group/deep', 'deep'),
      ...member('packages/flat', 'flat'),
      'package.json': { private: true, workspaces: ['packages/**'] },
    });
    expect(names(root)).toEqual(['flat', 'deep']);
  });

  it('leaves out a member a negated entry excludes', () => {
    const root = workspace({ ...tree, 'package.json': { private: true, workspaces: ['packages/*', '!packages/beta'] } });
    expect(names(root)).toEqual(['alpha']);
  });

  it('reads a member whose dot-named directory an entry spells out', () => {
    const root = workspace({
      ...member('packages/.internal', 'dotted'),
      'package.json': { private: true, workspaces: ['packages/.internal'] },
    });
    expect(names(root)).toEqual(['dotted']);
  });

  it('never reads a manifest under `node_modules`, even under `**`', () => {
    const root = workspace({
      ...member('packages/app', 'app'),
      ...member('packages/app/node_modules/left-pad', 'left-pad'),
      'package.json': { private: true, workspaces: ['packages/**'] },
    });
    expect(names(root)).toEqual(['app']);
  });

  it('reads a member nested in another under `**`, the outer one first', () => {
    const root = workspace({
      ...member('packages/c', 'c'),
      ...member('packages/a/b', 'b'),
      ...member('packages/a', 'a'),
      'package.json': { private: true, workspaces: ['packages/**'] },
    });
    expect(names(root)).toEqual(['a', 'b', 'c']);
  });

  it('reads a member listed above the root', () => {
    const root = workspace({
      ...member('lib', 'lib'),
      'app/package.json': { private: true, workspaces: ['../lib'] },
    });
    expect(names(join(root, 'app'))).toEqual(['lib']);
  });
});

describe('the members a `pnpm-workspace.yaml` lists', () => {
  const root = (yaml: string, members: Readonly<Record<string, unknown>>) =>
    workspace({ 'package.json': { name: 'mono', private: true }, 'pnpm-workspace.yaml': yaml, ...members });

  it("reads Material UI's list, with the settings after it", () => {
    const at = root(listed('material-ui.yaml'), {
      ...member('packages/mui-material', '@mui/material'),
      ...member('packages/mui-envinfo/test', '@mui/envinfo-test'),
      ...member('docs', 'docs'),
      ...member('test/regressions', 'regressions'),
      ...member('test', 'test'),
    });
    expect(names(at)).toEqual(['@mui/material', '@mui/envinfo-test', 'docs', 'test', 'regressions']);
  });

  it("reads Docusaurus's quoted entries past the comments and settings above them", () => {
    const at = root(listed('docusaurus.yaml'), {
      ...member('packages/docusaurus', '@docusaurus/core'),
      ...member('website', 'website'),
      ...member('packages/create-docusaurus/templates/classic', 'docusaurus-2-classic-template'),
      ...member('admin/new.docusaurus.io', 'new.docusaurus.io'),
    });
    expect(names(at)).toEqual([
      '@docusaurus/core',
      'website',
      'docusaurus-2-classic-template',
      'new.docusaurus.io',
    ]);
  });

  it('reads a list written with Windows line endings', () => {
    const at = root('packages:\r\n  - packages/*\r\n', member('packages/alpha', 'alpha'));
    expect(names(at)).toEqual(['alpha']);
  });

  it('is one package when the file lists no `packages:`', () => {
    const at = workspace({
      'package.json': { name: 'mono' },
      'pnpm-workspace.yaml': 'engineStrict: true\n',
      ...member('packages/alpha', 'alpha'),
    });
    expect(names(at)).toEqual(['mono']);
  });

  it('refuses a file that is not YAML, naming it', () => {
    const at = root("packages:\n  - 'packages/*\n", member('packages/alpha', 'alpha'));
    expect(() => readOfferings(at)).toThrow(/pnpm-workspace\.yaml/);
  });

  it("reads TanStack Query's list, leaving out what its negated entries exclude", () => {
    const at = root(listed('tanstack-query.yaml'), {
      ...member('packages/query-core', '@tanstack/query-core'),
      ...member('integrations/react-next-15', 'react-next-15'),
      ...member('examples/vue/basic', 'vue-basic'),
      ...member('examples/vue/2.6-basic', 'vue-2.6-basic'),
      ...member('examples/vue/2.7-basic', 'vue-2.7-basic'),
      ...member('examples/vue/nuxt3', 'vue-nuxt3'),
    });
    expect(names(at)).toEqual(['@tanstack/query-core', 'react-next-15', 'vue-basic']);
  });

  it('reads a list written at the same indent as its key', () => {
    const at = root('packages:\n- packages/*\n- docs\n', { ...member('packages/alpha', 'alpha'), ...member('docs', 'docs') });
    expect(names(at)).toEqual(['alpha', 'docs']);
  });

  it('reads a list in flow style', () => {
    const at = root('packages: [packages/*, docs]\n', { ...member('packages/alpha', 'alpha'), ...member('docs', 'docs') });
    expect(names(at)).toEqual(['alpha', 'docs']);
  });

  it('reads a file that starts with a byte-order mark', () => {
    const at = root('﻿packages:\n  - packages/*\n', member('packages/alpha', 'alpha'));
    expect(names(at)).toEqual(['alpha']);
  });

  it('reads a quoted `packages` key', () => {
    const at = root('"packages":\n  - packages/*\n', member('packages/alpha', 'alpha'));
    expect(names(at)).toEqual(['alpha']);
  });

  it('is one package when `packages:` is an empty list, as an empty `workspaces` is', () => {
    const at = workspace({
      'package.json': { name: 'mono' },
      'pnpm-workspace.yaml': 'packages: []\n',
      ...member('packages/alpha', 'alpha'),
    });
    expect(names(at)).toEqual(['mono']);
  });

  it('is one package when the file is empty, or `packages:` holds nothing', () => {
    for (const yaml of ['', 'packages:\n']) {
      const at = workspace({ 'package.json': { name: 'mono' }, 'pnpm-workspace.yaml': yaml, ...member('packages/alpha', 'alpha') });
      expect(names(at)).toEqual(['mono']);
    }
  });

  it('refuses a `packages:` that is not a list of strings, naming the file', () => {
    const at = root('packages:\n  first: packages/*\n', member('packages/alpha', 'alpha'));
    expect(() => readOfferings(at)).toThrow(/pnpm-workspace\.yaml/);
  });
});

describe('the members pnpm reads, where a glob alone reads differently', () => {
  const listing = (workspaces: readonly string[]) => ({ 'package.json': { private: true, workspaces } });

  it('reads a member that is a symbolic link to a directory elsewhere', () => {
    const root = workspace({ ...member('other/real', 'real'), ...member('packages/alpha', 'alpha'), ...listing(['packages/*']) });
    symlinkSync('../other/real', join(root, 'packages/link'));
    expect(names(root)).toEqual(['alpha', 'real']);
  });

  it('reads a member once when a symbolic link under `**` loops back above it', () => {
    const root = workspace({ ...member('packages/x', 'x'), ...member('packages/y', 'y'), ...listing(['packages/**']) });
    symlinkSync('..', join(root, 'packages/x/loop'));
    expect(names(root)).toEqual(['x', 'y']);
  });

  it("leaves a build's dot directory out of a `**` glob", () => {
    const root = workspace({
      ...member('packages/app', 'app'),
      ...member('packages/app/.next/standalone', 'next-standalone'),
      ...member('packages/app/.turbo/cache', 'turbo-cache'),
      ...member('packages/app/.svelte-kit/output', 'svelte-kit-output'),
      ...member('packages/app/.output/server', 'nitro-output'),
      ...member('packages/app/.vercel/output/functions', 'vercel-output'),
      ...listing(['packages/**']),
    });
    expect(names(root)).toEqual(['app']);
  });

  it('excludes only the directory a negated entry names, not the members nested under it', () => {
    const root = workspace({
      ...member('packages/a', 'a'),
      ...member('packages/a/b', 'b'),
      ...member('packages/c', 'c'),
      ...listing(['packages/**', '!packages/a']),
    });
    expect(names(root)).toEqual(['b', 'c']);
  });

  it("excludes what TanStack Query's negated wildcard matches and keeps what is nested under it", () => {
    const root = workspace({
      ...member('examples/vue/2x', 'vue-2x'),
      ...member('examples/vue/2x/sub', 'vue-2x-sub'),
      ...member('examples/vue/basic', 'vue-basic'),
      ...listing(['examples/**', '!examples/vue/2*']),
    });
    expect(names(root)).toEqual(['vue-2x-sub', 'vue-basic']);
  });

  it('reads the root of a pnpm workspace as a member beside the ones it lists', () => {
    const root = workspace({
      'package.json': { name: 'lib' },
      'pnpm-workspace.yaml': 'packages:\n  - examples/*\n',
      ...member('examples/demo', 'demo'),
    });
    expect(names(root)).toEqual(['lib', 'demo']);
  });

  it('reads the published root of an npm workspace beside the members it lists', () => {
    const root = workspace({ 'package.json': { name: 'lib', workspaces: ['examples/*'] }, ...member('examples/demo', 'demo') });
    expect(names(root)).toEqual(['lib', 'demo']);
  });

  it('orders siblings by name, a name before the longer names it starts', () => {
    const root = workspace({
      ...member('packages/b', 'b'),
      ...member('packages/a.b', 'a.b'),
      ...member('packages/a-b', 'a-b'),
      ...member('packages/a', 'a'),
      ...listing(['packages/*']),
    });
    expect(names(root)).toEqual(['a', 'a-b', 'a.b', 'b']);
  });

  it("orders Material UI's `mui-material` before `mui-material-nextjs`", () => {
    const root = workspace({
      'package.json': { name: 'mono', private: true },
      'pnpm-workspace.yaml': listed('material-ui.yaml'),
      ...member('packages/mui-material-nextjs', '@mui/material-nextjs'),
      ...member('packages/mui-material', '@mui/material'),
    });
    expect(names(root)).toEqual(['@mui/material', '@mui/material-nextjs']);
  });

  it('reads a member whose manifest is a `package.yaml`', () => {
    const root = workspace({
      'package.json': { name: 'mono', private: true },
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      ...member('packages/alpha', 'alpha'),
      'packages/yamled/package.yaml': 'name: yamled\n',
    });
    expect(names(root)).toEqual(['alpha', 'yamled']);
  });
});

describe('a member list it refuses, naming the file', () => {
  const pnpm = (yaml: string) =>
    workspace({ 'package.json': { name: 'mono', private: true }, 'pnpm-workspace.yaml': yaml, ...member('packages/alpha', 'alpha') });
  const npm = (workspaces: unknown) =>
    workspace({ 'package.json': { name: 'mono', private: true, workspaces }, ...member('packages/alpha', 'alpha') });

  it('an empty entry in `packages:`', () => {
    expect(() => readOfferings(pnpm("packages:\n  - packages/*\n  - ''\n"))).toThrow(/pnpm-workspace\.yaml.*empty/);
  });

  it('an empty entry in `workspaces`', () => {
    expect(() => readOfferings(npm(['packages/*', '']))).toThrow(/package\.json.*empty/);
  });

  it('a `pnpm-workspace.yaml` that is a list rather than a mapping', () => {
    expect(() => readOfferings(pnpm('- packages/*\n'))).toThrow(/pnpm-workspace\.yaml/);
  });

  it('a `workspaces` entry that is not a string', () => {
    expect(() => readOfferings(npm(['packages/*', 7]))).toThrow(/package\.json/);
  });
});

it.todo(
  'an unreadable workspace file under `tolerant` is recorded with the file and the reason, and the rest of the reading goes on — needs `readOfferings` to carry a membership record beside the offerings',
);
