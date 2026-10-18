#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, countedBy, parse, ratchet, sources, visit } from './owners.mjs';

/**
 * What colour each package is, and the sites where a package takes on another.
 *
 * A specialist package means one thing. `sense` reads source and selects tests;
 * `react` knows React; `storybook` knows Storybook. A generic package, such as
 * the CLI, composes them and has no colour of its own: it is `mixed`. When a
 * specialist learns a second domain, the knowledge has two homes, the next
 * change to that domain updates one of them, and the package can no longer be
 * read as what its name says. The fix is never to move the check somewhere
 * quieter: the specialist exposes an extension point, and the package of that
 * colour fills it.
 *
 * `sense` learning React's element brands to name a story's components is the
 * case that made this a check. A reviewer caught it and the finding was set
 * aside; a rule that is only read can be.
 *
 * A colour is seen two ways in the parse tree, never in comments or prose:
 *
 * - an import of that domain's packages, or of one of ours that has that colour
 *   or is `mixed`;
 * - that domain's private vocabulary, as an identifier, a property or a string:
 *   the names a runtime does not publish and only its own package should know.
 *
 * A ratchet, like `owners.mjs`. What is here today is recorded per file, a new
 * site fails, and a site that moved to its colour tightens the baseline.
 *
 * `yarn colours` prints the list; `--write` records it.
 * `tools/colours.check.ts` compares the two.
 */

export const BASELINE = join(ROOT, 'tools/colours.baseline.json');

/** Each domain that colours a package: its packages, and its private names. */
export const DOMAINS = {
  react: {
    imports: /^(react|react-dom|react-is|@testing-library\/react|@types\/react(-dom)?)(\/|$)/,
    names: /^(\$\$typeof|_debugOwner|_debugSource|_debugStack|memoizedProps|memoizedState|__REACT_DEVTOOLS_GLOBAL_HOOK__|__react(Fiber|Props|Container)\$?.*|react\.[a-z_.]+)$/,
  },
  storybook: {
    imports: /^(storybook|@storybook\/[^/]+)(\/|$)/,
    names: /^(__STORYBOOK_\w*|storyRendered)$/,
  },
  vitest: {
    imports: /^(vitest|@vitest\/[^/]+)(\/|$)/,
    names: /^__vitest_\w*$/,
  },
  jest: {
    imports: /^(jest|jest-[^/]+|@jest\/[^/]+)(\/|$)/,
    names: null,
  },
  playwright: {
    imports: /^(playwright|playwright-core|@playwright\/[^/]+)(\/|$)/,
    names: null,
  },
};

/**
 * Every package's colour: a domain above, `none` for a specialist whose focus
 * is no vendor's, or `mixed` for a package that composes colours.
 *
 * Declared, not discovered: what a package is for is a decision, and the check
 * below is what stops the decision from quietly becoming false. `mixed` is the
 * expensive word. A package that is not a composer and is called one stops
 * being checked.
 */
export const COLOURS = {
  '@variance-authority/cli': 'mixed',
  '@variance-authority/core': 'none',
  '@variance-authority/distill': 'none',
  '@variance-authority/dom': 'none',
  '@variance-authority/editors': 'none',
  '@variance-authority/event': 'none',
  '@variance-authority/eyes': 'mixed',
  '@variance-authority/help': 'mixed',
  '@variance-authority/history': 'none',
  '@variance-authority/ioc': 'none',
  '@variance-authority/jsx-source': 'react',
  '@variance-authority/mcp': 'mixed',
  '@variance-authority/observe': 'none',
  '@variance-authority/package': 'none',
  '@variance-authority/playwright': 'playwright',
  '@variance-authority/playwright-test': 'mixed',
  '@variance-authority/png': 'none',
  '@variance-authority/png-sharp': 'none',
  '@variance-authority/presentation': 'mixed',
  '@variance-authority/raster': 'none',
  '@variance-authority/react': 'react',
  '@variance-authority/reads': 'none',
  '@variance-authority/remote': 'none',
  '@variance-authority/report': 'none',
  '@variance-authority/route-collector': 'mixed',
  '@variance-authority/scenario': 'none',
  '@variance-authority/sense': 'none',
  '@variance-authority/server': 'none',
  '@variance-authority/session': 'none',
  '@variance-authority/store': 'none',
  '@variance-authority/storybook': 'storybook',
  '@variance-authority/storybook-collector': 'mixed',
  '@variance-authority/tribunal': 'react',
  '@variance-authority/unit-test': 'none',
  '@variance-authority/vantage': 'none',
  '@variance-authority/vitest-browser': 'mixed',
  '@variance-authority/wire': 'none',
};

/** Each package directory under `packages/`, by the name its manifest gives. */
export function packages() {
  const names = new Map();
  for (const dir of readdirSync(join(ROOT, 'packages'))) {
    try {
      const manifest = JSON.parse(readFileSync(join(ROOT, 'packages', dir, 'package.json'), 'utf8'));
      names.set(`packages/${dir}`, manifest.name);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
  }
  return names;
}

/** The colour a specifier carries: a domain, `mixed`, or `undefined` for none. */
export function colourOf(specifier) {
  for (const [domain, { imports }] of Object.entries(DOMAINS)) {
    if (imports.test(specifier)) return domain;
  }
  const ours = /^(@variance-authority\/[^/]+)/.exec(specifier)?.[1];
  const colour = ours === undefined ? undefined : COLOURS[ours];
  return colour === 'none' ? undefined : colour;
}

/** The domain whose private vocabulary a name is, if any. */
export function domainOfName(name) {
  for (const [domain, { names }] of Object.entries(DOMAINS)) {
    if (names?.test(name)) return domain;
  }
  return undefined;
}

/** Every site in one file where it takes on a colour other than `own`. */
export function sitesIn(file, text, own) {
  if (own === 'mixed') return [];
  const { program, lineOf } = parse(file, text);
  const sites = [];
  const found = (colour, node, what) => {
    if (colour !== undefined && colour !== own) sites.push({ colour, at: file, line: lineOf(node.start), what });
  };

  visit(program, (node) => {
    const source = specifierOf(node);
    if (source !== undefined) {
      found(colourOf(source), node, source);
      return;
    }
    const name = nameIn(node);
    if (name !== undefined) found(domainOfName(name), node, name);
  });

  return sites;
}

// `import … from`, `export … from`, `import()`, `require()`.
function specifierOf(node) {
  const literal = (value) => (value?.type === 'Literal' && typeof value.value === 'string' ? value.value : undefined);
  if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type)) {
    return literal(node.source);
  }
  if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') {
    return literal(node.arguments[0]);
  }
  return undefined;
}

// An identifier, a property name, or a string. A template's text counts too.
function nameIn(node) {
  if (node.type === 'Identifier' || node.type === 'PrivateIdentifier') return node.name;
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateElement') return node.value.cooked ?? node.value.raw;
  return undefined;
}

/** Every site in the packages' production sources. */
export function sites() {
  const names = packages();
  return sources()
    .filter((file) => file.startsWith('packages/'))
    .flatMap((file) => {
      const name = names.get(file.split('/').slice(0, 2).join('/'));
      return sitesIn(file, readFileSync(join(ROOT, file), 'utf8'), COLOURS[name]);
    });
}

/** One row per colour per file: what the baseline records. */
export const counted = (found) => countedBy(found, 'colour');

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const found = sites();
  ratchet({
    label: 'colours',
    baseline: BASELINE,
    found,
    rows: counted(found),
    print: (site) => `${site.at}:${site.line}  ${site.colour}  ${site.what}`,
  });
}
