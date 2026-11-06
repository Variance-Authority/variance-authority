import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { documentHeadings } from '../site/app/content/markdown-text';
import { packageDocument } from '../site/app/content/package-docs';
import { routedDocument } from '../site/app/content/routed-docs';
import { DOCUMENTATION_INDEXES, navigationItem } from '../site/app/navigation';
import { SOURCE, commentsOf } from './comments.js';
import { MARKDOWN, ROOT, lineOf, prose } from './markdown.js';

/**
 * Where a published package points, checked from where its reader stands.
 *
 * A doc comment ships. It lands in `dist/*.d.ts`, an editor shows it on hover,
 * and `variance ask symbol` prints it verbatim to an agent. None of those
 * readers has this repository: a link written `../../../docs/flakiness.md`
 * resolves inside `node_modules/@variance-authority/cli/` to nothing, and a
 * hundred of them did. So a link out of a package is absolute — the site for a
 * page it publishes, GitHub for the rest — and a relative one names a path in
 * the package it was written in.
 *
 * An absolute link is then only as good as the address. The site's own
 * catalogue says which paths it publishes and which headings a page renders,
 * so a site URL is checked against that rather than against a copy of its
 * routing; a GitHub URL is checked against what git tracks.
 */

const SITE = 'https://variance-authority.dev';
const REPOSITORY = 'https://github.com/Variance-Authority/variance-authority';

const TRACKED = new Set(
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n'),
);

/** Whether `path` is a tracked file or a directory holding one. */
function tracked(path: string): boolean {
  const directory = `${path.replace(/\/$/, '')}/`;
  return TRACKED.has(path) || [...TRACKED].some((file) => file.startsWith(directory));
}

/** A Markdown link's target, wherever in a text it sits. */
const LINK = /\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/**
 * Why a site URL names nothing, or `null` when it names a page.
 *
 * A page is what the site generates: an entry of its catalogue, an index over
 * it, a package's README, or one of those as Markdown at `index.md`. A route
 * handler such as `llms.txt` answers at its directory. Anything else is a file
 * the site serves from `site/public/`.
 */
function siteMiss(url: string): string | null {
  const [address = '', anchor] = url.slice(SITE.length).split('#');
  const path = address.replace(/\/$/, '') || '/';
  const page = path.replace(/\/index\.md$/, '');

  const published =
    page === '/' ||
    navigationItem(page) !== undefined ||
    DOCUMENTATION_INDEXES.some((index) => index.href === page) ||
    (/^\/reference\/packages\/[^/]+$/.test(page) && packageDocument(page.split('/')[3]!) !== undefined) ||
    existsSync(join(ROOT, 'site/app', path, 'route.ts'));

  if (!published) return existsSync(join(ROOT, 'site/public', path)) && anchor === undefined ? null : 'no such page';
  if (anchor === undefined) return null;

  const document = routedDocument(page);
  if (document === undefined) return 'an anchor on a page with no document';
  return documentHeadings(document.source).some(({ id }) => id === anchor) ? null : 'no such heading';
}

