import type { Digest } from '@variance-authority/core';
import type { ScenarioActRef, ScenarioRun } from './contract.js';
import { assertScenarioRun } from './execution.js';

export interface ScenarioMachineNode {
  readonly state: Digest;
  readonly snapshots: readonly Digest[];
  readonly executions: readonly string[];
}

export interface ScenarioMachineTransition {
  readonly from: Digest;
  readonly act: string;
  readonly to: Digest;
  readonly executions: readonly string[];
}

export interface ScenarioUnknownTransition {
  readonly from: Digest;
  readonly act: ScenarioActRef;
  readonly execution: string;
  readonly because: string;
}

export interface ScenarioMachineDivergence {
  readonly from: Digest;
  readonly act: string;
  readonly destinations: readonly Digest[];
}

export interface ScenarioMachine {
  readonly nodes: readonly ScenarioMachineNode[];
  readonly transitions: readonly ScenarioMachineTransition[];
  readonly unknown: readonly ScenarioUnknownTransition[];
  readonly divergences: readonly ScenarioMachineDivergence[];
}

/** Fold witnessed execution paths into a partial state machine. No absent edge is inferred. */
export function foldScenarios(runs: readonly ScenarioRun[]): ScenarioMachine {
  const nodes = new Map<Digest, { snapshots: Set<Digest>; executions: Set<string> }>();
  const transitions = new Map<
    string,
    { from: Digest; act: string; to: Digest; executions: Set<string> }
  >();
  const unknown: ScenarioUnknownTransition[] = [];

  for (const run of runs) {
    assertScenarioRun(run);
    for (const frame of run.execution.frames) {
      if (frame.outcome.kind !== 'observed') continue;
      const node = nodes.get(frame.outcome.state) ?? {
        snapshots: new Set<Digest>(),
        executions: new Set<string>(),
      };
      node.snapshots.add(frame.outcome.snapshot);
      node.executions.add(run.execution.id);
      nodes.set(frame.outcome.state, node);
    }

    for (let index = 1; index < run.execution.frames.length; index += 1) {
      const before = run.execution.frames[index - 1]!;
      const after = run.execution.frames[index]!;
      if (before.outcome.kind !== 'observed' || after.act === undefined) continue;
      if (after.outcome.kind === 'unobserved') {
        unknown.push({
          from: before.outcome.state,
          act: after.act,
          execution: run.execution.id,
          because: after.outcome.diagnostics.map((entry) => entry.message).join('; '),
        });
        continue;
      }

      const key = `${before.outcome.state}\u0000${after.act.key}\u0000${after.outcome.state}`;
      const edge = transitions.get(key) ?? {
        from: before.outcome.state,
        act: after.act.key,
        to: after.outcome.state,
        executions: new Set<string>(),
      };
      edge.executions.add(run.execution.id);
      transitions.set(key, edge);
    }
  }

  const edges = [...transitions.values()]
    .map((edge) => ({ ...edge, executions: sorted(edge.executions) }))
    .sort((a, b) => compare(`${a.from}\u0000${a.act}\u0000${a.to}`, `${b.from}\u0000${b.act}\u0000${b.to}`));
  const destinations = new Map<string, Set<Digest>>();
  for (const edge of edges) {
    const key = `${edge.from}\u0000${edge.act}`;
    const found = destinations.get(key) ?? new Set<Digest>();
    found.add(edge.to);
    destinations.set(key, found);
  }

  return {
    nodes: [...nodes.entries()]
      .map(([state, node]) => ({
        state,
        snapshots: sorted(node.snapshots),
        executions: sorted(node.executions),
      }))
      .sort((a, b) => compare(a.state, b.state)),
    transitions: edges,
    unknown: [...unknown].sort((a, b) =>
      compare(`${a.from}\u0000${a.act.key}\u0000${a.execution}`, `${b.from}\u0000${b.act.key}\u0000${b.execution}`),
    ),
    divergences: [...destinations.entries()]
      .filter(([, values]) => values.size > 1)
      .map(([key, values]) => {
        const split = key.indexOf('\u0000');
        return {
          from: key.slice(0, split),
          act: key.slice(split + 1),
          destinations: sorted(values),
        };
      })
      .sort((a, b) => compare(`${a.from}\u0000${a.act}`, `${b.from}\u0000${b.act}`)),
  };
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort(compare);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
