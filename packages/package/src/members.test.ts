import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('reads a member whose directory name starts with a dot', () => {
    const root = workspace({
      ...member('packages/.internal', 'dotted'),
      'package.json': { private: true, workspaces: ['packages/*'] },
    });
    expect(names(root)).toEqual(['dotted']);
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

it.todo(
  'an unreadable workspace file under `tolerant` is recorded with the file and the reason, and the rest of the reading goes on — needs `readOfferings` to carry a membership record beside the offerings',
);
