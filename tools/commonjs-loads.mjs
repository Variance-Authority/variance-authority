import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSync } from 'oxc-parser';
import { ROOT, isSource, lines, visit } from './owners.mjs';

/**
 * Every module our code loads through CommonJS, and why each one may.
 *
 * An edge spelled `require(…)`, `createRequire(…)(…)` or `import x = require(…)`
 * is one a reader following imports does not see, and neither does
 * `variance ask uses`. Where a static `import` carries the same edge — our own
 * module by a literal path, a JSON file — it is the import. What stays is listed
 * in {@link ALLOWED} by file and specifier with its reason, so a new load is a
 * decision somebody writes down rather than a habit that spreads.
 *
 * A `.resolve(…)` is not a load: it answers a path and runs nothing.
 */

/** Production sources, and the scripts a package ships under `scripts/`. */
export const isRead = (file) => isSource(file) || /^packages\/[^/]+\/scripts\/[^/]+\.[cm]?[jt]s$/.test(file);

/**
 * A CommonJS file, whose imports have no other spelling: `import x = require(…)`
 * in a `.cts`, since under `verbatimModuleSyntax` it cannot write an ECMAScript
 * import (TS1286), and `require('…')` of a literal in a `.cjs`. Either is the
 * file's static import; a computed one is still a load and needs a row.
 */
const COMMONJS_FILE = /\.c[jt]s$/;

/**
 * The loads that stay, as `{ file, specifier, reason }`. `specifier` is the
 * string a literal names, or the argument's source text when it is computed.
 */
export const ALLOWED = [
  // node:sqlite. It is not in `module.builtinModules` on Node 22, which these
  // packages' engines still admit, and the comment at each site names the
  // condition that retires the workaround.
  { file: 'packages/server/src/backend-sqlite.ts', specifier: 'node:sqlite', reason: 'not in builtinModules on Node 22' },
  { file: 'packages/tribunal/src/node/database.ts', specifier: 'node:sqlite', reason: 'not in builtinModules on Node 22' },
  { file: 'packages/tribunal/src/testing.ts', specifier: 'node:sqlite', reason: 'not in builtinModules on Node 22' },

  // A native addon: `.node` has no ECMAScript import.
  { file: 'packages/sense/src/addon.ts', specifier: 'specifier', reason: 'the native addon' },
  { file: 'packages/sense/scripts/tuned-cost.mjs', specifier: 'process.env.VA_TUNED_ADDON', reason: 'a native addon named at run time' },

  // The project's code, at a path only the project's configuration names.
  { file: 'packages/isolator/src/jest-transformer.ts', specifier: 'path', reason: "the project's own Jest transformer" },
  { file: 'packages/sense/src/test-selection/jest-transformer.ts', specifier: 'path', reason: "the project's own Jest transformer" },
  { file: 'packages/sense/src/test-selection/jest-placing.ts', specifier: 'at', reason: "the project's own Jest sequencer" },
  { file: 'packages/sense/src/test-selection/jest-preset.ts', specifier: 'file', reason: "the project's Jest resolver, as Jest loads it" },
  { file: 'packages/sense/src/test-selection/jest-runtime.cts', specifier: 'file', reason: "a project file, through the project's require" },
  { file: 'packages/sense/src/test-selection/jest-runtime.cts', specifier: 'own', reason: "the project's own Jest runtime" },
  {
    file: 'packages/sense/src/test-selection/jest-selection.ts',
    specifier: "from.resolve('jest/package.json')",
    reason: "the version of the project's Jest",
  },
  {
    file: 'packages/sense/src/test-selection/jest-selection.ts',
    specifier: 'from.resolve(path, { paths: [rootDir] })',
    reason: "the project's own Jest filter",
  },

  // The project's Playwright, as its worker loaded it: an import would resolve
  // this package's copy, and the internals are files no export opens.
  {
    file: 'packages/playwright-test/src/whole-file-shard.ts',
    specifier: '@playwright/test/package.json',
    reason: "the version of the project's Playwright",
  },
  { file: 'packages/playwright-test/src/file-selection.ts', specifier: 'playwright/lib/util', reason: "a Playwright internal" },
  { file: 'packages/playwright-test/src/preconditions.ts', specifier: 'separate', reason: "Playwright's test loader, by file" },
  {
    file: 'packages/playwright-test/src/preconditions.ts',
    specifier: "join(root, 'lib/common/index.js')",
    reason: "Playwright's test loader, by file",
  },
  { file: 'packages/playwright-test/src/preconditions.ts', specifier: 'playwright/package.json', reason: "the version of the project's Playwright" },

  // Our runtime, by the path its configuration carries, inside a Jest worker
  // before any environment exists.
  { file: 'packages/sense/src/test-selection/jest-transform.ts', specifier: 'config.runtime', reason: 'synchronous in a Jest worker' },
];

