import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { main } from '../bin.js';
import { EXIT_OPERATOR } from '../exit.js';
import { runJanus } from './janus.js';

const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

/** Every tracked and untracked file's content, so a run that wrote the checkout shows. */
const snapshot = (root: string) => git(root, 'ls-files', '-co', '--exclude-standard').split('\n').map((file) => `${file}\n${readFileSync(join(root, file), 'utf8')}`);

const nodeTest = (out: string, ...files: string[]) => [process.execPath, '--test', '--test-reporter=spec', `--test-reporter-destination=${out}`, ...files];

/** `node:test` run on the files it is given, reporting to a file. */
const runner = [
  "import { createWriteStream } from 'node:fs';",
  "import { run } from 'node:test';",
  "import { spec } from 'node:test/reporters';",
  'const [out, ...files] = process.argv.slice(2);',
  'const stream = run({ files });',
  "stream.on('test:fail', () => (process.exitCode = 1));",
  'stream.compose(new spec()).pipe(createWriteStream(out));',
  '',
].join('\n');

describe('`variance janus`: the base tests on the head code, in place', () => {
  let root: string;
  let notes: string[];
  let out: string;
  const streams = { err: (text: string) => void notes.push(text) };
  const janusOn = (files: [string, ...string[]], ...run: [string, ...string[]]) => runJanus({ command: 'janus', since: 'base', files, run }, streams, root);
  const janus = (...run: [string, ...string[]]) => janusOn(['src/value.test.js'], ...run);

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'va-janus-')));
    out = join(realpathSync(mkdtempSync(join(tmpdir(), 'va-janus-out-'))), 'report');
    notes = [];
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'a@b.c');
    git(root, 'config', 'user.name', 'a');
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'src', 'value.js'), 'module.exports = { value: 1, kept: 7 };\n');
    writeFileSync(join(root, 'src', 'value.test.js'), [
      "const { test } = require('node:test');",
      "const assert = require('node:assert');",
      "const { value, kept } = require('./value');",
      "test('value is one', () => assert.equal(value, 1));",
      "test('kept is seven', () => assert.equal(kept, 7));",
      '',
    ].join('\n'));
    writeFileSync(join(root, 'src', 'gone.test.js'), "require('node:test')('only the base has me', () => {});\n");
    writeFileSync(join(root, 'run.mjs'), runner);
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'base');
    git(root, 'tag', 'base');
    // The head: the code changed, its test was rewritten to agree, one test was deleted and one added.
    writeFileSync(join(root, 'src', 'value.js'), 'module.exports = { value: 2, kept: 7 };\n');
    writeFileSync(join(root, 'src', 'value.test.js'), readFileSync(join(root, 'src', 'value.test.js'), 'utf8').replace("'value is one', () => assert.equal(value, 1)", "'value is two', () => assert.equal(value, 2)"));
    rmSync(join(root, 'src', 'gone.test.js'));
    writeFileSync(join(root, 'src', 'new.test.js'), "require('node:test')('only the head has me', () => {});\n");
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'head');
  });

  it('runs the base test on the head code, and its exit is the run\'s', async () => {
    const before = snapshot(root);
    const exit = await janus(process.execPath, 'run.mjs', out, 'src/value.test.js');
    const report = readFileSync(out, 'utf8');
    expect(report).toContain('value is one');
    expect(report).not.toContain('value is two');
    expect(report).toMatch(/✔ kept is seven/);
    expect(report).toMatch(/✖ value is one/);
    expect(exit).toBe(1);
    expect(snapshot(root)).toEqual(before);
  });

  it('serves the `node --test` CLI, whose files the head holds', async () => {
    const exit = await janus(...nodeTest(out, 'src/value.test.js'));
    expect(readFileSync(out, 'utf8')).toMatch(/✖ value is one/);
    expect(notes.join('')).toBe('');
    expect(exit).toBe(1);
  });

  it('rolls back only the files it is given: a test the head added runs as the head has it', async () => {
    const exit = await janus(process.execPath, 'run.mjs', out, 'src/value.test.js', 'src/new.test.js');
    const report = readFileSync(out, 'utf8');
    expect(report).toMatch(/✔ only the head has me/);
    expect(report).toMatch(/✖ value is one/);
    expect(notes.join('')).toBe('');
    expect(exit).toBe(1);
  });

  it('fails a run that never read a file it was served, and names it', async () => {
    const exit = await janus(process.execPath, '-e', '');
    expect(exit).toBe(1);
    expect(notes.join('')).toContain('src/value.test.js');
  });

  it('serves a runner that starts its tests in workers: Vitest', async () => {
    const vitest = dirname(createRequire(import.meta.url).resolve('vitest/package.json'));
    root = realpathSync(mkdtempSync(join(tmpdir(), 'va-janus-vitest-')));
    git(root, 'init', '-q');
    git(root, 'config', 'user.email', 'a@b.c');
    git(root, 'config', 'user.name', 'a');
    writeFileSync(join(root, '.gitignore'), 'node_modules/\n');
    writeFileSync(join(root, 'package.json'), '{ "type": "module" }\n');
    mkdirSync(join(root, 'node_modules'));
    symlinkSync(vitest, join(root, 'node_modules', 'vitest'));
    const spec = (value: number) => `import { expect, test } from 'vitest';\nimport { value } from './value.js';\ntest('value is ${value}', () => expect(value).toBe(${value}));\n`;
    writeFileSync(join(root, 'value.js'), 'export const value = 1;\n');
    writeFileSync(join(root, 'value.test.js'), spec(1));
    git(root, 'add', '.');
    git(root, 'commit', '-qm', 'base');
    git(root, 'tag', 'base');
    writeFileSync(join(root, 'value.js'), 'export const value = 2;\n');
    writeFileSync(join(root, 'value.test.js'), spec(2));
    git(root, 'commit', '-qam', 'head');
    const exit = await janusOn(['value.test.js'], process.execPath, join(vitest, 'vitest.mjs'), 'run', '--root', root, '--reporter=json', `--outputFile=${out}`);
    const report = JSON.parse(readFileSync(out, 'utf8')) as { testResults: { assertionResults: { title: string; status: string }[] }[] };
    expect(report.testResults.flatMap((file) => file.assertionResults.map(({ title, status }) => `${status} ${title}`))).toEqual(['failed value is 1']);
    expect(exit).not.toBe(0);
  });

  it('serves Jest as it runs by default', async () => {
    const jest = dirname(createRequire(import.meta.url).resolve('jest/package.json'));
    for (const file of ['value.test.js', 'gone.test.js', 'new.test.js']) rmSync(join(root, 'src', file), { force: true });
    rmSync(join(root, 'run.mjs'));
    writeFileSync(join(root, 'package.json'), '{}\n');
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'jest');
    git(root, 'tag', '-f', 'base');
    writeFileSync(join(root, 'src', 'value.test.js'), "const { value } = require('./value');\ntest('value is one', () => expect(value).toBe(1));\n");
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'base for jest');
    git(root, 'tag', '-f', 'base');
    writeFileSync(join(root, 'src', 'value.test.js'), "const { value } = require('./value');\ntest('value is two', () => expect(value).toBe(2));\n");
    git(root, 'commit', '-qam', 'head for jest');
    const exit = await janus(process.execPath, join(jest, 'bin', 'jest.js'), `--rootDir=${root}`, '--ci', '--json', `--outputFile=${out}`);
    const report = JSON.parse(readFileSync(out, 'utf8')) as { testResults: { assertionResults: { title: string; status: string }[] }[] };
    expect(report.testResults.flatMap((file) => file.assertionResults.map(({ title, status }) => `${status} ${title}`)).sort()).toEqual(['failed value is one']);
    expect(exit).not.toBe(0);
  });

  it('refuses a file the checkout does not hold, and one the base did not, as the operator\'s error', async () => {
    await expect(janusOn(['src/gone.test.js'], process.execPath, '-e', '')).rejects.toThrow('`src/gone.test.js` is not a file in the checkout');
    await expect(janusOn(['src/new.test.js'], process.execPath, '-e', '')).rejects.toThrow('`src/new.test.js` did not exist at `base`');
  });

  it('refuses a command that cannot be started, as the operator\'s error', async () => {
    await expect(janus('va-no-such-command')).rejects.toThrow('`va-no-such-command` could not be started');
  });

  it('answers the command\'s exit, from the command line', async () => {
    const cwd = process.cwd();
    process.chdir(root);
    try {
      expect(await main(['janus', '--since', 'HEAD', '--file', 'src/value.test.js', '--', process.execPath, '-e', 'process.exitCode = 3'], { out: () => {}, err: streams.err })).toBe(3);
    } finally {
      process.chdir(cwd);
    }
  });

  it('refuses a ref git cannot read, from the command line', async () => {
    const err: string[] = [];
    const exit = await main(['janus', '--since', 'va-no-such-ref', '--file', 'src/value.test.js', '--', process.execPath, '-e', ''], { out: () => {}, err: (text: string) => void err.push(text) });
    expect(err.join('')).toContain('`--since va-no-such-ref` could not be read');
    expect(exit).toBe(EXIT_OPERATOR);
  });

});
