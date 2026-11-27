// The module loader's half of the override: Node resolves and loads modules
// through its own bindings, below `fs`, so `override.cjs` cannot reach a
// `require` or `import` of a served or hidden path. Registered through
// `NODE_OPTIONS=--import`, these hooks run in the loading thread for both.
import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { findPackageJSON, registerHooks } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const manifestPath = process.env.VERSION_OVERRIDE;
const files = manifestPath ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

/**
 * Whether the disk holds the file, asked of `open`, which `override.cjs` leaves
 * alone: the main entry's default resolve does not check, and the CommonJS
 * loader it hands a base-only file to looks again below `fs` and misses it.
 */
const onDisk = (file) => {
  let descriptor;
  try {
    descriptor = openSync(file, 'r');
    return fstatSync(descriptor).isFile();
  } catch {
    return false;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
};

const probed = ['.js', '.cjs', '.mjs', '.json', '.ts', '.cts', '.mts'];
/**
 * The manifest's key a specifier names: itself, or, for a `require`, the file
 * CommonJS would probe for, an extension and then `index`, in Node's order
 * across the disk and the manifest: a file the disk holds first is Node's. An
 * import names its file.
 */
const servedAs = (candidate, probes) => {
  if (Object.hasOwn(files, candidate)) return candidate;
  if (!probes) return undefined;
  for (const file of [...probed.map((extension) => candidate + extension), ...probed.map((extension) => `${candidate}/index${extension}`)]) {
    if (typeof files[file] === 'string') return file;
    if (files[file] !== null && onDisk(file)) return undefined;
  }
  return undefined;
};

const pathOf = (url) => (url.startsWith('file:') ? fileURLToPath(url) : undefined);

/**
 * The format of a file only the base holds, which Node's resolver cannot see:
 * its own rule, the extension and then the nearest package's `type`.
 */
const formatOf = (file) => {
  if (extname(file) === '.json') return 'json';
  const typescript = /\.[cm]?ts$/.test(file) ? '-typescript' : '';
  const extension = extname(file);
  if (extension === '.cjs' || extension === '.cts') return `commonjs${typescript}`;
  if (extension === '.mjs' || extension === '.mts') return `module${typescript}`;
  // From its directory: Node's lookup resolves a file it is given, and this one is not on the disk.
  const manifest = findPackageJSON(pathToFileURL(`${dirname(file)}/`));
  const type = manifest && JSON.parse(readFileSync(manifest, 'utf8')).type;
  return `${type === 'module' ? 'module' : 'commonjs'}${typescript}`;
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    // The main entry arrives as a `file:` URL with no parent: `node <file>`, a test runner's child.
    const candidate = specifier.startsWith('file:')
      ? pathOf(specifier)
      : specifier.startsWith('/')
        ? specifier
        : specifier.startsWith('.') && context.parentURL
          ? pathOf(new URL(specifier, context.parentURL).href)
          : undefined;
    const file = candidate === undefined ? undefined : servedAs(candidate, context.conditions?.includes('require'));
    if (file !== undefined) {
      if (files[file] === null) {
        const error = new Error(`Cannot find module '${file}' imported from ${context.parentURL}`);
        error.code = 'ERR_MODULE_NOT_FOUND';
        throw error;
      }
      // A path the disk holds is Node's to resolve; only its content is the base's.
      if (onDisk(file)) return nextResolve(specifier, context);
      return { url: pathToFileURL(file).href, format: formatOf(file), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const file = pathOf(url);
    if (file === undefined || !Object.hasOwn(files, resolve(file)) || files[resolve(file)] === null) return nextLoad(url, context);
    return { format: context.format ?? formatOf(file), source: files[resolve(file)], shortCircuit: true };
  },
});
