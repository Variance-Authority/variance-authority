import { realpathSync } from 'node:fs';
import { parse, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { packageName, packageOf } from './package-home.js';

/**
 * What to say when the program could not load one of its modules because the
 * build that writes it stopped part way.
 *
 * The program runs from each package's `dist/`. A build interrupted half way
 * leaves an entry that imports an output it never wrote, and Node then refuses
 * the import with `ERR_MODULE_NOT_FOUND` and the missing file's URL. That is not
 * a defect in the tool and not a finding about the project: it is an operator
 * condition with a remedy, so it names the package and the file. A package in
 * the workspace is rebuilt; one installed under `node_modules` is reinstalled.
 *
 * `undefined` for every other error, including a missing module no package holds
 * and a package that is not installed at all, whose error carries no URL.
 */
export function unbuiltOf(error: unknown): string | undefined {
  // FIXME: an output the build left empty or cut short raises a `SyntaxError` that carries no file name outside its stack text, so it still reads as a defect in the tool.
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ERR_MODULE_NOT_FOUND') return undefined;
  const url = 'url' in error ? error.url : undefined;
  if (typeof url !== 'string' || !url.startsWith('file:')) return undefined;
  const missing = fileURLToPath(url);
  const root = parse(missing).root;
  const home = packageOf(root, missing);
  if (home === undefined) return undefined;
  const name = packageName(root, home);
  const file = relative(home, missing).split(sep).join('/');
  const remedy = installed(home) ? 'Reinstall' : 'Rebuild';
  return (
    `variance could not load: \`${name}\` is only partly built, and its \`${file}\` does not exist. ` +
    `${remedy} \`${name}\`, then run the command again.`
  );
}

/** Whether the package at `home` is an installed copy rather than a workspace link, which resolves out of `node_modules`. */
function installed(home: string): boolean {
  try {
    return realpathSync(home).split(sep).includes('node_modules');
  } catch {
    return false;
  }
}
