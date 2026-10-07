import {
  environmentKey,
  profileById,
  type SemanticSnapshot,
  type SemanticNode,
} from '@variance-authority/core/format';
import type { Collected, Collector, Plan, PlannedSubject } from './collector.js';
import { VIEWPORT, documentFor } from './run-fixture.js';

/**
 * A plan, a collector over it and the snapshots it answers with, for the
 * evidence commands — which read what a run reads and compare nothing.
 */

/** What one rendered node says: who made it, what it reads, where it was written. */
export interface Node {
  readonly owner: string;
  readonly text?: string;
  readonly file?: string;
}

export function snapshotOf(id: string, nodes: readonly Node[]): SemanticSnapshot {
  const children = nodes.map(
    (node, i): SemanticNode => ({
      path: `0.${String(i)}`,
      tag: 'div',
      attributes: {},
      style: {},
      ...(node.text === undefined ? {} : { text: node.text }),
      provenance: {
        owners: [{ name: node.owner, propsDigest: `v1:${node.owner}` }],
        ...(node.file === undefined ? {} : { source: { file: node.file, line: 12, column: 3 } }),
      },
      children: [],
    }),
  );
  return {
    formatVersion: 1,
    subject: { id, kind: 'story' },
    profile: profileById('chromium'),
    environment: environmentKey({
      profile: 'chromium',
      engine: 'chromium@131',
      ruleset: 'test',
      allowlist: 'test',
      viewport: VIEWPORT,
      fonts: [],
      conditions: {},
      assets: {},
    }),
    renderHash: 'v1:r',
    structureHash: 'v1:s',
    styleHash: 'v1:y',
    root: { path: '0', tag: 'main', attributes: {}, style: {}, children },
    styleProvenance: [],
    diagnostics: [],
  };
}

/** Subjects declared by files, in plan order: `[id, file]`. */
export function planOf(subjects: readonly (readonly [string, string?])[]): Plan {
  return {
    subjects: subjects.map(
      ([id, file]): PlannedSubject => ({ subject: { id, kind: 'story' }, ...(file === undefined ? {} : { declaredIn: file }) }),
    ),
    notObserved: [],
    warnings: [],
  };
}

export interface Opened {
  readonly collector: Collector;
  /** Worlds opened, and of those, closed. */
  readonly worlds: { opened: number; closed: number };
  /** Subjects in the order a world was asked for them. */
  readonly asked: string[];
}

/**
 * A collector whose answers come from `answer`, that opens a world per worker
 * and counts what it closes. `delay` lets a test reorder completions.
 */
export function collecting(
  plan: Plan,
  answer: (id: string) => Collected,
  options: { readonly delay?: (id: string) => number; readonly failOpening?: number } = {},
): Opened {
  const worlds = { opened: 1, closed: 0 };
  const asked: string[] = [];
  const world = (): Collector => ({
    async plan() {
      return plan;
    },
    async collect(planned) {
      asked.push(planned.subject.id);
      const wait = options.delay?.(planned.subject.id) ?? 0;
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      return answer(planned.subject.id);
    },
    async openWorker() {
      if (options.failOpening !== undefined && worlds.opened >= options.failOpening) throw new Error('no second browser');
      worlds.opened += 1;
      return world();
    },
    async close() {
      worlds.closed += 1;
    },
  });
  return { collector: world(), worlds, asked };
}

/** A collected subject: its document, and a snapshot of `nodes` when there are any. */
export function rendered(id: string, nodes?: readonly Node[]): Collected {
  return { ok: true, document: documentFor(id), ...(nodes === undefined ? {} : { snapshot: snapshotOf(id, nodes) }) };
}

/** `collected` as another engine read it. */
export function onEngine(collected: Collected, engine: string): Collected {
  if (!collected.ok || collected.snapshot === undefined) return collected;
  const { snapshot } = collected;
  return { ...collected, snapshot: { ...snapshot, environment: environmentKey({ ...snapshot.environment.inputs, engine }) } };
}
