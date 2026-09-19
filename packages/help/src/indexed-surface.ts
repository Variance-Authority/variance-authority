import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import type { Parsed, SourceSymbol, TextSpan } from '@variance-authority/sense';
import {
  requested,
  type Declaration,
  type DeclarationKind,
  type Names,
  type Offering,
} from '@variance-authority/package/help';

export interface IndexedSource {
  readonly parsed: Parsed;
  readonly targets: readonly (string | undefined)[];
}

const DEFAULT = 'default';
const NAMESPACE = '*';

function add(into: Names, name: string, declaration: Declaration): void {
  const held = into.get(name);
  if (held === undefined) into.set(name, new Map([[declaration.kind, declaration]]));
  else if (!held.has(declaration.kind)) held.set(declaration.kind, declaration);
}

function headOf(text: string, span: TextSpan | undefined): string | undefined {
  if (span === undefined) return undefined;
  const head = text.slice(span.start, span.end).trimEnd().replace(/;$/, '');
  return head === '' ? undefined : head;
}

function docOf(text: string, span: TextSpan | undefined): string | undefined {
  if (span === undefined) return undefined;
  const doc = text
    .slice(span.start, span.end)
    .split('\n')
    .map((line) => line.replace(/^[ \t]*\*[ \t]?/, ''))
    .join('\n')
    .trim();
  return doc === '' ? undefined : doc;
}

function declaration(
  at: string,
  line: number,
  kind: DeclarationKind,
  text: string,
  signature?: TextSpan,
  doc?: TextSpan,
): Declaration {
  const head = headOf(text, signature);
  const prose = docOf(text, doc);
  return {
    kind,
    at,
    line,
    ...(head === undefined ? {} : { signature: head }),
    ...(prose === undefined ? {} : { doc: prose }),
  };
}

function localDeclarations(at: string, source: IndexedSource, text: string): Map<string, Declaration> {
  const local = new Map<string, Declaration>();
  for (const symbol of source.parsed.symbols ?? []) {
    if (!local.has(symbol.name)) local.set(symbol.name, declarationOfSymbol(at, symbol, text));
  }
  return local;
}

function declarationOfSymbol(at: string, symbol: SourceSymbol, text: string): Declaration {
  return declaration(at, symbol.line, symbol.kind, text, symbol.signature, symbol.doc);
}

