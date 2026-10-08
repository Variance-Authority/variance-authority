/**
 * What reads the tree: the component index, and the file graph over it.
 *
 * Kept out of [`resources.ts`](./resources.ts) by that file's own rule. The
 * things it resolves may not change a verdict — a store swapped for another
 * decides the same thing, a decoder is held to byte-identical RGBA, a cache in
 * the wrong place costs a re-render. These two can and do: without the graph the
 * selector falls back to declarations, and what a run *observes* changes. So the
 * environment is allowed a say over there and none at all here: both are read
 * by `sense`, a dependency imported like any other.
 */

import { readdirSync, type Dirent } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { SourceIndex } from '@variance-authority/core/attribute';
import { relationsOfFiles, type Relations, type Uses } from '@variance-authority/core/relate';
import {
  mockTaint,
  publishedSources,
  SourceIndexUnpublished,
  sourcesWithin,
  taintFile,
  taintRecords,
} from '@variance-authority/sense';
import { isCI } from 'ci-info';
import { OperatorError } from '../exit.js';
import { indexOf } from './affected.js';
import { installedDepends } from './installed.js';

/**
 * The component index, from the directories the config names.
 *
 * The same walk the shipped collectors do, for the same reason: the module reader
 * in `sense` decides how a file becomes an index ([`indexOf`](./affected.ts)),
 * and this decides which files. Selection needs it *before* anything is
 * collected, so it cannot borrow the collector's.
 */
export async function scanSourceDirs(
  root: string,
  dirs: readonly string[],
): Promise<SourceIndex> {
  const contents = new Map<string, string>();
  for (const file of sourceFiles(root, dirs)) contents.set(relative(root, file), await readFile(file, 'utf8'));
  return indexOf(contents);
}

/**
 * The files `scanSourceDirs` reads, as absolute paths: whatever is on disk
 * under `dirs`, git-ignored or not, so a build identity can digest exactly the
 * bytes the scan saw.
 */
export function sourceFiles(root: string, dirs: readonly string[]): readonly string[] {
  return dirs.flatMap((dir) => walkSource(isAbsolute(dir) ? dir : join(root, dir)));
}

/**
 * The file graph, from the same directories the component index walks.
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
  noGit = false,
): Promise<Relations> {
  const read = await publishedWithin(root, dirs, before, noGit);

  // The mocks are read unasked. A graph that believes `vi.mock('./api')`
  // imports `./api` selects that test for every change behind the mock, and
  // an operator who has to know to switch the reader on is one who finds out
  // from the suite that ran. The scan recorded what each file mocks in its
  // parse, so the mock taint opens nothing; a table named in the config is
  // answered here too, and what it adds is never saved.
  const tables = await Promise.all(taints.map((file) => taintFile(join(root, file))));
  const tainted = await taintRecords(read.records, [mockTaint(), ...tables], {
    root,
    cache: read.cache,
  });

  // Read from the lockfile at this revision, never from `package.json`: a range
  // is a request and the lockfile is the answer to it. Empty when there is no
  // install to read, which loses the transitive half of a package bump and
  // never the direct half — and the diff that would have needed it refuses on
  // the same unreadable file rather than narrowing.
  const depends = await installedDepends(root);

  // A taint's addition joins the edge the parse recorded, and the names the
  // parse bound on it no longer say everything the file reaches through it.
  const uses: Uses = (importer, target) =>
    tainted.additions.get(importer)?.includes(target) ? undefined : read.uses(importer, target);

  return relationsOfFiles(tainted.records, { shadows: tainted.shadows, depends, uses });
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
  root: string,
  dirs: readonly string[],
  before: readonly string[],
  noGit: boolean,
) {
  let published;
  try {
    published = await publishedSources(root, {
      ci: isCI,
      step: noGit ? 'variance index --no-git' : 'variance index',
      announce: (line) => process.stderr.write(`variance: ${line}\n`),
      ...(noGit ? { packs: false } : {}),
    });
  } catch (error) {
    // A pipeline without the step is the operator's to fix, and the refusal
    // already names the step; printed as a defect, it would send them to file
    // a bug instead.
    if (error instanceof SourceIndexUnpublished) throw new OperatorError(error.message, { cause: error });
    throw error;
  }
  return {
    records: sourcesWithin(published.records, root, dirs, before),
    cache: published.cache,
    uses: published.uses,
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
