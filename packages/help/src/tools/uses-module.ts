import { statSync } from 'node:fs';
import * as resolver from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { Tool } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';

/** What `docs_uses` is asked when its `name` is a module, as {@link Tool.restated} says it. */
type Restated = ReturnType<NonNullable<Tool<Help>['restated']>>;

/**
 * `uses --name <module>` as the question it is: who imports the module, which
 * `discover --imports` answers. A name is a module when the checkout holds a
 * file at it, or when the checkout resolves it to a package; a package
 * specifier can be a name as well, `react` or `zod`, so it is asked as both.
 * A path, written as the module grammar writes one with `./`, `../` or `/`,
 * that no file is at is said to be no path rather than answered by nobody
 * importing it.
 */
export function restatedUses(input: Readonly<Record<string, unknown>>, root: string, discover: string): Restated {
  const name = input['name'];
  if (typeof name !== 'string' || name === '') return undefined;
  const limit = input['limit'] === undefined ? {} : { limit: input['limit'] };
  const file = fileAt(root, name);
  if (file !== undefined) {
    return { tool: discover, input: { imports: [file], ...limit }, said: `\`${name}\` is a module, not a name: these are the files importing it, as \`discover\` answers \`imports\`.`, also: false };
  }
  if (name.startsWith('./') || name.startsWith('../') || isAbsolute(name)) {
    throw new Error(`\`${name}\` is a path, and no file of the checkout is at it. \`uses\` takes a name, or a module: a file of the checkout or a package it resolves.`);
  }
  if (!resolvesToPackage(root, name)) return undefined;
  return { tool: discover, input: { imports: [name], ...limit }, said: `\`${name}\` is a package: these are the files importing it, as \`discover\` answers \`imports\`.`, also: true };
}

/** The checkout's file at `name`, relative to the root with forward slashes, or nothing when no file is there. */
function fileAt(root: string, name: string): string | undefined {
  const at = relative(root, resolve(root, name));
  if (at === '' || at.startsWith('..') || isAbsolute(at)) return undefined;
  return statSync(join(root, at), { throwIfNoEntry: false })?.isFile() === true ? at.split(sep).join('/') : undefined;
}

/**
 * Whether Node's resolver, asked from the root, finds a package for the
 * specifier. A Node without `findPackageJSON` (before 22.14) finds none, so the
 * name is answered as a name.
 */
function resolvesToPackage(root: string, specifier: string): boolean {
  if (typeof resolver.findPackageJSON !== 'function') return false;
  try {
    return resolver.findPackageJSON(specifier, pathToFileURL(join(root, 'package.json')))?.endsWith('package.json') === true;
  } catch {
    // The resolver throws for a specifier it finds no package for.
    return false;
  }
}