/** Why a repository URL names nothing, or `null` when it names a tracked path. */
function repositoryMiss(url: string): string | null {
  const path = /^\/(?:blob|tree)\/main\/([^#?]+)/.exec(url.slice(REPOSITORY.length))?.[1];
  if (path === undefined) return null;
  return tracked(decodeURIComponent(path)) ? null : 'no such path on main';
}

/** Every address in a text, as `line → url (why)` for the ones that name nothing. */
function misses(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/https:\/\/(?:variance-authority\.dev|github\.com\/Variance-Authority\/variance-authority)[^\s)"'`<>\]]*/g)) {
    // A template builds its address at run time, and the part that varies is
    // not here to check.
    if (text.startsWith('${', match.index + match[0].length) || match[0].includes('${')) continue;
    const url = match[0].replace(/[.,;:]+$/, '');
    const why = url.startsWith(SITE) ? siteMiss(url) : repositoryMiss(url);
    if (why !== null) found.push(`${lineOf(text, match.index)} → ${url} (${why})`);
  }
  return found;
}

describe('a site URL names a page the site publishes', () => {
  it('reads the catalogue, so a route that moved is a miss', () => {
    expect(siteMiss(`${SITE}/start/cli`)).toBeNull();
    expect(siteMiss(`${SITE}/start-cli`)).toBe('no such page');
    expect(siteMiss(`${SITE}/docs/flakiness/index.md`)).toBeNull();
    expect(siteMiss(`${SITE}/reference/packages/cli`)).toBeNull();
    expect(siteMiss(`${SITE}/reference/packages/nothing`)).toBe('no such page');
    expect(siteMiss(`${SITE}/mark.svg`)).toBeNull();
    expect(siteMiss(`${SITE}/llms.txt`)).toBeNull();
  });

  it('reads the headings the page renders', () => {
    const heading = documentHeadings(routedDocument('/docs/flakiness')!.source)[1]!.id;
    expect(siteMiss(`${SITE}/docs/flakiness#${heading}`)).toBeNull();
    expect(siteMiss(`${SITE}/docs/flakiness#no-such-heading`)).toBe('no such heading');
  });

  it.each([...MARKDOWN, ...SOURCE])('%s', (file) => {
    const text = file.endsWith('.md') ? prose(file) : readFileSync(join(ROOT, file), 'utf8');
    expect(misses(text).map((miss) => `${file}:${miss}`)).toEqual([]);
  });
});

describe('a repository URL names a path on main', () => {
  it('reads what git tracks', () => {
    expect(repositoryMiss(`${REPOSITORY}/blob/main/docs/flakiness.md`)).toBeNull();
    expect(repositoryMiss(`${REPOSITORY}/tree/main/packages/cli`)).toBeNull();
    expect(repositoryMiss(`${REPOSITORY}/blob/main/docs/no-such-page.md`)).toBe('no such path on main');
  });
});

/** Files npm puts in every tarball, whatever `files` says. */
const ALWAYS_SHIPPED = /^(?:README|LICEN[CS]E|CHANGELOG)(?:\.[^/]*)?$|^package\.json$/i;

/**
 * Why a relative link out of `file` names nothing in its package, or `null`
 * when it names a path there.
 *
 * A README is read in the tarball as it was written, so what it links must be
 * a file the package's `files` publishes. A comment in `src/` links the module
 * beside it by its source, or by the `.js` an import spells it with, which is
 * where the checkout, an editor and `variance ask` read it from.
 */
function packageMiss(file: string, target: string): string | null {
  const home = file.split('/').slice(0, 2).join('/');
  const path = relative(ROOT, resolve(dirname(join(ROOT, file)), decodeURIComponent(target.split('#')[0]!)));
  const inside = relative(home, path);
  if (inside.startsWith('..')) return 'outside the package';
  if (inside === '') return null;
  if (file.startsWith(`${home}/src/`)) return tracked(path) || tracked(source(path)) ? null : 'no such path';
  if (!tracked(path)) return 'no such path';
  return ALWAYS_SHIPPED.test(inside) || published(home, inside) ? null : 'not in the tarball';
}

/** The source a module path names, spelled as an import names it: `./x.js` is `./x.ts` or `./x.tsx`. */
function source(path: string): string {
  const module = /^(.*)\.([cm]?)js$/.exec(path);
  if (module === null) return path;
  const [, stem, flavour] = module;
  return [`${stem}.${flavour}ts`, `${stem}.${flavour}tsx`].find((file) => TRACKED.has(file)) ?? path;
}

/** Whether a package's `files` publishes `inside`, a path relative to the package. */
function published(home: string, inside: string): boolean {
  const files: unknown = JSON.parse(readFileSync(join(ROOT, home, 'package.json'), 'utf8')).files;
  if (!Array.isArray(files)) return true;
  const entries = files.filter((entry): entry is string => typeof entry === 'string');
  const matches = (entry: string) => {
    const pattern = entry.replace(/\/$/, '').replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '[^/]*');
    return new RegExp(`^${pattern}(?:/|$)`).test(inside);
  };
  return (
    entries.some((entry) => !entry.startsWith('!') && matches(entry)) &&
    !entries.some((entry) => entry.startsWith('!') && matches(entry.slice(1)))
  );
}

