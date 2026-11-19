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

/** `node:test` without its CLI, whose glob reads through `fs` functions captured before any preload. */
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
  const janus = (...run: [string, ...string[]]) => runJanus({ command: 'janus', since: 'base', run }, streams, root);

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
    // The head: the code moved, its test was rewritten to agree, one test was deleted and one added.
    writeFileSync(join(root, 'src', 'value.js'), 'module.exports = { value: 2, kept: 7 };\n');
    writeFileSync(join(root, 'src', 'value.test.js'), readFileSync(join(root, 'src', 'value.test.js'), 'utf8').replace("'value is one', () => assert.equal(value, 1)", "'value is two', () => assert.equal(value, 2)"));
    rmSync(join(root, 'src', 'gone.test.js'));
    writeFileSync(join(root, 'src', 'new.test.js'), "require('node:test')('only the head has me', () => {});\n");
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'head');
  });

  it('runs the base test on the head code, and its exit is the run\'s', async () => {
    const before = snapshot(root);
    const exit = await janus(process.execPath, 'run.mjs', out, 'src/value.test.js', 'src/gone.test.js');
    const report = readFileSync(out, 'utf8');
    expect(report).toContain('value is one');
    expect(report).not.toContain('value is two');
    expect(report).toMatch(/✔ kept is seven/);
    expect(report).toMatch(/✖ value is one/);
    expect(report).toContain('only the base has me');
    expect(exit).toBe(1);
    expect(snapshot(root)).toEqual(before);
  });

  it('fails the `node --test` CLI, whose glob does not see a test only the base has, and names it', async () => {
    const exit = await janus(...nodeTest(out, 'src/value.test.js', 'src/gone.test.js'));
    expect(exit).not.toBe(0);
    expect(notes.join('')).toContain('src/gone.test.js');
  });

  it('hides a test only the head has', async () => {
    const exit = await janus(process.execPath, 'run.mjs', out, 'src/value.test.js', 'src/gone.test.js', 'src/new.test.js');
    expect(readFileSync(out, 'utf8')).not.toContain('only the head has me');
    expect(exit).not.toBe(0);
  });

  it('fails a run that never read a file it was served, and names it', async () => {
    const exit = await janus(...nodeTest(out, 'src/value.test.js'));
    expect(exit).not.toBe(0);
    expect(notes.join('')).toContain('src/gone.test.js');
    expect(notes.join('')).not.toContain('src/value.test.js');
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
    const exit = await janus(process.execPath, join(vitest, 'vitest.mjs'), 'run', '--root', root, '--reporter=json', `--outputFile=${out}`);
    const report = JSON.parse(readFileSync(out, 'utf8')) as { testResults: { assertionResults: { title: string; status: string }[] }[] };
    expect(report.testResults.flatMap((file) => file.assertionResults.map(({ title, status }) => `${status} ${title}`))).toEqual(['failed value is 1']);
    expect(exit).not.toBe(0);
  });

  it('serves Jest when its crawler reads through Node', async () => {
    const jest = dirname(createRequire(import.meta.url).resolve('jest/package.json'));
    for (const file of ['value.test.js', 'gone.test.js', 'new.test.js']) rmSync(join(root, 'src', file), { force: true });
    rmSync(join(root, 'run.mjs'));
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'jest');
    git(root, 'tag', '-f', 'base');
    writeFileSync(join(root, 'src', 'value.test.js'), "const { value } = require('./value');\ntest('value is one', () => expect(value).toBe(1));\n");
    writeFileSync(join(root, 'src', 'gone.test.js'), "test('only the base has me', () => {});\n");
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'base for jest');
    git(root, 'tag', '-f', 'base');
    rmSync(join(root, 'src', 'gone.test.js'));
    writeFileSync(join(root, 'src', 'value.test.js'), "const { value } = require('./value');\ntest('value is two', () => expect(value).toBe(2));\n");
    git(root, 'commit', '-qam', 'head for jest');
    // Jest's default crawler lists files with `find`, below `fs`; a base-only test is then never found.
    const config = JSON.stringify({ rootDir: root, haste: { forceNodeFilesystemAPI: true } });
    const exit = await janus(process.execPath, join(jest, 'bin', 'jest.js'), `--config=${config}`, '--no-watchman', '--no-cache', '--ci', '--json', `--outputFile=${out}`);
    const report = JSON.parse(readFileSync(out, 'utf8')) as { testResults: { assertionResults: { title: string; status: string }[] }[] };
    expect(report.testResults.flatMap((file) => file.assertionResults.map(({ title, status }) => `${status} ${title}`)).sort()).toEqual(['failed value is one', 'passed only the base has me']);
    expect(exit).not.toBe(0);
  });

  it('serves a test the change moved at the path the base had it', async () => {
    git(root, 'mv', 'src/value.test.js', 'src/moved.test.js');
    git(root, 'commit', '-qm', 'moved');
    const exit = await janus(process.execPath, 'run.mjs', out, 'src/value.test.js', 'src/gone.test.js', 'src/moved.test.js');
    const report = readFileSync(out, 'utf8');
    expect(report).toMatch(/✖ value is one/);
    expect(report).not.toContain('value is two');
    expect(exit).toBe(1);
  });

  it('runs the command on the tests as they are when the diff changed none, and says so', async () => {
    const exit = await runJanus({ command: 'janus', since: 'HEAD', run: [process.execPath, 'run.mjs', out, 'src/value.test.js', 'src/new.test.js'] }, streams, root);
    expect(readFileSync(out, 'utf8')).toMatch(/✔ value is two/);
    expect(notes.join('')).toContain('Nothing on the test side changed since `HEAD`');
    expect(exit).toBe(0);
  });

  it('refuses a command that cannot be started, as the operator\'s error', async () => {
    await expect(janus('va-no-such-command')).rejects.toThrow('`va-no-such-command` could not be started');
  });

  it('answers the command\'s exit, from the command line', async () => {
    const cwd = process.cwd();
    process.chdir(root);
    try {
      expect(await main(['janus', '--since', 'HEAD', '--', process.execPath, '-e', 'process.exitCode = 3'], { out: () => {}, err: streams.err })).toBe(3);
    } finally {
      process.chdir(cwd);
    }
  });

  it('refuses a ref git cannot read, from the command line', async () => {
    const err: string[] = [];
    const exit = await main(['janus', '--since', 'va-no-such-ref', '--', process.execPath, '-e', ''], { out: () => {}, err: (text: string) => void err.push(text) });
    expect(err.join('')).toContain('`--since va-no-such-ref` could not be read');
    expect(exit).toBe(EXIT_OPERATOR);
  });

  it('lists a base-only test to a runner that finds its tests in one recursive listing', async () => {
    writeFileSync(join(root, 'run.mjs'), runner.replace(
      'const [out, ...files] = process.argv.slice(2);',
      "import { readdirSync } from 'node:fs';\nconst [out] = process.argv.slice(2);\nconst files = readdirSync('.', { recursive: true }).filter((file) => file.endsWith('.test.js'));",
    ));
    git(root, 'commit', '-qam', 'recursive runner');
    const exit = await janus(process.execPath, 'run.mjs', out);
    const report = readFileSync(out, 'utf8');
    expect(report).toContain('only the base has me');
    expect(report).not.toContain('only the head has me');
    expect(notes.join('')).toBe('');
    expect(exit).toBe(1);
  });

  it('loads a base-only test written as a module where no `type` says so, as Node detects it', async () => {
    git(root, 'checkout', '-q', 'base');
    writeFileSync(join(root, 'src', 'module.test.js'), "import { test } from 'node:test';\ntest('a module only the base has', () => {});\n");
    git(root, 'add', '-A');
    git(root, 'commit', '-qm', 'base with a module');
    const based = git(root, 'rev-parse', 'HEAD');
    git(root, 'checkout', '-q', '-');
    git(root, 'merge', '-q', '--no-edit', based);
    git(root, 'rm', '-q', 'src/module.test.js');
    git(root, 'commit', '-qm', 'module gone');
    git(root, 'tag', '-f', 'base', based);
    const exit = await janus(process.execPath, 'run.mjs', out, 'src/module.test.js', 'src/value.test.js', 'src/gone.test.js');
    expect(readFileSync(out, 'utf8')).toMatch(/✔ a module only the base has/);
    expect(notes.join('')).toBe('');
    expect(exit).toBe(1);
  });
});
