/**
 * The declaration an export binds.
 *
 * `export { taxOf as levy }` binds `levy` to `taxOf`, and
 * `export { taxOf as levy } from './tax.js'` exports `levy` and declares
 * nothing, so the line that exports a name is not the answer to what it is.
 * The source index records which name each export binds and each
 * `export … from` passes on as which, and which file the request resolved to;
 * it walks back through every such file to the declaration.
 */

// compass: variance-authority.report.agent-surface

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Help, Named } from '@variance-authority/package/help';
import { aliasesOf, declarationExported, importersOf, type ExportedDeclaration } from '@variance-authority/sense';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { textRows } from './declared.js';
import { sharedSegments } from './shared-segments.js';

/**
 * The declaration `held` binds: its file's own, or the one it passes on
 * through every file that passes it on. None when the walk ends short of a
 * declaration, when no checkout is named, and when the index is not published
 * or does not read, which the imports of the same answer already say.
 */
export function boundOf(root: string | undefined, held: Pick<Named, 'at' | 'name'>): ExportedDeclaration | undefined {
  if (root === undefined) return undefined;
  try {
    return declarationExported(root, held.at, held.name) ?? undefined;
  } catch {
    return undefined;
  }
}

/** The declaration `held` passes on from another file, as `boundOf` reaches it; none when its own file declares it. */
export function originOf(root: string | undefined, held: Pick<Named, 'at' | 'name'>): ExportedDeclaration | undefined {
  return elsewhere(boundOf(root, held), held);
}

/**
 * Which declaration `held` exports: the file that declares it and the name
 * that file exports it under, the key the package stage gives every entry it
 * publishes. An export that declares passes its own; one that passes another
 * file's on takes the export of the declaring file that binds the same
 * declaration, so `export { salute } from './greet.js'` over
 * `export { greet as salute }` is `salute` there, not the local `greet`.
 */
export function declarationOf(help: Help, root: string | undefined, held: Named): { readonly at: string; readonly declared: string } {
  const origin = held.declaration !== undefined ? undefined : originOf(root, held);
  if (origin === undefined) return { at: held.at, declared: spellingsOf(help, root, held.at, held.name).named };
  const own = help.exported.find(
    (other) => other.at === origin.at && other.declaration !== undefined && boundOf(root, other)?.name === origin.name,
  );
  return { at: origin.at, declared: spellingsOf(help, root, origin.at, own?.name ?? origin.name).named };
}

/**
 * The names `at` exports one binding under, and the one its declaration is
 * keyed by. `default` is a slot every module has, not a name, so it is the
 * key only when nothing names the binding: the binding's own name when the
 * file exports it under that, else its first other name in code-unit order,
 * else the name its declaration binds, `export default function Button`, and
 * for an anonymous default the name of the import nearest its file.
 * `export default greet` beside `export { greet }` is one declaration,
 * `greet`, imported under either name.
 */
export function spellingsOf(help: Help, root: string | undefined, at: string, declared: string): { readonly named: string; readonly spellings: readonly string[] } {
  const bound = boundOf(root, { at, name: declared });
  if (bound === undefined) return { named: declared === 'default' ? (nearestImportName(root, at) ?? declared) : declared, spellings: [declared] };
  if (bound.at !== at) return { named: declared, spellings: [declared] };
  const same = (other: ExportedDeclaration | undefined): boolean => other !== undefined && other.at === bound.at && other.name === bound.name && other.line === bound.line;
  const others = help.exported.filter((other) => other.at === at && other.name !== declared && same(boundOf(root, other))).map((other) => other.name);
  const spellings = [...new Set([declared, ...others])].sort(codeUnitOrder);
  const named = spellings.includes(bound.name) ? bound.name : (spellings.find((one) => one !== 'default') ?? bound.name);
  return { named, spellings };
}

/**
 * The name an anonymous default export of `at` is known by: the local name of
 * the import nearest its file, the one sharing the most leading path segments
 * with it, then the first by file in code-unit order and by line. None when no
 * import binds it to a name or the source index does not read.
 */
