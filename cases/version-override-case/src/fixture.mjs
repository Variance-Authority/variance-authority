// One suite at two versions, written to a temporary directory: the disk holds
// the head, and the manifest the base of every test-side file that differs.
//
//   src/value      source, head only on disk, never overridden: old tests run on new code,
//                  which changed 2 to 3, so gone.test's old assertion fails and deep.test's holds
//   helper         test-only, head on disk, base in the manifest
//   kept.test      head on disk, base in the manifest
//   gone.test      base only: in the manifest, not on disk
//   added.test     head only: on disk, hidden by the manifest
//   added-helper   head only: on disk, hidden, and the base kept.test proves it cannot load it
//   new-helper     base only, imported by the base kept.test: a `require` names it without an extension
//   old/deep.test  base only, in a directory the head does not have
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** How a runner's test file opens, per module system. */
const preludes = {
  jest: { cjs: '', esm: '' },
  vitest: { cjs: '', esm: '' },
  mocha: { cjs: '', esm: '' },
  node: { cjs: "const { test: it } = require('node:test');\n", esm: "import { test as it } from 'node:test';\n" },
};

/** @param {'jest'|'vitest'|'mocha'|'node'} runner @param {'cjs'|'esm'|'ts'} flavor */
export const writeFixture = (runner, flavor) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `version-override-${runner.replace(/\W+/g, "-")}-${flavor}-`)));
  const esm = flavor !== 'cjs';
  const ext = flavor === 'ts' ? 'ts' : 'js';
  const prelude = preludes[runner.split(' ')[0]][esm ? 'esm' : 'cjs'];
  const assert = esm ? "import assert from 'node:assert';\n" : "const assert = require('node:assert');\n";
  const imports = (name, from) => (esm ? `import { ${name} } from '${from}.${ext}';\n` : `const { ${name} } = require('${from}');\n`);
  const exports = (name, value) => (esm ? `export const ${name} = ${value};\n` : `exports.${name} = ${value};\n`);
  const loads = (from) => (esm ? `await import('${from}.${ext}')` : `require('${from}')`);
  const typed = flavor === 'ts' ? ': string' : '';
  const file = (name) => join(dir, `${name}.${ext}`);

  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: esm ? 'module' : 'commonjs' }));
  writeFileSync(file('src/value'), exports('value', 3));
  writeFileSync(file('helper'), exports('helper', "()" + typed + " => 'head-helper'"));
  writeFileSync(file('added-helper'), exports('added', 'true'));
  const head = (name, body) => `${prelude}${assert}${body}`.replace('NAME', name);
  writeFileSync(file('kept.test'), head('kept head', `${imports('helper', './helper')}it('NAME', () => assert.strictEqual(helper(), 'head-helper'));\n`));
  writeFileSync(file('added.test'), head('added', `${imports('value', './src/value')}it('NAME', () => assert.strictEqual(value, 3));\n`));

  const manifest = {
    [file('helper')]: exports('helper', "()" + typed + " => 'base-helper'"),
    [file('kept.test')]:
      `${prelude}${assert}${imports('helper', './helper')}` +
      `it('kept base', () => assert.strictEqual(helper(), 'base-helper'));\n` +
      `it('hides added helper', async () => { await assert.rejects(async () => ${loads('./added-helper')}); });\n` +
      `it('base helper', async () => assert.strictEqual((${loads('./new-helper')}).n, 7));\n`,
    [file('new-helper')]: exports('n', 7),
    [file('old/deep.test')]: `${prelude}${assert}${imports('value', '../src/value')}it('deep', () => assert.ok(value > 0));\n`,
    [file('gone.test')]: `${prelude}${assert}${imports('value', './src/value')}it('gone', () => assert.strictEqual(value, 2));\n`,
    [file('added.test')]: null,
    [file('added-helper')]: null,
  };
  const manifestPath = join(dir, '.version-override.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  return { dir, manifestPath, testFiles: { head: [file('kept.test'), file('added.test')], base: [file('kept.test'), file('gone.test'), file('old/deep.test')] }, ext };
};
