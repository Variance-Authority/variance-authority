#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { copyFileSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Build both plugins from `editors/` into this package, at this package's version.
 *
 *   node packages/editors/scripts/build.mjs [path to a JetBrains IDE]
 *
 * The version is stamped into each plugin rather than read from its own
 * manifest, so the file an editor installs names the release that carried it.
 * The WebStorm half compiles against the IDE it is given, with that IDE's own
 * compiler; `editors/webstorm/build.sh` says why. It is not part of `yarn build`
 * because it needs that IDE, which a checkout does not.
 */

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const editors = resolve(root, '../../editors');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const vsce = createRequire(import.meta.url).resolve('@vscode/vsce/vsce');

execFileSync(
  process.execPath,
  [vsce, 'package', version, '--no-update-package-json', '--no-git-tag-version', '--no-dependencies',
    '--out', join(root, 'variance-authority.vsix')],
  { cwd: join(editors, 'vscode'), stdio: 'inherit' },
);

const ide = process.argv[2];
execFileSync(join(editors, 'webstorm/build.sh'), ide === undefined ? [] : [ide], {
  env: { ...process.env, VERSION: version },
  stdio: 'inherit',
});
copyFileSync(join(editors, 'webstorm/dist/variance-authority.jar'), join(root, 'variance-authority.jar'));
