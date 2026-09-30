// compass: variance-authority/runtime/attention
/**
 * What the install changed, followed into this repository's code.
 *
 * A changed package is not a changed line: no diff of the source shows it, and
 * the name in the lockfile is often one nobody here imports. So each changed
 * package is walked against the arrows of the same graph the selection walks —
 * through the lockfile's `package → package` edges to the packages the source
 * imports, and from there to the files that import them — and the reviewer is
 * shown each step: the package that changed, the one of ours that depends on
 * it, the files that import that one, and the test files that run them.
 *
 * Nothing is walked here that the graph does not already say. The chain is the
 * walk's own trail, the shortest one, which is the one `test:since` prints for
 * the tests it selects; the test files are the case index's answer to the same
 * package, asked through `narrowByJourneys`, which is how a selection over a
 * journey file hears a bump.
 */

import { affectedBy, nodeAt, trailOf, type NodeId, type Relations } from '@variance-authority/core/relate';
import { narrowByJourneys, type ExecutionIndex } from '@variance-authority/sense/test-selection';
import type { Review } from './review.js';

/** Changed packages that files here depend on, listed before the rest are counted. */
const PACKAGES = 20;
/** Importers named on one chain before the rest are counted. */
const IMPORTERS = 5;

/** One changed package, and the code in this repository that depends on it. */
export interface PackageReach {
  readonly name: string;
  /**
   * Each package a file here imports that depends on the changed one, the
   * changed one included when a file imports it directly, shortest chain
   * first. Empty when nothing here imports it or a package that depends on it.
   */
  readonly imported: readonly ImportedPackage[];
  /** How many files here depend on it, through any number of imports, the test files that run them left out. */
  readonly files: number;
  // TODO: name the version each side installed, `4.0.2 → 4.0.3`; the lockfile
  // readers keep an identity per package, not a version.
  /** Test files that import one of those files, or whose cases ran one, in code-unit order. */
  readonly tests: readonly string[];
}

export interface ImportedPackage {
  /** From the changed package to the one a file here imports: `['picomatch', 'micromatch']`. */
  readonly chain: readonly string[];
  /** The files that import the last package of the chain, in code-unit order. */
  readonly importers: readonly string[];
}

/**
 * Each changed package, followed to the files that import it and the test
 * files that run them.
 *
 * A file the walk entered from a package imports that package: the graph has
 * no other edge from a package to a file. Its trail back to the seed is the
 * chain, so a file that imports two packages on the way is named under the one
 * the shortest walk came through.
 */
export function packagesReached(
  names: readonly string[],
  relations: Relations,
  index: ExecutionIndex,
): readonly PackageReach[] {
  return names.map((name) => {
    const { files, traversal } = affectedBy(relations, [{ kind: 'package', name }]);
    const importers = new Map<NodeId, string[]>();
    for (const id of traversal.nodes) {
      const node = nodeAt(relations, id);
      const from = traversal.via[id]!;
      if (node?.kind !== 'file' || from === -1 || nodeAt(relations, from)?.kind !== 'package') continue;
      const held = importers.get(from);
      if (held === undefined) importers.set(from, [node.name]);
      else held.push(node.name);
    }
    const imported = [...importers]
      .map(([id, by]) => ({ chain: trailOf(traversal, id).map((step) => relations.names[step]!), importers: by.sort(order) }))
      .sort((left, right) => left.chain.length - right.chain.length || order(left.chain.join('\0'), right.chain.join('\0')));
    const tests = files.length === 0 ? [] : narrowByJourneys(index, new Map(), { relations, packages: [name] }).entered;
    const running = new Set(tests);
    return { name, imported, files: files.filter((file) => !running.has(file)).length, tests };
  });
}

/**
 * What the install changed, for a terminal or a comment: the packages files
 * here depend on, each with its chains, and the ones nothing here uses counted
 * on one line. A comparison that could not be made says why instead.
 */
export function installLines(review: Review, code: (value: string) => string, markdown: boolean): readonly string[] {
  const beyond = review.beyond;
  if (beyond === undefined) return [];
  if ('whole' in beyond) return ['', `📦 Installed packages could not be compared (${beyond.whole}).`];
  const lines: string[] = [];
  if (beyond.packages.length > 0) lines.push(...packageLines(beyond.packages, review.packages, code, markdown));
  if (beyond.moved.length > 0) {
    lines.push('', `Manifests whose entry points changed: ${beyond.moved.map(code).join(', ')}.`);
  }
  return lines;
}

function packageLines(
  changed: readonly string[],
  reached: readonly PackageReach[] | undefined,
  code: (value: string) => string,
  markdown: boolean,
): readonly string[] {
  const count = `${changed.length} installed package${changed.length === 1 ? '' : 's'} changed.`;
  const lead = `📦 ${markdown ? `**${count}**` : count}`;
  // A review read without the graph names the packages and nothing past them.
  if (reached === undefined) return ['', `${lead} ${listed(changed, code)}.`];
  const used = reached
    .filter((reach) => reach.imported.length > 0)
    .sort((left, right) => right.tests.length - left.tests.length || right.files - left.files || order(left.name, right.name));
  const unused = reached.filter((reach) => reach.imported.length === 0).map((reach) => reach.name);
  const lines = ['', used.length === 0
    ? lead
    : `${lead} Files here depend on ${used.length === changed.length ? (used.length === 1 ? 'it' : 'all of them') : `${used.length} of them`}. Each chain starts at the changed package and ends at the files that import it:`];
  if (used.length > 0) lines.push('');
  const [bullet, nested] = markdown ? ['- ', '  - '] : ['  ', '    '];
  for (const reach of used.slice(0, PACKAGES)) {
    lines.push(`${bullet}${code(reach.name)}: ${dependents(reach)}.`);
    for (const { chain, importers } of reach.imported) {
      const more = importers.length > IMPORTERS ? ` and ${importers.length - IMPORTERS} more` : '';
      const end = `${importers.slice(0, IMPORTERS).map(code).join(', ')}${more}`;
      lines.push(`${nested}${[...chain.map(code), end].join(' → ')}`);
    }
  }
  if (used.length > PACKAGES) lines.push(`${bullet}${used.length - PACKAGES} more, not listed here; \`--format json\` lists every one.`);
  if (unused.length > 0) {
    lines.push('', `No file here imports ${listed(unused, code)}, or a package that depends on ${unused.length === 1 ? 'it' : 'one of them'}.`);
  }
  return lines;
}

/** How many files depend on a package, and how many test files run them. */
function dependents(reach: PackageReach): string {
  const tests = reach.tests.length;
  const testFiles = `${tests} test file${tests === 1 ? '' : 's'}`;
  // Only test files import it: there is nothing else for them to run.
  if (reach.files === 0) return `${testFiles} depend${tests === 1 ? 's' : ''} on it, and nothing else here does`;
  const them = reach.files === 1 ? 'it' : 'them';
  const files = `${reach.files} file${reach.files === 1 ? ' depends' : 's depend'} on it`;
  return tests === 0 ? `${files}, and no test file runs ${them}` : `${files}, and ${testFiles} run${tests === 1 ? 's' : ''} ${them}`;
}

/** Names, with the ones past the listing limit counted. */
function listed(names: readonly string[], code: (value: string) => string): string {
  const shown = names.slice(0, PACKAGES).map(code).join(', ');
  return names.length > PACKAGES ? `${shown} and ${names.length - PACKAGES} more` : shown;
}

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