/** Build the old published-name reading from facts Sense already harvested. */
export async function indexedNames(
  root: string,
  offerings: readonly Offering[],
  sources: Map<string, IndexedSource>,
  enrich: (files: readonly string[]) => Promise<ReadonlyMap<string, Parsed>>,
): Promise<(source: string) => Names> {
  const entrypoints = new Map<string, string>();
  for (const offering of offerings) {
    for (const entry of offering.entrypoints) {
      entrypoints.set(`${offering.name} ${entry.subpath}`, pathOf(root, entry.source));
    }
  }

  const targetOf = (at: string, specifier: string): string | undefined => {
    if (!specifier.startsWith('.')) return entrypoints.get(requested(specifier));
    const source = sources.get(at);
    const index = source?.parsed.requests.findIndex((request) => request.value === specifier) ?? -1;
    return index < 0 ? undefined : source?.targets[index];
  };

  const wanted = new Set<string>();
  const expanded = new Set<string>();
  const texts = new Map<string, string>();
  const visit = (file: string): void => {
    if (expanded.has(file)) return;
    expanded.add(file);
    wanted.add(file);
    const source = sources.get(file);
    for (const published of source?.parsed.exports ?? []) {
      if (published.from === undefined) continue;
      const target = targetOf(file, published.from);
      if (target !== undefined && sources.has(target)) visit(target);
    }
  };
  for (const source of entrypoints.values()) wanted.add(source);
  for (;;) {
    expanded.clear();
    for (const source of wanted) visit(source);
    const missing = [...wanted].filter((file) => sources.get(file)?.parsed.harvested !== true);
    let changed = false;
    if (missing.length > 0) {
      for (const [file, parsed] of await enrich(missing)) {
        const held = sources.get(file);
        if (held !== undefined) {
          sources.set(file, { parsed, targets: held.targets });
          changed = true;
        }
      }
    }

    const unread = [...wanted].filter((file) => !texts.has(file));
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, unread.length) }, async () => {
      for (;;) {
        const file = unread[next++];
        if (file === undefined) return;
        texts.set(file, await readFile(join(root, file), 'utf8'));
      }
    }));

    for (const file of wanted) {
      const source = sources.get(file);
      const text = texts.get(file);
      if (source === undefined || text === undefined) continue;
      const local = localDeclarations(file, source, text);
      for (const published of source.parsed.exports ?? []) {
        if (published.from !== undefined || published.exported === undefined) continue;
        const written = published.exported === DEFAULT
          ? defaultIdentifier(text, published.signature, local)
          : undefined;
        const localName = written ?? published.local ?? published.exported;
        for (const [index, request] of source.parsed.requests.entries()) {
          if (!request.bindings.some((binding) => binding.local === localName)) continue;
          const target = source.targets[index];
          if (target !== undefined && sources.has(target) && !wanted.has(target)) {
            wanted.add(target);
            changed = true;
          }
        }
      }
    }
    if (!changed) break;
  }

  const reached = new Map<string, Names>();
  const namesAt = (file: string, stack: Set<string> = new Set()): Names => {
    const held = reached.get(file);
    if (held !== undefined) return held;
    const found: Names = new Map();
    if (stack.has(file)) return found;
    stack.add(file);

    const source = sources.get(file);
    const text = texts.get(file);
    if (source === undefined || text === undefined) {
      stack.delete(file);
      reached.set(file, found);
      return found;
    }
    const local = localDeclarations(file, source, text);

    for (const published of source.parsed.exports ?? []) {
      const specifier = published.from;
      const resolved = specifier === undefined ? undefined : targetOf(file, specifier);
      const target = resolved !== undefined && sources.has(resolved) ? resolved : undefined;
      const written = declaration(
        file,
        published.line,
        published.imported === NAMESPACE ? 'namespace-object' : 'foreign',
        text,
        published.signature,
        published.doc,
      );

      if (published.exported === undefined) {
        if (target === undefined) add(found, `* from '${specifier}'`, written);
        else for (const [name, kinds] of namesAt(target, stack)) {
          for (const value of kinds.values()) add(found, name, value);
        }
        continue;
      }

      const name = published.exported;
      if (published.imported === NAMESPACE) {
        add(found, name, written);
      } else if (specifier === undefined) {
        const writtenName = name === DEFAULT ? defaultIdentifier(text, published.signature, local) : undefined;
        const value = local.get(published.local ?? name)
          ?? (name === DEFAULT ? local.get(DEFAULT) : undefined)
          ?? (writtenName === undefined ? undefined : local.get(writtenName));
        if (value !== undefined) {
          add(found, name, value);
          continue;
        }
        const localName = writtenName ?? published.local ?? name;
        const imported = source.parsed.requests.flatMap((request, index) =>
          request.bindings
            .filter((binding) => binding.local === localName)
            .map((binding) => ({ name: binding.imported, target: source.targets[index] })),
        )[0];
        if (imported?.target === undefined) {
          if (imported !== undefined) add(found, name, written);
          else throw new Error(`${file} exports \`${name}\`, and no declaration there says what it is`);
          continue;
        }
        if (imported.name === NAMESPACE) {
          add(found, name, { ...written, kind: 'namespace-object' });
          continue;
        }
        if (!sources.has(imported.target)) {
          add(found, name, written);
          continue;
        }
        const kinds = namesAt(imported.target, stack).get(imported.name);
        if (kinds === undefined) {
          throw new Error(`${file} exports imported \`${name}\`, and its source does not publish it`);
        }
        for (const declared of kinds.values()) add(found, name, declared);
      } else if (target === undefined) {
        add(found, name, written);
      } else {
        const linked = source.parsed.requests
          .find((request) => request.value === specifier && request.kind === 'imports')
          ?.bindings.find((binding) => binding.local === published.imported)?.imported;
        const targetNames = namesAt(target, stack);
        const kinds = targetNames.get(linked ?? published.imported ?? DEFAULT);
        if (kinds === undefined) {
          throw new Error(`${file} re-exports \`${name}\` from \`${specifier}\`, which does not publish it`);
        }
        for (const value of kinds.values()) add(found, name, value);
      }
    }

    stack.delete(file);
    reached.set(file, found);
    return found;
  };

  return (source) => namesAt(pathOf(root, source));
}

function defaultIdentifier(
  text: string,
  span: TextSpan | undefined,
  local: ReadonlyMap<string, Declaration>,
): string | undefined {
  const written = headOf(text, span);
  if (written === undefined) return undefined;
  const identifiers = written.match(/[\p{ID_Start}_$][\p{ID_Continue}_$]*/gu) ?? [];
  const reversed = identifiers.reverse();
  return reversed.find((name) => local.has(name))
    ?? [...reversed].reverse().find((name) => !['export', 'default', 'as', 'typeof'].includes(name));
}

function pathOf(root: string, file: string): string {
  return isAbsolute(file) ? relative(root, realpathSync(file)) : file;
}
