/**
 * What the repository imports and exports, read from the index the scan keeps.
 *
 * [`use.ts`](../../package/src/use.ts) can answer this by itself: walk every
 * directory, parse every module, collect every specifier. On this repository
 * that is 1336 files and about half a second, and the half second is paid again
 * on the next question about the same unchanged checkout. A repository ten times
 * the size — which is an ordinary repository — pays ten times that, every time,
 * to re-learn a tree where almost nothing moved.
 *
 * Nothing about the reading justifies the cost, because the reading is already
 * done. [`sense`](../../sense) keeps a durable, content-keyed index of exactly
 * these bytes: git names each file's content without opening it, the digest
 * names what parsing that content produced, and a scan of an unchanged tree
 * costs a map lookup per file. What was missing was not a cache but a door —
 * `ScanOptions.parsed` hands each file's parse out as the scan settles it, so a
 * second reading of the same bytes joins the first instead of repeating it.
 *
 * ## Two readings, one index
 *
 * The scan's own question is which files reach which files. This question is
 * which *names* one package takes from another and which names each file hands
 * out, and the specifiers it needs are the same specifiers the scan resolved.
 * Sharing the index means the answer gets faster every time anything else in the
 * toolchain scans — and it means a repository that has never run a selection
 * still pays the full walk exactly once.
 *
 * Both halves of a file's parse are read, not just the requests. The exports are
 * what makes a name findable when no manifest publishes it, which is most of the
 * code in any checkout, and they cost nothing extra: the same cached parse that
 * already said what the file imports also says what it exports.
 */

import { resolve } from 'node:path';
import type { FileRecord } from '@variance-authority/mcp/tools';
import { openSourceIndex, scanRelations, sourceIndexPath, type Parsed } from '@variance-authority/sense';
import { NAMESPACE_NAME } from '@variance-authority/sense/read';
import {
  ownership,
  readHelp,
  readOfferings,
  usageFrom,
  type Bound,
  type Exported,
  type Help,
  type HelpOptions,
  type Recorded,
  type Usage,
} from '@variance-authority/package/help';

export interface ReadingOptions extends HelpOptions, IndexedUsageOptions {}

export interface IndexedUsageOptions {
  /** Where the index is kept. The checkout's own cache layer when absent. */
  readonly index?: string;
  /** Whether to publish what this scan learned. On, because the next question is the point. */
  readonly save?: boolean;
  /**
   * Handed the arrows the scan drew, for a caller that needs the graph as well
   * as the names.
   *
   * The scan walks the whole checkout and returns the import graph whichever
   * question asked for it; this reading wanted only the half that says which
   * names each file takes and hands out, and threw the other half away. A
   * caller that has to answer *which files does this path reach* would then
   * scan the repository a second time to learn something the first scan had
   * already worked out and dropped on the floor.
   *
   * So it is a door rather than a return value, for the same reason
   * `ScanOptions.parsed` is one: the reading that wants it is not the reading
   * this function performs, and a caller that does not want it should not be
   * handed a graph it has to ignore.
   */
  readonly records?: (records: readonly FileRecord[]) => void;
}

/**
 * One file's parse, as the usage join wants it.
 *
 * A namespace import binds no single name — `import * as fs` takes whatever is
 * there — so it contributes no entry, and the package still counts as used
 * because the request itself is recorded either way. `sense` writes that case as
 * a binding under a name no source can spell; this is where that convention
 * stops being carried.
 *
 * `unknown` is carried and the requests are kept, because in `sense` it marks a
 * reading that is incomplete rather than one that failed: the usual one is an
 * `import()` whose specifier is not a literal, in a file whose other fifteen
 * imports parsed exactly. Dropping those fifteen would turn "one edge is
 * missing" into "this file imports nothing", which is the louder of the two
 * wrong answers.
 */
function recordedOf(at: string, by: string, parsed: Parsed): Recorded {
  return {
    at,
    by,
    ...(parsed.unknown === undefined ? {} : { unknown: parsed.unknown }),
    // `exported` absent is `export * from './x'`: the set is whatever the other
    // file publishes, so this file names nothing and one invented here would be
    // a name it never wrote.
    publishes: (parsed.exports ?? []).flatMap((published): Exported[] =>
      published.exported === undefined
        ? []
        : [{ name: published.exported, line: published.line, type: published.type }],
    ),
    requests: parsed.requests.map((asked) => ({
      specifier: asked.value,
      line: asked.line,
      names: asked.bindings
        .filter((binding) => binding.imported !== NAMESPACE_NAME)
        .map((binding): Bound => ({ imported: binding.imported, type: binding.type, line: binding.line })),
    })),
  };
}

/**
 * Read what a repository imports from what it publishes, out of the source index.
 *
 * `opened` is every `<package> <subpath>` the manifests answer, exactly as
 * [`readUsage`](../../package/src/use.ts) takes it: the package half says which
 * specifiers are worth following, and the whole key says which of them came
 * through a published door.
 */
export async function readIndexedUsage(
  root: string,
  opened: ReadonlySet<string>,
  options: IndexedUsageOptions = {},
): Promise<Usage> {
  const where = resolve(root);
  const index = await openSourceIndex(options.index ?? sourceIndexPath(where));
  const owner = ownership(where);
  const files: Recorded[] = [];

  const records = await scanRelations({
    // The whole checkout, not the workspace members. A repository holds source
    // that no `workspaces` entry claims — `tools/`, a scripts directory, a
    // config that imports from a package — and that source imports these
    // packages like anything else does. The scan declines to descend into a
    // checkout that is not this one, so the root means this repository.
    root: where,
    dirs: ['.'],
    cache: index.cache,
    reuse: index.reuse,
    parsed: (file, parsed) => {
      files.push(recordedOf(file, owner(file), parsed));
    },
  });

  if (options.save !== false) await index.save();
  options.records?.(records);

  return usageFrom(opened, files);
}

/**
 * A workspace, read with the index doing the expensive third of the work.
 *
 * The same value [`readHelp`](../../package/src/help.ts) returns and the same
 * reading behind it — the manifests say which doors exist, the source behind
 * them says what is on the other side, and the repository says what it reaches
 * for. Only the third one changes: it comes from the source index rather than
 * from a walk, so asking a second question about an unchanged checkout costs the
 * manifests and nothing else.
 *
 * Asynchronous because the index is a file. That is the whole of the difference
 * at the call site, and it is why the synchronous door is still there: a caller
 * with no cache directory to write to, or one reading a tree it does not own,
 * wants `readHelp` and should keep having it.
 */
export async function readWorkspace(root: string, options: ReadingOptions = {}): Promise<Help> {
  const where = resolve(root);
  const opened = new Set(
    readOfferings(where, options).flatMap((offering) =>
      offering.entrypoints.map((entry) => `${offering.name} ${entry.subpath}`),
    ),
  );

  const usage = await readIndexedUsage(where, opened, options);

  return readHelp(where, { ...options, usage });
}
