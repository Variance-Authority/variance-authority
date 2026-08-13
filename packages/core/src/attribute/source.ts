/**
 * Connecting a change to a file.
 *
 * A report that says `Button` is one step short of useful. An agent asked to fix
 * it still has to find `Button`, and a reviewer still has to guess whether the
 * `Button` in question is the design-system one or the local one in checkout.
 * The last hop — **which file** — is what turns a finding into an edit.
 *
 * There are two mechanisms, and this file is the second one.
 *
 * The first is exact. Spec §6.1 assumes the build tells us: every JSX transform
 * already computes each element's file, line and column, and
 * `@variance-authority/jsx-source` is the `jsxImportSource` setting that keeps
 * that location as far as the fiber — React 19 drops it otherwise, on every path.
 * When it is on, a finding names the element's own line and this index is not
 * consulted.
 *
 * The second is this one, and it is what a repository that has changed nothing
 * gets. Attribution names *components*, so a **component → file** index answers
 * the question attribution asks. It is built by reading source rather than by
 * configuring a build, and it answers with where a component is *declared* —
 * coarser than a call site, and enough to open the right file.
 *
 * The index is plain data. `core` performs no I/O (ADR-0006), so building one is
 * a caller's job; resolving against one is here.
 */

export interface SourceRef {
  /** Repository-relative, so a report is portable between machines and CI. */
  readonly file: string;
  readonly line: number;
  /** How the declaration was recognised. Carried so a bad match is debuggable. */
  readonly via: 'function' | 'const' | 'class' | 'declared';
}

/**
 * Component name → where it is declared.
 *
 * A name may map to several files. That is not an error to be resolved by
 * picking one: two components genuinely can share a name, and silently choosing
 * the first would send an agent to edit the wrong file with full confidence.
 * Ambiguity is reported (ADR-0003's rule for overlapping projections, applied to
 * source).
 */
export type SourceIndex = Readonly<Record<string, readonly SourceRef[]>>;

export interface Resolution {
  readonly name: string;
  readonly refs: readonly SourceRef[];
  /** `true` when more than one file declares this name. */
  readonly ambiguous: boolean;
}

export function resolveSource(name: string, index: SourceIndex): Resolution | null {
  const refs = index[name];
  if (refs === undefined || refs.length === 0) return null;

  return { name, refs, ambiguous: refs.length > 1 };
}

/**
 * `file:line`, or a disambiguating list when a name is declared more than once.
 *
 * Formatted as `path:line` because that is the form an editor, a terminal, and
 * every agent harness already know how to open.
 */
export function formatSource(resolution: Resolution): string {
  const [first] = resolution.refs;
  if (first === undefined) return resolution.name;

  const primary = `${first.file}:${first.line}`;
  if (!resolution.ambiguous) return primary;

  const others = resolution.refs.slice(1).map((ref) => `${ref.file}:${ref.line}`);
  return `${primary} (ambiguous — also ${others.join(', ')})`;
}

/**
 * Extract component declarations from one file's source.
 *
 * A regex scan, and the limits are worth stating rather than discovering. It
 * finds exported and local declarations in the three shapes React components are
 * written in, and it will miss a component produced by a factory, assigned
 * dynamically, or re-exported under another name. It can also match a function
 * that merely looks like a component — capitalised, declared at top level — and
 * name a non-component in a report.
 *
 * Both failures are survivable in a way a wrong file path would not be: a miss
 * degrades the report to the component name, which is what it said before, and a
 * false positive can only appear if attribution already named that identifier.
 * Parsing properly is the right answer eventually; it is not worth a parser
 * dependency to find out whether the link is useful.
 */
export function indexSource(file: string, contents: string): SourceIndex {
  const found: Record<string, SourceRef[]> = {};
  const lines = contents.split('\n');

  const patterns: readonly { readonly re: RegExp; readonly via: SourceRef['via'] }[] = [
    { re: /^\s*(?:export\s+)?(?:default\s+)?function\s+([A-Z][A-Za-z0-9_]*)/, via: 'function' },
    { re: /^\s*(?:export\s+)?(?:const|let)\s+([A-Z][A-Za-z0-9_]*)\s*[:=]/, via: 'const' },
    { re: /^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Z][A-Za-z0-9_]*)/, via: 'class' },
  ];

  for (const [index, line] of lines.entries()) {
    for (const { re, via } of patterns) {
      const match = re.exec(line);
      if (!match) continue;

      const name = match[1]!;
      (found[name] ??= []).push({ file, line: index + 1, via });
      break;
    }
  }

  return found;
}

/** Merge per-file indexes. A name declared in several files keeps every ref. */
export function mergeSourceIndexes(indexes: readonly SourceIndex[]): SourceIndex {
  const merged: Record<string, SourceRef[]> = {};

  for (const index of indexes) {
    for (const [name, refs] of Object.entries(index)) {
      (merged[name] ??= []).push(...refs);
    }
  }

  return merged;
}
