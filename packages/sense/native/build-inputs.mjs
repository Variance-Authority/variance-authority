/** Git owns both compiled inputs: the crate tree and the external record layout. */
import { spawnSync } from 'node:child_process';

export const NATIVE = 'packages/sense/native';
export const NATIVE_EXTRA_INPUTS = ['packages/sense/record-layout.json'];

/** Committed build identity and whether the working tree still matches it. */
export function nativeBuildInputs(root, ref = 'HEAD') {
  const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  const read = git(['rev-parse', `${ref}:${NATIVE}`, ...NATIVE_EXTRA_INPUTS.map((file) => `${ref}:${file}`)]);
  const dirty = git(['status', '--porcelain', '--', NATIVE, ...NATIVE_EXTRA_INPUTS]);
  if (read.status !== 0 || dirty.status !== 0) return undefined;
  const tree = read.stdout.trim().split('\n')[0];
  return { tree, identity: read.stdout.trim().split('\n').join(':'), clean: dirty.stdout === '' };
}