export function nearestImportName(root: string | undefined, at: string): string | undefined {
  if (root === undefined) return undefined;
  let read: ReturnType<typeof importersOf>;
  try {
    read = importersOf(root, [at], 'default');
  } catch {
    return undefined;
  }
  const named = (read?.uses ?? []).filter((use) => typeof use.local === 'string' && use.local !== '');
  const [nearest] = named.sort((left, right) => sharedSegments(at, right.at) - sharedSegments(at, left.at) || codeUnitOrder(left.at, right.at) || left.line - right.line);
  return nearest?.local ?? undefined;
}

/**
 * Every default export `spellingsOf` keys by `name`: one whose declaration
 * binds `name`, and an anonymous one an import nearest its file binds to it.
 * An anonymous default is looked for only in the files an import of `default`
 * as `name` resolved to, so a question reads the index once per candidate.
 */
export function defaultsNamed(help: Help, root: string | undefined, name: string): readonly Named[] {
  if (root === undefined || name === 'default') return [];
  let imported: ReadonlySet<string>;
  try {
    imported = new Set((aliasesOf(root, name) ?? []).flatMap((alias) => (alias.imported === 'default' && alias.to != null ? [alias.to] : [])));
  } catch {
    return [];
  }
  return help.exported.filter((held) => {
    if (held.name !== 'default' || held.kind !== 'source') return false;
    const bound = held.declaration === undefined ? undefined : boundOf(root, held);
    if (bound === undefined) return imported.has(held.at) && nearestImportName(root, held.at) === name;
    return bound.at === held.at && bound.name === name && spellingsOf(help, root, held.at, held.name).named === name;
  });
}

/** `bound`, when it is in another file than `held`. */
const elsewhere = (bound: ExportedDeclaration | undefined, held: Pick<Named, 'at'>): ExportedDeclaration | undefined =>
  bound === undefined || bound.at === held.at ? undefined : bound;

/** `passes on `taxOf`, declared at <file>:<line>`, for a sentence to carry. */
export function passesOn(origin: ExportedDeclaration): string {
  return `passes on \`${origin.name}\`, declared at ${origin.at}:${origin.line}`;
}

/**
 * The rows that open the answer for `name`, which `held` exports and no entry
 * publishes: the name and its kind, where it is exported, and what the source
 * index says it is — its kind, signature and documentation, read off the
 * declaration the export binds, as `boundOf` reaches it. When that is in
 * another file, `It passes on …:` says which. The line itself, as the checkout
 * holds it, when the walk reaches no declaration; neither when no checkout is
 * named. `declared` is where the declaration is, `held` when it passes none
 * on.
 */
export function exportedRows(root: string | undefined, name: string, held: Named): { readonly declared: Named; readonly rows: readonly string[] } {
  const bound = boundOf(root, held);
  const origin = elsewhere(bound, held);
  const declared: Named = origin === undefined ? held : { ...held, at: origin.at, name: origin.name, line: origin.line };
  const text = root === undefined ? [] : bound === undefined ? lineOf(root, declared) : textRows(root, bound);
  return {
    declared,
    rows: [
      bound === undefined ? name : `${name} [${bound.kind}]`,
      `exported, without being published, at ${held.at}:${held.line} by ${held.by}${held.type ? ' (type only)' : ''}`,
      ...(origin === undefined ? [] : [`It ${passesOn(origin)}:`]),
      ...text,
    ],
  };
}

/**
 * The line an export is written on, as the checkout holds it now; nothing when
 * the file is gone or the line no longer holds the name, since the index read
 * an older text.
 */
export function lineOf(root: string, held: Pick<Named, 'at' | 'line' | 'name'>): readonly string[] {
  let text: string;
  try {
    text = readFileSync(join(root, held.at), 'utf8');
  } catch {
    return [];
  }
  const line = text.split(/\r?\n/)[held.line - 1]?.trim();
  return line === undefined || !line.includes(held.name) ? [] : [line];
}
