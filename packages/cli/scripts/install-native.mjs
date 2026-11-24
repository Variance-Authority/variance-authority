// The published bin exists when npm creates its links. The install lifecycle
// replaces that slot with the executable from the platform package.

import { chmodSync, copyFileSync, existsSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const executable = fileURLToPath(new URL('../dist/variance.exe', import.meta.url));
const slot = 'Variance Authority native executable.\n';

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
    throw new Error(`variance has no published native executable for ${platform} ${arch}`);
  }
  const require = createRequire(import.meta.url);
  const manifest = require.resolve(['@variance-authority', `sense-${suffix}`, 'package.json'].join('/'));
  const platformBinary = join(dirname(manifest), 'variance.exe');
  const temporary = `${executable}.${process.pid}.tmp`;
  try {
    copyFileSync(platformBinary, temporary);
    chmodSync(temporary, 0o755);
    renameSync(temporary, executable);
  } finally {
    rmSync(temporary, { force: true });
  }
}
