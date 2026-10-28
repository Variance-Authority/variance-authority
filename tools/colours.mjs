#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, countedBy, parse, ratchet, sources, visit } from './owners.mjs';

/**
 * What colour each package is, and the sites where a package takes on another.
 *
 * Holds **A specialist keeps its colour** in `.agents/references/change.md`. A
 * colour is read from the parse tree, never from comments: an import of a
 * domain's packages or of ours of that colour, or a domain's private name as an
 * identifier, a property or a string. A ratchet, like `owners.mjs`: `yarn
 * colours` prints the sites, `--write` records them, `tools/colours.check.ts`
 * fails a new one.
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
  '@variance-authority/isolator': 'none',
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

// `import … from`, `export … from`, `import()`, `import x = require()`,
// `declare module`, `import('…').T`, `require()`, `require.resolve()`, and a
// runner's mock of a module.
const LOADERS = {
  require: ['resolve'],
  vi: ['mock', 'doMock', 'unmock', 'importActual', 'importMock'],
  jest: ['mock', 'doMock', 'unmock', 'requireActual', 'requireMock'],
};

function specifierOf(node) {
  const literal = (value) => (value?.type === 'Literal' && typeof value.value === 'string' ? value.value : undefined);
  if (['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression', 'TSImportType'].includes(node.type)) {
    return literal(node.source);
  }
  if (node.type === 'TSImportEqualsDeclaration' && node.moduleReference.type === 'TSExternalModuleReference') {
    return literal(node.moduleReference.expression);
  }
  if (node.type === 'TSModuleDeclaration') return literal(node.id);
  if (node.type !== 'CallExpression') return undefined;
  const { callee } = node;
  if (callee.type === 'Identifier' && callee.name === 'require') return literal(node.arguments[0]);
  if (
    callee.type === 'MemberExpression' &&
    !callee.computed &&
    callee.object.type === 'Identifier' &&
    LOADERS[callee.object.name]?.includes(callee.property.name)
  ) {
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
