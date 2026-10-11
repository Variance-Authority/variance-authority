import type { Parsed } from '@variance-authority/sense';

/**
 * What each file declares and what it imports, by name, read off the parse the
 * scan already made.
 *
 * The tree holds files and the arrows between them; a question that names a
 * name — *who declares `selectBalance`*, *who imports `createContext` from
 * `react`* — needs the names on both ends of an arrow. Those are in the parse
 * the scan made to draw the arrow, so they are taken from there, during the
 * same scan, rather than parsed a second time.
 */

/** A name this file declares itself. */
export interface DeclaredName {
  readonly name: string;
  readonly line: number;
}

/**
 * One name this file imports, or one module it imports for its effect.
 *
 * `name` is the name the module publishes, never the local alias: a question
 * about `useContext` finds `import { useContext as read }`. A module imported
 * whole and read through its namespace contributes each member it is read
 * through, with `through` naming the namespace. A module that binds nothing a
 * reader could name — a side effect, a stylesheet — is still imported, and has
 * no `name`.
 */
export interface ImportedName {
  /** The specifier as written. */
  readonly from: string;
  /** The file it resolved to, repo-relative, when it resolved. */
  readonly to?: string;
  readonly name?: string;
  /** The local name, when it differs from `name`. */
  readonly local?: string;
  readonly line: number;
  /** The namespace the member was read through. */
  readonly through?: string;
}

/** One file's names: what it declares itself, and what it imports. */
export interface FileNames {
  readonly declared: readonly DeclaredName[];
  readonly imported: readonly ImportedName[];
}

/** Every scanned file's names, keyed as the tree keys its files. */
export type SourceNames = ReadonlyMap<string, FileNames>;

/** `import * as x`: the module is taken whole, and its names arrive as members. */
const NAMESPACE = '*';

/**
 * The names one parse holds.
 *
 * A declaration is the file's own: its symbols, and the names it exports
 * without a `from`. `export { x } from './y'` forwards a name `./y` declares,
 * so it is the import below, not a declaration here — counting it would answer
 * *where is `x` declared* with every barrel it passes through. So does
 * `export default x` when `x` is imported: the default is `./y`'s declaration.
 */
export function namesOf(parsed: Parsed, targets: readonly (string | undefined)[]): FileNames {
  const declared: DeclaredName[] = [];
  const seen = new Set<string>();
  const declare = (name: string, line: number): void => {
    if (seen.has(name)) return;
    seen.add(name);
    declared.push({ name, line });
  };
  const bound = new Set(parsed.requests.flatMap((request) => request.bindings.map((binding) => binding.local)));
  for (const symbol of parsed.symbols ?? []) declare(symbol.name, symbol.line);
  for (const exported of parsed.exports ?? []) {
    if (exported.exported === undefined || exported.from !== undefined) continue;
    if (exported.local !== undefined && bound.has(exported.local)) continue;
    declare(exported.exported, exported.line);
  }

  const imported: ImportedName[] = [];
  const membersOf = new Map<number, { readonly name: string; readonly line: number }[]>();
  for (const member of parsed.members ?? []) {
    const list = membersOf.get(member.request) ?? [];
    list.push(member);
    membersOf.set(member.request, list);
  }

  parsed.requests.forEach((request, index) => {
    const to = targets[index];
    const at = { from: request.value, ...(to === undefined ? {} : { to }) };
    let named = false;
    for (const binding of request.bindings) {
      if (binding.imported === NAMESPACE) continue;
      named = true;
      imported.push({
        ...at,
        name: binding.imported,
        ...(binding.local === binding.imported ? {} : { local: binding.local }),
        line: binding.line,
      });
    }
    const through = request.bindings.find((binding) => binding.imported === NAMESPACE)?.local;
    for (const member of membersOf.get(index) ?? []) {
      named = true;
      imported.push({ ...at, name: member.name, line: member.line, ...(through === undefined ? {} : { through }) });
    }
    if (!named) imported.push({ ...at, line: request.line });
  });

  return { declared, imported };
}
