/**
 * The usage half of a workspace reading, joined from the parses the scan hands
 * out rather than from a second walk.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FileRecord } from '@variance-authority/core/relate';
import { outsideRequestsOf, type Parsed } from '@variance-authority/sense';
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
  type Named,
  type Use,
} from '@variance-authority/package/help';
import { docOf } from './indexed-surface.js';

/** An import by path while its file's targets are still to come. */
type Pending = { -readonly [key in keyof Deep]: Deep[key] };

/** A file's `export … from` rows, with its requests' specifiers and, once the scan hands them over, their targets. */
interface Passing {
  readonly rows: { readonly row: Named; readonly from: string }[];
  readonly specifiers: string[];
  targets?: readonly (string | undefined)[];
}

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
  /** The usage, once `records` — the scan's, with each file's packages — say which `export … from` rows pass on a module outside the workspace. */
  read(records: readonly FileRecord[]): Usage;
} {
  const usage = gatheringUsage();
  const pending = new Map<string, Map<number, Pending>>();
  const passing = new Map<string, Passing>();

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
          const row: Named = {
            name: published.exported,
            at,
            by,
            line: published.line,
            type: published.type,
            kind,
            ...(bound === undefined ? {} : { declaration: bound.kind }),
            ...(doc === undefined ? {} : { doc }),
          };
          usage.exported.push(row);
          if (published.from !== undefined) {
            const held = passing.get(at) ?? { rows: [], specifiers: parsed.requests.map((asked) => asked.value) };
            passing.set(at, held);
            held.rows.push({ row, from: published.from });
          }
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
      const held = passing.get(at);
      if (held !== undefined) held.targets = targets;
    },
    read(records) {
      const read = usage.read();
      if (passing.size === 0) return read;
      const outside = outsideRows(root, records, passing);
      return outside.rows.size === 0 && outside.unread.length === 0
        ? read
        : { ...read, exported: read.exported.filter((row) => !outside.rows.has(row)), unreadable: [...read.unreadable, ...outside.unread] };
    },
  };
}

/**
 * The `export … from` rows that pass on a module outside the workspace, as
 * `outsideRequestsOf` decides them, the rule the native reading keeps: such a
 * row passes on a declaration the workspace does not hold, so it is an import
 * from outside, `ask uses`'s to list, and no export here. A file whose imports
 * do not read cannot say whose declaration a row out of a package passes on,
 * so it passes on none here and is named unread; a record that did not read
 * is named by its reason.
 */
function outsideRows(root: string, records: readonly FileRecord[], passing: ReadonlyMap<string, Passing>): { rows: ReadonlySet<Named>; unread: string[] } {
  const asked = records.filter((record) => passing.has(record.file));
  const decided = outsideRequestsOf(root, records.map((record) => record.file), asked.map((record) => {
    const held = passing.get(record.file)!;
    return {
      specifiers: held.specifiers,
      ...(held.targets === undefined ? {} : { resolved: held.targets.map((to) => to !== undefined) }),
      packages: (record.packages ?? []).map((edge) => edge.to),
      unknown: record.unknown !== undefined,
    };
  }));
  const rows = new Set<Named>();
  const unread: string[] = [];
  for (const [at, record] of asked.entries()) {
    const held = passing.get(record.file)!;
    const { outside, decided: read } = decided[at]!;
    if (!read && record.unknown === undefined) unread.push(record.file);
    const specifiers = new Set(outside.map((index) => held.specifiers[index]));
    for (const { row, from } of held.rows) if (specifiers.has(from)) rows.add(row);
  }
  return { rows, unread };
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