/** Source a package ships, by the package it ships in. */
const PACKAGED = SOURCE.filter((file) => /^packages\/[^/]+\/src\//.test(file) && !/\.test\.[cm]?tsx?$/.test(file));

/** The README npm ships at the root of each package. */
const READMES = MARKDOWN.filter((file) => /^packages\/[^/]+\/README\.md$/.test(file));

describe('a relative link in a package names what the package ships', () => {
  it('resolves from where the reader stands', () => {
    const file = 'packages/tribunal/src/node/bucket.ts';
    expect(packageMiss(file, '../store.ts')).toBeNull();
    expect(packageMiss(file, '../store.js')).toBeNull();
    expect(packageMiss(file, '../node')).toBeNull();
    expect(packageMiss(file, '../../README.md')).toBeNull();
    expect(packageMiss(file, '../no-such-module.ts')).toBe('no such path');
    expect(packageMiss(file, '../../../cli')).toBe('outside the package');
    expect(packageMiss('packages/tribunal/README.md', 'migrations')).toBeNull();
    expect(packageMiss('packages/tribunal/README.md', 'src/store.ts')).toBe('not in the tarball');
    expect(packageMiss('packages/sense/README.md', 'native/instrument/Cargo.toml')).toBeNull();
    expect(packageMiss('packages/sense/README.md', 'native/Cargo.toml')).toBe('not in the tarball');
  });

  it('finds packaged source and READMEs to read', () => {
    expect(PACKAGED.length).toBeGreaterThan(100);
    expect(READMES.length).toBeGreaterThan(20);
  });

  it.each([...PACKAGED, ...READMES])('%s', (file) => {
    const text = file.endsWith('.md') ? prose(file) : commentsOf(file);
    const found: string[] = [];

    for (const match of text.matchAll(LINK)) {
      const target = match[1]!;
      if (/^(?:[a-z]+:|#)/.test(target)) continue;
      const why = packageMiss(file, target);
      if (why !== null) found.push(`${file}:${lineOf(text, match.index)} → ${target} (${why})`);
    }
    expect(found.join('\n')).toBe('');
  });
});

/**
 * Every published package leads back to the site and to its source.
 *
 * A registry or marketplace page shows the manifest and the README and nothing
 * else, so those two are the only way a reader found there reaches the rest of
 * the project. `homepage` names the package's reference page, `bugs` the issue tracker, and the README's
 * last line names that page, the documentation and the package's directory on
 * GitHub. The platform binaries of `sense` and the VS Code extension are
 * published too, so they carry the same, pointing at the reference page of the
 * package that ships them.
 */
describe('every published package links the site and its source', () => {
  const manifests = execFileSync(
    'git',
    ['ls-files', ':(glob)packages/*/package.json', ':(glob)packages/sense/npm/*/package.json', 'editors/vscode/package.json'],
    { cwd: ROOT, encoding: 'utf8' },
  )
    .trim()
    .split('\n');
  const SHIPPED_BY: Record<string, string> = {
    'editors/vscode': 'editors',
    'packages/sense/npm': 'sense',
  };

  it.each(manifests)('%s ends its README on the site and the source', (path) => {
    const directory = dirname(path);
    const manifest = JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as {
      bugs?: string;
      homepage?: string;
      repository?: { directory?: string };
    };
    const owner = SHIPPED_BY[directory] ?? SHIPPED_BY[dirname(directory)] ?? directory.split('/')[1];
    const reference = `${SITE}/reference/packages/${owner}`;
    expect(manifest.homepage).toBe(reference);
    expect(manifest.repository?.directory).toBe(directory);
    expect(manifest.bugs).toBe(`${REPOSITORY}/issues`);
    const readme = readFileSync(join(ROOT, directory, 'README.md'), 'utf8');
    const title = /^# (.+)$/m.exec(readme)?.[1];
    expect(readme.trimEnd().split('\n').at(-1)).toBe(
      `**[${title}](${reference})** is part of ` +
        `[Variance Authority](${SITE}) — ` +
        `[documentation](${SITE}/docs) · ` +
        `[GitHub](${REPOSITORY}/tree/main/${directory}) · MIT`,
    );
  });
});
