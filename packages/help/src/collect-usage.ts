/**
 * The usage half of a workspace reading, joined from the parses the scan hands
 * out rather than from a second walk.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Parsed } from '@variance-authority/sense';
import { NAMESPACE_NAME } from '@variance-authority/sense/read';
import {
  gatheringUsage,
  kindOf,
  landing,
  requested,
  type Deep,
  type ImportTargets,
  type Taken,
  type Through,
  type Usage,
  type Use,
} from '@variance-authority/package/help';
import { docOf } from './indexed-surface.js';

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
export function collectingUsage(root: string, opened: ReadonlySet<string>, targets: ImportTargets): {
  accept(at: string, by: string, parsed: Parsed): void;
  targets(at: string, targets: readonly (string | undefined)[]): void;
  read(): Usage;
} {
  const usage = gatheringUsage();
  const pending = new Map<string, Map<number, Pending>>();

  return {
    accept(at, by, parsed) {
      if (parsed.unknown !== undefined) usage.unreadable.push(at);
      const kind = kindOf(at);

      // The parse holds where a doc is, not what it says, so the file is read
      // once for the prose, and only when one of its exports has any.
      let text: string | undefined;
      for (const published of parsed.exports ?? []) {
        if (published.exported !== undefined) {
          // The TypeScript reader spans an export's doc on the export; the
          // others span it on the declaration the export binds, by its name.
          // One name may be declared twice, `const Kind` and `type Kind`: an
          // export takes the declaration on its own line, else the first.
          const named = published.from === undefined
            ? (parsed.symbols ?? []).filter((symbol) => symbol.name === published.local)
            : [];
          const bound = named.find((symbol) => symbol.line === published.line) ?? named[0];
          const span = published.doc ?? bound?.doc;
          if (span !== undefined) text ??= readFileSync(join(root, at), 'utf8');
          const doc = text === undefined ? undefined : docOf(text, span);
          usage.exported.push({
            name: published.exported,
            at,
            by,
            line: published.line,
            type: published.type,
            kind,
            ...(bound === undefined ? {} : { declaration: bound.kind }),
            ...(doc === undefined ? {} : { doc }),
          });
        }
      }

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
