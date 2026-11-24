import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const platform = resolve(process.argv[2]);
const cli = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'variance-package-bin-'));
const windows = process.platform === 'win32';
const manifest = (root) => JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const write = (root, value) => writeFileSync(join(root, 'package.json'), JSON.stringify(value));

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.error !== undefined) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} ended with ${result.status ?? result.signal}\n${result.stdout}${result.stderr}`);
  }
  return result.stdout;
}

try {
  const bundled = join(temporary, 'platform');
  const installable = join(temporary, 'cli');
  const consumer = join(temporary, 'consumer');
  mkdirSync(bundled);
  mkdirSync(join(installable, 'dist'), { recursive: true });
  mkdirSync(join(installable, 'scripts'));
  mkdirSync(consumer);
  const { scripts: _verification, ...binary } = manifest(platform);
  write(bundled, binary);
  for (const file of binary.files) copyFileSync(join(platform, file), join(bundled, file));

  const npm = (args, cwd = temporary) => run('npm', [...args, '--offline'], {
    cwd, shell: windows, env: { ...process.env, npm_config_cache: join(temporary, 'npm-cache') },
  }).trim();
  const payload = npm(['pack', './platform', '--quiet']);
  const { name, version, type, bin, scripts, files } = manifest(cli);
  write(installable, {
    name, version, type, bin, files, scripts: { postinstall: scripts.postinstall },
    optionalDependencies: { [binary.name]: `file:${join(temporary, payload)}` },
  });
  copyFileSync(join(cli, 'scripts/install-native.mjs'), join(installable, 'scripts/install-native.mjs'));
  run(process.execPath, ['scripts/install-native.mjs', '--stage'], { cwd: installable });

  const cliPackage = npm(['pack', './cli', '--quiet']);
  write(consumer, { name: 'native-bin-test', private: true });
  npm(['install', `../${cliPackage}`, '--no-audit', '--no-fund'], consumer);

  const empty = join(temporary, 'empty-path');
  mkdirSync(empty);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'));
  const executable = windows ? '.\\node_modules\\.bin\\variance.cmd' : './node_modules/.bin/variance';
  writeFileSync(join(consumer, 'indexed.ts'), 'export const indexed = 1;\n');
  const indexed = run(executable, ['index', '--wait'], {
    cwd: consumer, shell: windows,
    env: { ...env, PATH: empty, CI: 'true', VARIANCE_AUTHORITY_CACHE: join(temporary, 'index') },
  });
  if (!indexed.includes('questions: published')) throw new Error(indexed);
  process.stdout.write(`${binary.name}: installed and ran the native package bin\n`);
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
