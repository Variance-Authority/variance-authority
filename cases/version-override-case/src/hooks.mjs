// The module loader's half of the override: Node resolves and loads modules
// through its own bindings, below `fs`, so `override.cjs` cannot reach a
// `require` or `import` of a served or hidden path. Registered through
// `NODE_OPTIONS=--import`, these hooks run in the loading thread for both.
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const manifestPath = process.env.VERSION_OVERRIDE;
const files = manifestPath ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};

const pathOf = (url) => (url.startsWith('file:') ? fileURLToPath(url) : undefined);

/** The `type` of the package that holds `file`, read from the disk. */
const packageType = (file) => {
  for (let dir = dirname(file); ; dir = dirname(dir)) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest)) return JSON.parse(readFileSync(manifest, 'utf8')).type === 'module' ? 'module' : 'commonjs';
    if (dirname(dir) === dir) return 'commonjs';
  }
};
const formatOf = (file) => {
  const extension = extname(file);
  if (extension === '.cjs' || extension === '.cts') return 'commonjs';
  if (extension === '.mjs' || extension === '.mts') return 'module';
  return packageType(file);
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
    if (candidate !== undefined && Object.hasOwn(files, candidate)) {
      if (files[candidate] === null) {
        const error = new Error(`Cannot find module '${candidate}' imported from ${context.parentURL}`);
        error.code = 'ERR_MODULE_NOT_FOUND';
        throw error;
      }
      return { url: pathToFileURL(candidate).href, format: formatOf(candidate), shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
  load(url, context, nextLoad) {
    const file = pathOf(url);
    if (file === undefined || !Object.hasOwn(files, resolve(file)) || files[resolve(file)] === null) return nextLoad(url, context);
    return { format: context.format ?? formatOf(file), source: files[resolve(file)], shortCircuit: true };
  },
});
