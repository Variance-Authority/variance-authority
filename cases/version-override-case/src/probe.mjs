// Runs one fixture under one runner twice — from the disk, then with the
// manifest applied — and reads back what each case reported.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFixture } from './fixture.mjs';

const require = createRequire(import.meta.url);
const here = (name) => fileURLToPath(new URL(name, import.meta.url));
const bin = (pkg, path) => join(require.resolve(`${pkg}/package.json`).replace(/package\.json$/, ''), path);

/** Every file the fixture holds and its hash, a runner's own cache under `node_modules` aside. */
const snapshot = (dir) =>
  Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && !join(entry.parentPath, entry.name).includes('/node_modules/'))
      .map((entry) => join(entry.parentPath, entry.name))
      .sort()
      .map((file) => [file, createHash('sha1').update(readFileSync(file)).digest('hex')]),
  );

const jestConfig = (dir, flavor) =>
  JSON.stringify({
    rootDir: dir,
    cacheDirectory: `${dir}-cache`,
    testEnvironment: 'node',
    transform:
      flavor === 'ts'
        ? { '^.+\\.ts$': [require.resolve('@swc/jest'), { swcrc: false, jsc: { parser: { syntax: 'typescript' }, target: 'es2022' }, module: { type: 'es6' } }] }
        : {},
    ...(flavor === 'ts' ? { extensionsToTreatAsEsm: ['.ts'] } : {}),
  });

/** The command per runner, and how its report reads back as `{ <case>: 'passed' | 'failed' }`. */
const runners = {
  jest: {
    args: (fixture, flavor, out) => [bin('jest', 'bin/jest.js'), '--config', jestConfig(fixture.dir, flavor), '--runTestsByPath', '--no-watchman', '--json', `--outputFile=${join(out, 'report.json')}`, ...fixture.testFiles],
    vmModules: (flavor) => flavor !== 'cjs',
    read: (out) => jestLike(join(out, 'report.json')),
  },
  vitest: {
    args: (fixture, _flavor, out) => [bin('vitest', 'vitest.mjs'), 'run', '--root', fixture.dir, '--globals', '--reporter=json', `--outputFile=${join(out, 'report.json')}`, ...fixture.testFiles.map((file) => basename(file))],
    read: (out) => jestLike(join(out, 'report.json')),
  },
  mocha: {
    args: (fixture) => [bin('mocha', 'bin/mocha.js'), '--reporter', 'json', ...fixture.testFiles],
    read: (_out, stdout) => {
      const start = stdout.indexOf('{\n');
      if (start === -1) return undefined;
      const report = JSON.parse(stdout.slice(start));
      return Object.fromEntries([...report.passes.map((test) => [test.title, 'passed']), ...report.failures.map((test) => [test.title, 'failed'])]);
    },
  },
  node: {
    args: (fixture) => [here('node-run.mjs'), ...fixture.testFiles],
    read: (out, stdout) => runners['node --test'].read(out, stdout),
  },
  'node --test': {
    args: (fixture) => ['--test', '--test-reporter=tap', ...fixture.testFiles],
    read: (_out, stdout) => {
      const cases = {};
      for (const [, status, name] of stdout.matchAll(/^\s*(ok|not ok) \d+ - (.+)$/gm)) cases[name.replace(/ # .*$/, '')] = status === 'ok' ? 'passed' : 'failed';
      return cases;
    },
  },
};

const jestLike = (file) => {
  if (!existsSync(file)) return undefined;
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const cases = {};
  for (const result of report.testResults) {
    for (const assertion of result.assertionResults) cases[assertion.title] = assertion.status === 'passed' ? 'passed' : 'failed';
    if (result.assertionResults.length === 0) cases[`(file) ${basename(result.name)}`] = 'failed';
  }
  return cases;
};

/** @param {keyof typeof runners} runner @param {'cjs'|'esm'|'ts'} flavor */
export const probe = (runner, flavor) => {
  const fixture = writeFixture(runner, flavor);
  const spec = runners[runner];
  const before = snapshot(fixture.dir);
  const run = (label, override) => {
    const out = `${fixture.dir}-${label}`;
    mkdirSync(out, { recursive: true });
    const options = [
      ...(override ? ['--require', here('override.cjs'), '--import', here('hooks.mjs')] : []),
      ...(flavor === 'ts' && (runner.startsWith('node') || runner === 'mocha') ? ['--import', here('swc-hooks.mjs')] : []),
      ...(spec.vmModules?.(flavor) ? ['--experimental-vm-modules'] : []),
    ];
    // A Vitest or a recording around the probe is not the fixture's.
    const inherited = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(VITEST|VARIANCE_AUTHORITY_)/.test(name)));
    const env = { ...inherited, NODE_OPTIONS: options.join(' '), VERSION_OVERRIDE: override ? fixture.manifestPath : '', FORCE_COLOR: '0', NO_COLOR: '1' };
    const child = spawnSync(process.execPath, spec.args(fixture, flavor, out), { cwd: fixture.dir, env, encoding: 'utf8', timeout: 120_000 });
    return { status: child.status, cases: spec.read(out, child.stdout) ?? {}, output: `${child.stdout}\n${child.stderr}`.trim() };
  };
  // Head, base, head again: the last run shows whether a runner's cache, keyed
  // on something other than content, hands base content to a later head run.
  const control = run('control', false);
  const override = run('override', true);
  const after = run('after', false);
  const untouched = JSON.stringify(snapshot(fixture.dir)) === JSON.stringify(before);
  if (!process.env.PROBE_KEEP) for (const suffix of ['', '-control', '-override', '-after', '-cache']) rmSync(`${fixture.dir}${suffix}`, { recursive: true, force: true });
  return { runner, flavor, dir: fixture.dir, control, override, after, untouched };
};

export const runnerNames = Object.keys(runners);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [only, flavorOnly] = process.argv.slice(2);
  for (const runner of runnerNames.filter((name) => !only || name === only)) {
    for (const flavor of ['cjs', 'esm', 'ts'].filter((name) => !flavorOnly || name === flavorOnly)) {
      const result = probe(runner, flavor);
      const cases = (run) => JSON.stringify(run.cases);
      console.log(`${runner}/${flavor}\n  head  ${cases(result.control)}\n  base  ${cases(result.override)}\n  head  ${cases(result.after)}\n  untouched ${result.untouched}`);
      if (process.env.PROBE_VERBOSE) console.log(result.override.output.slice(-3000));
    }
  }
}
