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
 * page it publishes, GitHub for the rest — and a relative one stays inside the
 * package it was written in.
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
 * it, a package's README, or one of those as Markdown at `index.md`. Anything
 * else is a file the site serves from `site/public/`.
 */
function siteMiss(url: string): string | null {
  const [address = '', anchor] = url.slice(SITE.length).split('#');
  const path = address.replace(/\/$/, '') || '/';
  const page = path.replace(/\/index\.md$/, '');

  const published =
    page === '/' ||
    navigationItem(page) !== undefined ||
    DOCUMENTATION_INDEXES.some((index) => index.href === page) ||
    (/^\/reference\/packages\/[^/]+$/.test(page) && packageDocument(page.split('/')[3]!) !== undefined);

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

/** Source a package ships, by the package it ships in. */
const PACKAGED = SOURCE.filter((file) => /^packages\/[^/]+\/src\//.test(file) && !/\.test\.[cm]?tsx?$/.test(file));

describe('a relative link in a package stays in the package', () => {
  it('finds packaged source to read', () => {
    expect(PACKAGED.length).toBeGreaterThan(100);
  });

  it.each(PACKAGED)('%s', (file) => {
    const home = file.split('/').slice(0, 2).join('/');
    const text = commentsOf(file);
    const escapes: string[] = [];

    for (const match of text.matchAll(LINK)) {
      const target = match[1]!;
      if (/^(?:[a-z]+:|#)/.test(target)) continue;
      const inside = relative(join(ROOT, home), resolve(dirname(join(ROOT, file)), target.split('#')[0]!));
      if (inside.startsWith('..')) escapes.push(`${file}:${lineOf(text, match.index)} → ${target}`);
    }
    expect(escapes).toEqual([]);
  });
});