/** Every CommonJS load in one file's text, as `{ file, line, specifier, form, literal }`. */
export function loadsIn(file, text) {
  const program = parseSync(file, text, { lang: language(file) }).program;
  const lineOf = lines(text);
  const found = [];
  const bound = new Set();
  const shadowed = new Set();
  const makers = new Set();
  const isCreateRequire = (node) =>
    node?.type === 'CallExpression' &&
    ((node.callee.type === 'Identifier' && node.callee.name === 'createRequire') ||
      (node.callee.type === 'MemberExpression' && node.callee.property?.name === 'createRequire'));
  const spelled = (argument) =>
    argument === undefined
      ? ''
      : argument.type === 'Literal' && typeof argument.value === 'string'
        ? argument.value
        : text.slice(argument.start, argument.end);

  // Names a `createRequire(…)` result is bound to, anywhere in the file.
  visit(program, (node) => {
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
      (isCreateRequire(node.init) ? bound : shadowed).add(node.id.name);
    }
    if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier' && isCreateRequire(node.right)) {
      bound.add(node.left.name);
    }
    // A function whose whole answer is a `createRequire(…)`: its call is one.
    if (node.type === 'FunctionDeclaration' && node.id !== null) {
      const [only] = node.body?.body ?? [];
      if (node.body?.body.length === 1 && only.type === 'ReturnStatement' && isCreateRequire(only.argument)) {
        makers.add(node.id.name);
      }
    }
  });
  const isMade = (node) =>
    isCreateRequire(node) ||
    (node?.type === 'CallExpression' && node.callee.type === 'Identifier' && makers.has(node.callee.name));

  visit(program, (node) => {
    if (node.type === 'TSImportEqualsDeclaration' && node.moduleReference.type === 'TSExternalModuleReference') {
      found.push({
        file,
        line: lineOf(node.start),
        specifier: spelled(node.moduleReference.expression),
        form: 'import =',
        literal: true,
      });
      return;
    }
    if (node.type !== 'CallExpression') return;
    const { callee } = node;
    const loads =
      (callee.type === 'Identifier' &&
        (bound.has(callee.name) || (callee.name === 'require' && !shadowed.has('require')))) ||
      isMade(callee);
    if (!loads) return;
    const [argument] = node.arguments;
    const literal = argument?.type === 'Literal' && typeof argument.value === 'string' && callee.name === 'require';
    found.push({ file, line: lineOf(node.start), specifier: spelled(argument), form: 'call', literal });
  });
  return found;
}

/** Every CommonJS load in the files this reads. */
export function loads() {
  return execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(isRead)
    .filter((file) => existsSync(join(ROOT, file)))
    .flatMap((file) => loadsIn(file, readFileSync(join(ROOT, file), 'utf8')));
}

/** What breaks the rule: loads no row allows, and rows no load is left for. */
export function judged(found, allowed = ALLOWED) {
  const allows = (load) =>
    (COMMONJS_FILE.test(load.file) && (load.form === 'import =' || load.literal)) ||
    allowed.some((row) => row.file === load.file && row.specifier === load.specifier);
  return {
    refused: found.filter((load) => !allows(load)),
    stale: allowed.filter((row) => !found.some((load) => load.file === row.file && load.specifier === row.specifier)),
  };
}

function language(file) {
  if (/\.[cm]?tsx?$/.test(file)) return file.endsWith('x') ? 'tsx' : 'ts';
  return 'js';
}
