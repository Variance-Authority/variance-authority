/**
 * A specifier as the pair a manifest can answer.
 *
 * `@variance-authority/core/plan` is a package and a subpath, and only the
 * package half has a manifest to ask. Written as one string because that is what
 * a lookup key wants and because the space cannot occur in either half.
 */
export function requested(specifier: string): string {
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
  return `${name} .${specifier.slice(name.length)}`;
}

/**
 * Each subpath an `exports` field opens, with the condition written for it.
 *
 * Node reads three shapes as the one subpath `"."`: a string, an array of
 * fallbacks, and an object none of whose keys starts with `.` — a conditions
 * map, the shape `{ "import": "./index.js", "types": "./index.d.ts" }` and
 * TanStack's `{ "@tanstack/custom-condition": "./src/index.ts", … }` are
 * written in. Only an object whose keys all start with `.` maps subpaths. Node
 * refuses an object that mixes the two, and so does this, naming the manifest:
 * reading either half alone would publish a specifier the package does not.
 */
export function subpathsOf(manifest: string, exports: unknown): readonly (readonly [string, unknown])[] {
  if (exports === undefined || exports === null) return [];
  if (typeof exports !== 'object' || Array.isArray(exports)) return [['.', exports]];
  const keys = Object.keys(exports);
  const conditions = keys.filter((key) => !key.startsWith('.'));
  if (conditions.length === keys.length) return keys.length === 0 ? [] : [['.', exports]];
  if (conditions.length > 0) {
    const named = conditions.map((key) => `\`${key}\``).join(', ');
    throw new Error(`${manifest} mixes subpaths with the conditions ${named} in \`exports\`, which Node refuses to load`);
  }
  return Object.entries(exports);
}
