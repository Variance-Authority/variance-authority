// compass: variance-authority.reach
/**
 * The module loader's half of a `variance janus` run: Node resolves and loads
 * modules through its own bindings, below `fs`, so `serve-fs.cts` cannot reach
 * a `require` or `import` of a served or hidden path. Preloaded through
 * `NODE_OPTIONS=--import`, these hooks run in the loading thread for both.
 */

import { closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { findPackageJSON, registerHooks, type ModuleFormat } from 'node:module';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import served from './served.cjs';

const { files, read } = served;

/**
 * Whether the disk holds the file, asked of `open`, which `serve-fs.cts` leaves
 * alone: the main entry's default resolve does not check, and the CommonJS
 * loader it hands a base-only file to looks again below `fs` and misses it.
 */
const onDisk = (file: string): boolean => {
  let descriptor: number | undefined;
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
const servedAs = (candidate: string, probes: boolean): string | undefined => {
  if (Object.hasOwn(files, candidate)) return candidate;
  if (!probes) return undefined;
  for (const file of [...probed.map((extension) => candidate + extension), ...probed.map((extension) => `${candidate}/index${extension}`)]) {
    if (typeof files[file] === 'string') return file;
    if (files[file] !== null && onDisk(file)) return undefined;
  }
  return undefined;
};

const pathOf = (url: string): string | undefined => (url.startsWith('file:') ? fileURLToPath(url) : undefined);

/**
 * The format of a file only the base holds, which Node's resolver cannot see:
 * its own rule, the extension and then the nearest package's `type`.
 */
const formatOf = (file: string): ModuleFormat => {
  const extension = extname(file);
  if (extension === '.json') return 'json';
  const typescript = /\.[cm]?ts$/.test(file);
  if (extension === '.cjs' || extension === '.cts') return typescript ? 'commonjs-typescript' : 'commonjs';
  if (extension === '.mjs' || extension === '.mts') return typescript ? 'module-typescript' : 'module';
  // From its directory: Node's lookup resolves a file it is given, and this one is not on the disk.
  // With no manifest above it, the lookup answers the directory it was given.
  const manifest = findPackageJSON(pathToFileURL(`${dirname(file)}/`));
  const module = manifest !== undefined && manifest.endsWith('package.json') && (JSON.parse(readFileSync(manifest, 'utf8')) as { type?: string }).type === 'module';
  if (module) return typescript ? 'module-typescript' : 'module';
  return typescript ? 'commonjs-typescript' : 'commonjs';
};

registerHooks({
  resolve(specifier, context, nextResolve) {
    // The main entry arrives as a `file:` URL with no parent: `node <file>`, a test runner's child.
    const candidate = specifier.startsWith('file:')
      ? pathOf(specifier)
      : specifier.startsWith('/')
        ? specifier
        : specifier.startsWith('.') && context.parentURL !== undefined
          ? pathOf(new URL(specifier, context.parentURL).href)
          : undefined;
    const file = candidate === undefined ? undefined : servedAs(candidate, context.conditions.includes('require'));
    if (file === undefined) return nextResolve(specifier, context);
    if (files[file] === null) {
      throw Object.assign(new Error(`Cannot find module '${file}' imported from ${context.parentURL}`), { code: 'ERR_MODULE_NOT_FOUND' });
    }
    // A path the disk holds is Node's to resolve; only its content is the base's.
    if (onDisk(file)) return nextResolve(specifier, context);
    return { url: pathToFileURL(file).href, format: formatOf(file), shortCircuit: true };
  },
  load(url, context, nextLoad) {
    const file = pathOf(url);
    const source = file === undefined ? undefined : files[resolve(file)];
    if (file === undefined || typeof source !== 'string') return nextLoad(url, context);
    read(resolve(file));
    // A file the disk holds keeps the format Node gives it; only its content is the base's.
    const format = context.format ?? (onDisk(file) ? nextLoad(url, context).format : formatOf(file));
    return { format, source, shortCircuit: true };
  },
});
