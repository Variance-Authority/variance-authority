import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What to say when the program could not load one of its own modules because the
 * build that writes it stopped part way.
 *
 * The program runs from each package's `dist/`. A build interrupted half way
 * leaves an entry that imports an output it never wrote, and Node then refuses
 * the import with `ERR_MODULE_NOT_FOUND` and the missing file's URL. That is not
 * a defect in the tool and not a finding about the project: it is an operator
 * condition with a remedy, so it names the package and the file, and says which
 * package to rebuild.
 *
 * `undefined` for every other error, including a missing module no package holds
 * and a package that is not installed at all, whose error carries no URL.
 */
export function unbuiltOf(error: unknown): string | undefined {
  // FIXME: an output the build left empty or cut short raises a `SyntaxError` that names no file in a field, so it still reads as a defect in the tool.
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ERR_MODULE_NOT_FOUND') return undefined;
  const url = 'url' in error ? error.url : undefined;
  if (typeof url !== 'string' || !url.startsWith('file:')) return undefined;
  const missing = fileURLToPath(url);
  const owner = packageHolding(missing);
  if (owner === undefined) return undefined;
  const file = relative(owner.root, missing).split(sep).join('/');
  return (
    `variance could not load: \`${owner.name}\` is only partly built, and its \`${file}\` does not exist. ` +
    `Rebuild \`${owner.name}\`, then run the command again.`
  );
}

/** The nearest directory above `file` whose `package.json` names a package. */
function packageHolding(file: string): { name: string; root: string } | undefined {
  for (let at = dirname(file); ; at = dirname(at)) {
    const manifest = join(at, 'package.json');
    if (existsSync(manifest)) {
      const name = nameIn(manifest);
      if (name !== undefined) return { name, root: at };
    }
    if (dirname(at) === at) return undefined;
  }
}

function nameIn(manifest: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
    if (typeof parsed === 'object' && parsed !== null && 'name' in parsed && typeof parsed.name === 'string') return parsed.name;
  } catch {
    // A manifest that does not parse names no package; the walk goes on above it.
  }
  return undefined;
}
