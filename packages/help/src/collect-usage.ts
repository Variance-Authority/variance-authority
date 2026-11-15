/**
 * The usage half of a workspace reading, joined from the parses the scan hands
 * out rather than from a second walk.
 */

import { cutDoc, cutHead, type Parsed, type TextSpan } from '@variance-authority/sense';
import { NAMESPACE_NAME } from '@variance-authority/sense/read';
import {
  boundDeclaration,
  gatheringUsage,
  kindOf,
  landing,
  ownBinding,
  requested,
  type Deep,
  type ImportTargets,
  type Taken,
  type Through,
  type Usage,
  type Use,
} from '@variance-authority/package/help';

/** An import by path while its file's targets are still to come. */
type Pending = { -readonly [key in keyof Deep]: Deep[key] };

/**
 * Join cached parse facts directly, without constructing a second repository.
 *
 * An import of a file behind no published door is kept whole — the names it
 * takes and, once the scan hands the file's targets over, the file it resolved
 * to — because that import is the only record of what the other package is used
 * for. `targets` names the packages an import is followed into, and the ones
 * among them that declare no entry, whose imports are listed apart from the
 * deep ones.
 */
export function collectingUsage(opened: ReadonlySet<string>, targets: ImportTargets): {
  accept(at: string, by: string, parsed: Parsed): void;
  targets(at: string, targets: readonly (string | undefined)[]): void;
  read(): Usage;
  /** Each `export … from` accepted so far, which `Usage` does not hold: `export *` names nothing. */
  forwards(): readonly string[];
} {
  const usage = gatheringUsage();
  const forwards: string[] = [];
  const pending = new Map<string, Map<number, Pending>>();

  return {
    accept(at, by, parsed) {
      const kind = kindOf(at);

      // The parse keeps each span's text; a span it kept no text of is a file
      // the read could not cut it from, and its docs are unknown.
      let unread = parsed.unknown !== undefined;
      const unkept = (span: TextSpan | undefined): boolean => span !== undefined && span.text === undefined;
      const importedHere = new Set(parsed.requests.flatMap((request) => request.bindings.map((binding) => binding.local)));
      for (const published of parsed.exports ?? []) {
        if (published.from !== undefined) forwards.push(`${at}\0${published.exported ?? ''}\0${published.from}\0${published.imported ?? ''}`);
        if (published.exported !== undefined) {
          // The TypeScript reader spans an export's doc on the export; the
          // others span it on the declaration the export binds.
          const named = published.from === undefined
            ? (parsed.symbols ?? []).filter((symbol) => symbol.name === published.local)
            : [];
          const bound = boundDeclaration(named, published.line);
          unread ||= unkept(published.doc) || unkept(bound?.doc) || unkept(bound?.signature);
          const doc = cutDoc((published.doc ?? bound?.doc)?.text);
          const signature = cutHead(bound?.signature?.text);
          // What the export binds in its own file, by the package stage's one rule.
          const own = published.from === undefined ? ownBinding(published.local, importedHere) : undefined;
          usage.exported.push({
            name: published.exported,
            at,
            by,
            line: published.line,
            type: published.type,
            kind,
            ...(own === undefined ? {} : { bound: own }),
            ...(bound === undefined ? {} : { declaration: bound.kind }),
            ...(bound === undefined || bound.line === published.line ? {} : { boundLine: bound.line }),
            ...(doc === undefined ? {} : { doc }),
            ...(signature === undefined ? {} : { signature }),
          });
        }
      }
      if (unread) usage.unreadable.push(at);

      for (const [index, asked] of parsed.requests.entries()) {
        const key = requested(asked.value);
        const lands = landing(key, opened, targets);
        if (lands === undefined) continue;
        if (lands !== 'opened') {
          const held: Pending = { specifier: asked.value, by, at, line: asked.line, names: takenBy(asked, index, parsed, by, at, kind) };
          usage.past(lands, held);
          const file = pending.get(at) ?? new Map<number, Pending>();
          pending.set(at, file);
          file.set(index, held);
          continue;
        }

        for (const binding of asked.bindings) {
          if (binding.imported !== NAMESPACE_NAME) usage.take(key, binding.imported, { ...renamed(binding), by, at, line: binding.line, type: binding.type, kind });
        }
        for (const member of parsed.members ?? []) {
          if (member.request === index) usage.take(key, member.name, { by, at, line: member.line, type: asked.kind === 'type', kind, through: throughOf(asked, member) });
        }
      }
    },
    targets(at, targets) {
      for (const [index, held] of pending.get(at) ?? []) {
        const to = targets[index];
        if (to !== undefined) held.to = to;
      }
    },
    read: () => usage.read(),
    forwards: () => forwards,
  };
}

/** Every name one import takes: its bindings, and the members read off a module it holds whole. */
function takenBy(
  asked: Parsed['requests'][number],
  index: number,
  parsed: Parsed,
  by: string,
  at: string,
  kind: Use['kind'],
): Taken[] {
  const taken: Taken[] = [];
  for (const binding of asked.bindings) {
    if (binding.imported === NAMESPACE_NAME) continue;
    taken.push({ name: binding.imported, ...renamed(binding), by, at, line: binding.line, type: binding.type, kind });
  }
  for (const member of parsed.members ?? []) {
    if (member.request === index) taken.push({ name: member.name, by, at, line: member.line, type: asked.kind === 'type', kind, through: throughOf(asked, member) });
  }
  return taken;
}

/**
 * The request a member is read through, and how: off its `default`, or the module escaping whole as `*`.
 * Only an `import()` type holds a module through a `type` request, so it is an `import()`, and its reads are types.
 */
function throughOf(asked: Parsed['requests'][number], member: NonNullable<Parsed['members']>[number]): Through {
  return {
    kind: asked.kind === 'dynamic' || asked.kind === 'type' ? 'dynamic' : 'namespace',
    line: asked.line,
    ...(member.throughDefault === true ? { throughDefault: true } : {}),
    ...(member.name === NAMESPACE_NAME ? { whole: true } : {}),
  };
}

/** The `local` of a use of `binding`, when its statement renames it with `as`. */
function renamed(binding: Parsed['requests'][number]['bindings'][number]): { readonly local?: string } {
  return binding.local === binding.imported ? {} : { local: binding.local };
}
