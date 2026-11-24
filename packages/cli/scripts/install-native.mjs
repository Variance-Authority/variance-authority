// The published bin is a Node shim that runs the JavaScript program, so a
// package manager that skips install scripts, or a platform without a native
// executable, still gets a working `variance`. The install lifecycle replaces
// the shim with the executable from the platform package when there is one.

import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const executable = fileURLToPath(new URL('../dist/variance', import.meta.url));
const slot = [
  '#!/usr/bin/env node',
  "import { fileURLToPath } from 'node:url';",
  "process.argv[1] = fileURLToPath(new URL('./bin.js', import.meta.url));",
  "await import('./bin.js');",
  '',
].join('\n');

if (process.argv[2] === '--stage') {
  writeFileSync(executable, slot, { mode: 0o755, flag: 'wx' });
} else if (existsSync(executable) && statSync(executable).size === Buffer.byteLength(slot) && readFileSync(executable, 'utf8') === slot) {
  const { platform, arch } = process;
  const suffix = {
    'darwin-arm64': 'darwin-arm64',
    'linux-arm64': 'linux-arm64-gnu',
    'linux-x64': 'linux-x64-gnu',
    'win32-x64': 'win32-x64-msvc',
  }[`${platform}-${arch}`];
  if (suffix === undefined || (platform === 'linux' && process.report.getReport().header.glibcVersionRuntime === undefined)) {
    // No native executable for this platform: the shim stays.
  } else {
    const temporary = `${executable}.${process.pid}.tmp`;
    try {
      const require = createRequire(import.meta.url);
      const manifest = require.resolve(['@variance-authority', `sense-${suffix}`, 'package.json'].join('/'));
      copyFileSync(join(dirname(manifest), 'variance.exe'), temporary);
      chmodSync(temporary, 0o755);
      renameSync(temporary, executable);
    } catch {
      // The optional package was not installed: the shim stays.
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
