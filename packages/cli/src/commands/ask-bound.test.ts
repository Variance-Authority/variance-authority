import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, paragraph, run } from './ask-packages.fixture.js';

/**
 * A name a file takes off another value, by destructuring it or by binding a
 * whole required module, is bound there and declared elsewhere or nowhere.
 * `symbol`, `uses` and `classify` keep it apart from the declarations.
 */

const cwd = process.cwd();

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-bound-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

const AT = 'packages/kit/src/bound';

const BOUND = {
  [`${AT}/a.js`]: 'class Ledger {\n  run() {}\n}\nmodule.exports = { Ledger };\n',
  [`${AT}/b.js`]: "const { Ledger } = require('./a');\nconst wholeModule = require('./a');\nexports.start = () => new Ledger(wholeModule);\n",
  [`${AT}/c.js`]: 'const { theCallee } = make();\nconst { heldValue } = primordials;\nconst madeValue = make();\nexports.use = () => [theCallee, heldValue, madeValue];\n',
  [`${AT}/d.js`]: "const { theCallee } = make();\nconst { heldValue } = primordials;\nconst { takenOff } = require('./a');\nexports.use = () => [theCallee, heldValue, takenOff];\n",
  [`${AT}/e.mjs`]: 'export const { shownValue } = globalThis.box;\n',
};

async function indexed(more: Readonly<Record<string, string>> = {}): Promise<void> {
  checkout({ ...BOUND, ...more });
  expect((await run(['index'])).code).toBe(EXIT_CLEAN);
}

async function asked(tool: string, ...options: readonly string[]): Promise<string> {
  const { code, out } = await run(['ask', tool, ...options]);
  expect(code).toBe(EXIT_CLEAN);
  return out;
}

