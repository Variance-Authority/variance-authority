import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Every workspace package, as its own manifest declares it.
 *
 * The workspace globs come from the root `package.json` rather than from a list
 * here, so a package published from somewhere other than `packages/` is followed
 * without this file being edited. `private: true` is the only filter: a case
 * fixture and an example are workspace members and are not offerings.
 */

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * What a manifest says that an adopter's build can observe.
 *
 * `version` is left out because it moves every release and would drown the
 * signal. `dependencies` is left out because `tools/boundaries.check.ts` already
 * governs who may depend on whom, and one rule per question. Everything here is
 * recorded present-or-absent, so a package that *starts* declaring `engines` or
 * `sideEffects` is a change rather than a silence.
 */
export const OFFERED = [
  'type',
  'main',
  'types',
  'exports',
  'files',
  'bin',
  'peerDependencies',
  'peerDependenciesMeta',
  'engines',
  'sideEffects',
];

function read(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/** Directories the root `workspaces` globs name. Only a trailing `/*` is used here. */
function members() {
  const { workspaces } = read(join(ROOT, 'package.json'));
  const globs = Array.isArray(workspaces) ? workspaces : (workspaces?.packages ?? []);
  const found = [];

  for (const glob of globs) {
    if (!glob.endsWith('/*')) throw new Error(`workspace glob \`${glob}\` is not \`dir/*\`, which is all this reads`);
    const parent = join(ROOT, glob.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const name of readdirSync(parent).sort()) {
      const manifest = join(parent, name, 'package.json');
      if (existsSync(manifest)) found.push(manifest);
    }
  }

  return found;
}

/**
 * The source file an entrypoint's `types` target was built from.
 *
 * The manifest points at `dist`, which is derived and needs a build to exist.
 * Every package here declares its own `rootDir` and `outDir`, so the way back is
 * arithmetic the package itself owns rather than a convention assumed here — and
 * a package that stopped following it fails loudly below instead of quietly
 * resolving to nothing.
 */
function sourceOf(dir, types) {
  const { compilerOptions } = read(join(dir, 'tsconfig.json'));
  const out = posix.normalize(`${compilerOptions.outDir}/`);
  const root = posix.normalize(`${compilerOptions.rootDir}/`);
  const target = posix.normalize(types);

  if (!target.startsWith(out)) {
    throw new Error(`\`${types}\` is not under this package's outDir \`${compilerOptions.outDir}\``);
  }

  const source = join(dir, root, target.slice(out.length).replace(/\.d\.ts$/, '.ts'));
  if (!existsSync(source)) throw new Error(`\`${types}\` maps to \`${source}\`, which is not there`);

  return source;
}

/** One published package: what it declares, and where each typed subpath begins. */
export function offerings() {
  const found = [];

  for (const path of members()) {
    const manifest = read(path);
    if (manifest.private === true || typeof manifest.name !== 'string') continue;

    const dir = dirname(path);
    const declared = {};
    for (const key of OFFERED) {
      if (manifest[key] !== undefined) declared[key] = manifest[key];
    }

    const entries = [];
    for (const [subpath, condition] of Object.entries(manifest.exports ?? {})) {
      // A subpath can be a bare string with no `types` — `jsx-source` publishes
      // `./jest-resolver` that way. It is still a subpath somebody imports, so it
      // stays in `declared.exports`; it just has no names to read.
      const types = typeof condition === 'object' && condition !== null ? condition.types : undefined;
      if (typeof types !== 'string') continue;
      entries.push({ subpath, source: sourceOf(dir, types) });
    }

    found.push({ name: manifest.name, dir, declared, entries });
  }

  return found;
}
