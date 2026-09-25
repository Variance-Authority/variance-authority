/**
 * A journey file read for one change, with the reading done by the addon.
 *
 * Two questions, and neither expands the file. `selectJourneyFile` answers the
 * one `variance select` asks — which test files — entirely in the addon, graph
 * walk included. `projectJourneyFile` answers the one a reader of regions asks,
 * by handing back the part of the file the change can see.
 *
 * `decodeExecutionIndex` expands every crossing into an object, which is the
 * right shape for a small index and an impossible one for a stitched day of
 * shards: 280 million crossings in a 33 MiB file exhaust any heap a CLI runs in.
 * A question about a change needs a handful of modules, so the addon opens the
 * file, expands the sets of the regions the change lands on, and hands back an
 * `ExecutionIndex` holding the tests and the changed modules only. Every reader
 * of a change — `coveringChange`, `narrowByJourneys` — answers it exactly as it
 * answers the whole file, because nothing it looks at was left out
 * (`native/src/journey_query.rs` says what is kept).
 */

import { open } from 'node:fs/promises';
import { EDGE_KINDS, RUNTIME_EDGES, type Relations } from '@variance-authority/core/relate';
import { native, type NativeJourneyChange, type NativeJourneyGraph } from '../native.js';
import type { LineRange } from './diff-lines.js';
import type { JourneySelectionOptions } from './execution-select.js';
import { SET_EXECUTION_FORMAT } from './execution-set-format.js';
import type { ExecutionIndex } from './reverse.js';
import type { ExecutionNarrowing } from './select.js';

/**
 * `narrowByJourneys` over the journey file at `file`, answered by the addon.
 *
 * The addon reads the file, charges each changed line to its region, walks the
 * graph for whatever the record cannot answer, and returns the test files; the
 * rules are `narrowByJourneys`'s, and that function is the reading when this
 * one returns `undefined` — no addon with the entry, or a file in another
 * spelling.
 */
export async function selectJourneyFile(
  file: string,
  changed: ReadonlyMap<string, readonly LineRange[]>,
  options: JourneySelectionOptions = {},
): Promise<ExecutionNarrowing | undefined> {
  const select = native()?.selectJourneys;
  if (select === undefined || (await headerVersion(file)) !== SET_EXECUTION_FORMAT) return undefined;
  const graph = options.relations === undefined ? undefined : flatten(options.relations);
  const selected = select(file, nativeChange(changed, options.read), graph, [...(options.packages ?? [])]);
  return {
    whole: [...selected.whole].sort(codeUnitOrder),
    entered: [...selected.entered].sort(codeUnitOrder),
    unread: [...selected.unread].sort(codeUnitOrder),
    stale: [],
    because: [],
  };
}

function flatten(relations: Relations): NativeJourneyGraph {
  return {
    names: relations.names,
    kinds: relations.kinds,
    dependsOffset: relations.depends.offset,
    dependsTarget: relations.depends.target,
    dependsKind: relations.depends.kind,
    dependentsOffset: relations.dependents.offset,
    dependentsTarget: relations.dependents.target,
    dependentsKind: relations.dependents.kind,
    through: RUNTIME_EDGES.map((kind) => EDGE_KINDS.indexOf(kind)),
    shadows: [...relations.shadows].map(([file, shadows]) => ({ file, shadows })),
  };
}

function nativeChange(
  changed: ReadonlyMap<string, readonly LineRange[]>,
  read?: JourneySelectionOptions['read'],
): NativeJourneyChange[] {
  return [...changed].map(([path, ranges]) => ({
    file: path,
    ranges: ranges.flatMap((range) => [range.start, range.end]),
    ...(read?.has(path) === true ? { read: read.get(path)! } : {}),
  }));
}

/**
 * The journey file at `file`, cut down to what `changed` can ask about.
 *
 * `undefined` when the file is not the journey spelling the addon reads, or no
 * addon with the entry loaded: the caller decodes the whole file instead, which
 * is the same answer at the cost the addon exists to avoid.
 */
export async function projectJourneyFile(
  file: string,
  changed: ReadonlyMap<string, readonly LineRange[]>,
): Promise<JourneyProjection | undefined> {
  const project = native()?.projectJourneys;
  if (project === undefined || (await headerVersion(file)) !== SET_EXECUTION_FORMAT) return undefined;
  const projected = project(file, nativeChange(changed));
  const index: ExecutionIndex = {
    tests: projected.tests.map((test) => ({
      id: test.id,
      file: test.file,
      name: test.name,
      ...(test.stopped == null ? {} : { stopped: test.stopped }),
    })),
    modules: projected.modules.map((module) => ({
      file: module.file,
      blocks: module.blocks.map((block) => ({
        kind: block.kind,
        name: block.name,
        path: block.path,
        startLine: block.startLine,
        endLine: block.endLine,
        source: block.source,
        ...(block.loaded ? { loaded: true as const } : {}),
        crossings: block.tests.map((test) => ({ test, distance: 0 })),
      })),
    })),
  };
  return { index, files: [...projected.files].sort(codeUnitOrder) };
}

export interface JourneyProjection {
  readonly index: ExecutionIndex;
  /** Every file the journey holds a row for, which `index.modules` no longer is. */
  readonly files: readonly string[];
}

function codeUnitOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** The layout version a column file declares, read off its header alone. */
async function headerVersion(file: string): Promise<number | undefined> {
  const handle = await open(file, 'r');
  try {
    const length = Buffer.alloc(4);
    if ((await handle.read(length, 0, 4, 0)).bytesRead < 4 || length[0] === 0x7b) return undefined;
    const size = length.readUInt32LE(0);
    if (size === 0 || size > 1 << 20) return undefined;
    const header = Buffer.alloc(size);
    await handle.read(header, 0, size, 4);
    const parsed = JSON.parse(header.toString('utf8').replace(/\0+$/u, '')) as { version?: unknown };
    return typeof parsed.version === 'number' ? parsed.version : undefined;
  } catch {
    return undefined;
  } finally {
    await handle.close();
  }
}
