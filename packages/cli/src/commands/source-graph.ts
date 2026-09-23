/**
 * What reads the tree: the component index, and the file graph over it.
 *
 * Kept out of [`resources.ts`](./resources.ts) by that file's own rule. The
 * things it resolves may not change a verdict — a store swapped for another
 * decides the same thing, a decoder is held to byte-identical RGBA, a cache in
 * the wrong place costs a re-render. These two can and do: without the graph the
 * selector falls back to declarations, and what a run *observes* changes. So the
 * environment is allowed a say over there and none at all here, and a missing
 * package is stated rather than absorbed.
 */

import { readdirSync, type Dirent } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { SourceIndex } from '@variance-authority/core/attribute';
import { relationsOfFiles, type Relations } from '@variance-authority/core/relate';
import { isCI } from 'ci-info';
import { OperatorError } from '../exit.js';
import { indexOf } from './affected.js';
import { installedDepends } from './installed.js';
import { messageOf } from './resources.js';

/**
 * The component index, from the directories the config names.
 *
 * The same walk both shipped collectors do, for the same reason and with the same
 * rule owner: `indexSource` in `core` decides how a file becomes an index, and
 * this decides which files. Selection needs it *before* anything is collected, so
 * it cannot borrow the collector's.
 */
export async function scanSourceDirs(
  root: string,
  dirs: readonly string[],
): Promise<SourceIndex> {
  const contents = new Map<string, string>();

  for (const dir of dirs) {
    for (const file of walkSource(isAbsolute(dir) ? dir : join(root, dir))) {
      contents.set(relative(root, file), await readFile(file, 'utf8'));
    }
  }

  return indexOf(contents);
}

/** Why a caller wants the file graph, and what they can do when there is none. */
export interface GraphAsk {
  /** The clause before "and the scanner could not be loaded". */
  readonly why: string;
  /** What to do about it, as a whole sentence. */
  readonly fix: string;
}

const BY_CONFIG: GraphAsk = {
  why: 'config sets `source.relations`',
  fix: 'Install `@variance-authority/sense`, or remove the key to select by declaration alone.',
};

/**
 * The file graph, from the same directories the component index walks.
 *
 * A dynamic import, and the one thing in this file that may not degrade quietly.
 * The other resolutions here are held to *cost, not correctness* — a slower
 * decoder decides the same thing. This one decides **what is observed**: without
 * the graph the selector falls back to declarations, and a changed file that
 * declares nothing widens the run. So a missing package is stated rather than
 * absorbed, because the alternative is a suite that quietly got slower and an
 * operator who configured a narrowing that never happened.
 *
 * `undefined` only when the operator asked for no graph at all — that is a
 * choice, and the selector already knows how to work without one.
 *
 * {@link GraphAsk} is who wanted the graph and what they can do about not
 * having it, and it is a parameter because the two differ: a run reached here
 * through a config key an operator can take back out, and `reach` reached here
 * through the command they typed, which has no key to remove. Advice to edit a
 * file they do not have is the kind of message that costs an afternoon.
 *
 * The graph is read, never built here. One step publishes the checkout's
 * source index — `variance index` — and every reader reads that generation, so a
 * run that selects pays for the diff once, not once per reader. Where the index
 * is missing, CI refuses and names the step the pipeline lacks, and a
 * workstation builds it once and says so on stderr. CI is the runner's own
 * answer, read through `ci-info`, the package Jest asks.
 * `--no-git` changes where that local build reads each file's bytes — the
 * working tree rather than Git's object store — and nothing about what is read:
 * Git still names every file and its blob, so the index is the same one.
 *
 * The install is joined here too, and it is the same graph rather than a second
 * one. A file that imports `@mui/material` has an edge to a node named
 * `@mui/material`, the lockfile says which packages that one rests on, and a
 * transitive bump — `jsdom`, three levels under something a test imports —
 * reaches our code by the same backwards walk an edited file does
 * ([`installed.ts`](./installed.ts)).
 */
export async function relationsFor(
  root: string,
  dirs: readonly string[],
  taints: readonly string[] = [],
  before: readonly string[] = [],
  asked: GraphAsk = BY_CONFIG,
  noGit = false,
): Promise<Relations> {
  let scanner;
  try {
    scanner = await import('@variance-authority/sense');
  } catch (error) {
    throw new OperatorError(
      `${asked.why} and the scanner could not be loaded: ${messageOf(error)}. ${asked.fix}`,
      { cause: error },
    );
  }

  const read = await publishedWithin(scanner, root, dirs, before, noGit);

  // The mocks are read unasked. A graph that believes `vi.mock('./api')`
  // imports `./api` selects that test for every change behind the mock, and
  // an operator who has to know to switch the reader on is one who finds out
  // from the suite that ran. The update published the mock reader's answers;
  // a table named in the config is answered here, from the same parses, and
  // what it adds is never saved.
  const tables = await Promise.all(taints.map((file) => scanner.taintFile(join(root, file))));
  const tainted = await scanner.taintRecords(read.records, [scanner.mockTaint(), ...tables], {
    root,
    cache: read.cache,
  });

  // Read from the lockfile at this revision, never from `package.json`: a range
  // is a request and the lockfile is the answer to it. Empty when there is no
  // install to read, which loses the transitive half of a package bump and
  // never the direct half — and the diff that would have needed it refuses on
  // the same unreadable file rather than narrowing.
  const depends = await installedDepends(root);

  return relationsOfFiles(tainted.records, { shadows: tainted.shadows, depends });
}

/**
 * The published records this caller's scope reaches.
 *
 * The index holds the whole checkout; the scope is the part a scan seeded from
 * `dirs` would have reached. The harness is seeded as exact paths: it lives
 * outside every directory anybody would point a component scan at, and what it
 * loads is the part of a run nothing imports and every test rests on.
 */
async function publishedWithin(
  scanner: typeof import('@variance-authority/sense'),
  root: string,
  dirs: readonly string[],
  before: readonly string[],
  noGit: boolean,
) {
  let published;
  try {
    published = await scanner.publishedSources(root, {
      ci: isCI,
      step: noGit ? 'variance index --no-git' : 'variance index',
      announce: (line) => process.stderr.write(`variance: ${line}\n`),
      ...(noGit ? { packs: false } : {}),
    });
  } catch (error) {
    // A pipeline without the step is the operator's to fix, and the refusal
    // already names the step; printed as a defect, it would send them to file
    // a bug instead.
    if (error instanceof scanner.SourceIndexUnpublished) throw new OperatorError(error.message, { cause: error });
    throw error;
  }
  return {
    records: scanner.sourcesWithin(published.records, root, dirs, before),
    cache: published.cache,
  };
}

const SOURCE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js'];
const SOURCE_EXCLUDE = ['node_modules', '.test.', '.spec.', '.stories.', 'dist/'];

function walkSource(dir: string): readonly string[] {
  const found: string[] = [];

  let entries: readonly Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A configured directory that does not exist contributes nothing rather than
    // failing the run: the refusal that matters is an empty *index*, and the
    // selector states that itself.
    return found;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (SOURCE_EXCLUDE.some((skip) => path.includes(skip))) continue;
    if (entry.isDirectory()) found.push(...walkSource(path));
    else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }

  return found;
}