describe('variance ask about a name a file binds and does not declare', () => {
  it('answers `symbol` with the declaration alone, then the file that binds the name', async () => {
    await indexed();

    const out = await asked('symbol', '--name', 'Ledger');
    expect(paragraph(out, /^Ledger \[class\]\n/)).toContain(`${AT}/a.js:4`);
    const bound = paragraph(out, /^Ledger \[binding\]\n/);
    expect(bound).toContain(`Ledger [binding]\nbound, not declared, at ${AT}/b.js:1 by @acme/kit`);
    expect(out.indexOf(bound)).toBeGreaterThan(out.indexOf('Ledger [class]'));
    expect(out).not.toContain('declared, not exported');
    expect(out).not.toContain('No file in this workspace declares');
  });

  it('answers `uses` without counting the file that binds the name as another declaration', async () => {
    await indexed();

    const out = await asked('uses', '--name', 'Ledger');
    expect(out).not.toContain('declared once more');
    expect(out).not.toContain('It is declared');
    expect(out).toContain(`\`Ledger\` [binding] is bound, not declared, at ${AT}/b.js:1`);
    expect(out).toContain(`\nUsed in ${AT}/b.js — @acme/kit, which binds it:\n\n  3\n`);
  });

  it('says no file declares a name that is only destructured from a call, and lists the files that bind it', async () => {
    await indexed();

    const out = await asked('symbol', '--name', 'theCallee');
    expect(out).toMatch(/^`theCallee` is not published by this workspace.* No file in this workspace declares `theCallee`, at its top level or as a member\./);
    expect(out).toContain(`bound, not declared, at ${AT}/c.js:1 by @acme/kit`);
    expect(out).toContain(`bound, not declared, at ${AT}/d.js:1 by @acme/kit`);
    expect(out).not.toContain('declared, not exported');

    const uses = await asked('uses', '--name', 'theCallee');
    expect(uses).toContain('No file in this workspace declares `theCallee`');
    expect(uses).toContain('`theCallee` is bound, not declared, in 2 files:\n');
    expect(uses).toContain(`\nUsed in ${AT}/c.js — @acme/kit, which binds it:\n\n  4\n`);
    expect(uses).not.toContain('declared, not exported');
  });

  it('lists the binding files under `--limit` and counts the rest', async () => {
    await indexed();

    const out = await asked('symbol', '--name', 'theCallee', '--limit', '1');
    expect(out).toContain(`bound, not declared, at ${AT}/c.js:1`);
    expect(out).not.toContain(`${AT}/d.js`);
    expect(out).toContain('1 more binding of `theCallee` not shown; a higher `--limit` shows them.');
  });

  it('answers a name destructured from an undeclared value and from a require in the words of one destructured from a call', async () => {
    await indexed();

    const words = (out: string, name: string): string =>
      paragraph(out, new RegExp(`^${name} \\[binding\\]\\n`)).replace(/\nSnapshot [^]*$/, '').replaceAll(name, 'NAME').replace(/\/[cd]\.js:\d+/, '/AT');
    const callee = words(await asked('symbol', '--name', 'theCallee'), 'theCallee');
    expect(callee).toContain('bound, not declared, at');
    expect(words(await asked('symbol', '--name', 'heldValue'), 'heldValue')).toBe(callee);
    expect(words(await asked('symbol', '--name', 'takenOff'), 'takenOff')).toBe(callee);
  });

  it('names no file that declares a name bound only to a whole required module', async () => {
    await indexed();

    const symbol = await asked('symbol', '--name', 'wholeModule');
    expect(symbol).toMatch(/^`wholeModule` is not published by this workspace.* No file in this workspace declares `wholeModule`/);
    expect(symbol).toContain(`wholeModule [binding]\nbound, not declared, at ${AT}/b.js:2`);
    const uses = await asked('uses', '--name', 'wholeModule');
    expect(uses).toContain('No file in this workspace declares `wholeModule`');
    expect(uses).toContain(`\`wholeModule\` [binding] is bound, not declared, at ${AT}/b.js:2`);
    for (const out of [symbol, uses]) expect(out).not.toContain('declared, not exported');
    expect(await asked('classify', '--query', 'wholeModule')).not.toContain(`${AT}/b.js`);
  });

  it('answers the declaration a file keeps before a file that binds the name, and counts it alone', async () => {
    await indexed({ [`${AT}/z.js`]: 'function theCallee() {}\nexports.held = () => theCallee();\n' });

    const out = await asked('symbol', '--name', 'theCallee', '--limit', '1');
    expect(out.indexOf(`declared, not exported, at ${AT}/z.js:1`)).toBeGreaterThan(-1);
    expect(out.indexOf(`bound, not declared, at ${AT}/c.js:1`)).toBeGreaterThan(out.indexOf(`declared, not exported, at ${AT}/z.js:1`));
    expect(out).not.toContain('more declaration');
    expect(out).not.toContain('No file in this workspace declares');

    const uses = await asked('uses', '--name', 'theCallee');
    expect(uses).toContain(`\`theCallee\` [function] is declared, not exported, at ${AT}/z.js:1`);
    expect(uses).toContain('`theCallee` is bound, not declared, in 2 files:\n');
    expect(uses).toContain(`\nUsed in ${AT}/z.js — @acme/kit, which declares it:\n`);
    expect(uses).not.toContain('No file in this workspace declares');
  });

  it('narrows `uses --file` to the file that binds the name', async () => {
    await indexed({ [`${AT}/z.js`]: 'function theCallee() {}\nexports.held = () => theCallee();\n' });

    const mixed = await asked('uses', '--name', 'theCallee', '--file', `${AT}/c.js`);
    expect(mixed).toContain(`\`theCallee\` [binding] is bound, not declared, at ${AT}/c.js:1`);
    expect(mixed).not.toContain(`${AT}/z.js`);
    expect(mixed).not.toContain('No file in this workspace declares');
    expect(await asked('uses', '--name', 'heldValue', '--file', `${AT}/c.js`)).toContain(`\`heldValue\` [binding] is bound, not declared, at ${AT}/c.js:2`);
  });

  it('gives `intersection` the files that declare the name, and those that bind it as uses', async () => {
    await indexed({ [`${AT}/z.js`]: 'function theCallee() {}\nexports.held = () => theCallee();\n' });

    const declared = await asked('intersection', 'symbol --name theCallee', `discover --path ${AT}`);
    expect(declared).toContain(`${AT}/z.js — 1: line 1`);
    expect(declared).not.toContain(`${AT}/c.js —`);
    expect(await asked('intersection', 'uses --name theCallee', `discover --path ${AT}`)).toContain(`${AT}/c.js — 1: line`);
  });

  it('still answers an exported destructuring and a name set to a call as declarations', async () => {
    await indexed();

    const shown = await asked('symbol', '--name', 'shownValue');
    expect(shown).toContain(`${AT}/e.mjs:1`);
    expect(shown).not.toContain('bound, not declared');
    const made = await asked('symbol', '--name', 'madeValue');
    expect(made).toContain(`madeValue [const]\ndeclared, not exported, at ${AT}/c.js:3`);
    expect(made).not.toContain('bound, not declared');
  });
});
