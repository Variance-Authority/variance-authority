import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { git } from './review-fixture.js';

/** The repository this package lives in, whose modules a checkout reads. */
export const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

/**
 * A checkout of `files` committed once on `main`, beside the repository's
 * modules, in a temporary directory named from `prefix`; the caller removes it.
 */
export async function committedCheckout(prefix: string, files: Readonly<Record<string, string>>): Promise<string> {
  // The temporary directory is a link on some systems, and the runner names files by their real path.
  const root = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  await symlink(join(repository, 'node_modules'), join(root, 'node_modules'), 'dir');
  const all = { '.gitignore': 'node_modules\n', ...files };
  for (const [path, text] of Object.entries(all)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  git(root, ['init', '--quiet', '--initial-branch', 'main']);
  git(root, ['config', 'user.email', 'fixture@example.test']);
  git(root, ['config', 'user.name', 'Fixture']);
  git(root, ['add', '-A']);
  git(root, ['commit', '--quiet', '-m', 'first']);
  return root;
}
