import { NO_ARGS, type Tool } from './tool.js';

export type StateDifference =
  | { readonly kind: 'added'; readonly path: string; readonly value: unknown }
  | { readonly kind: 'removed'; readonly path: string; readonly value: unknown }
  | {
      readonly kind: 'changed';
      readonly path: string;
      readonly before: unknown;
      readonly after: unknown;
    };

/** Compare two JSON-compatible states without assigning meaning to either one. */
export function diffState(before: unknown, after: unknown): readonly StateDifference[] {
  const differences: StateDifference[] = [];
  visit('$', before, after, differences);
  return differences;
}

/** The one stateful tool every served subject receives. */
export const diff: Tool<unknown> = {
  name: 'variance_diff',
  description:
    'Compare the current state with the state held from the previous successful MCP tool invocation. ' +
    'The first invocation records state and has nothing to compare.',
  inputSchema: NO_ARGS,
  run(current, _input, invocation) {
    if (invocation?.previous === undefined) {
      return 'No previous MCP invocation state. The current state is now remembered.';
    }

    const differences = diffState(invocation.previous, current);
    if (differences.length === 0) {
      return 'The current state matches the previous MCP invocation.';
    }

    return [
      `The current state differs from the previous MCP invocation at ${String(differences.length)} path(s).`,
      ...differences.map(describe),
    ].join('\n');
  },
};

function visit(
  path: string,
  before: unknown,
  after: unknown,
  differences: StateDifference[],
): void {
  if (Object.is(before, after)) return;

  if (isRecord(before) && isRecord(after)) {
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
    for (const key of keys) {
      const next = `${path}${property(key)}`;
      if (!(key in before)) {
        differences.push({ kind: 'added', path: next, value: after[key] });
      } else if (!(key in after)) {
        differences.push({ kind: 'removed', path: next, value: before[key] });
      } else {
        visit(next, before[key], after[key], differences);
      }
    }
    return;
  }

  if (Array.isArray(before) && Array.isArray(after)) {
    const length = Math.max(before.length, after.length);
    for (let index = 0; index < length; index += 1) {
      const next = `${path}[${String(index)}]`;
      if (index >= before.length) {
        differences.push({ kind: 'added', path: next, value: after[index] });
      } else if (index >= after.length) {
        differences.push({ kind: 'removed', path: next, value: before[index] });
      } else {
        visit(next, before[index], after[index], differences);
      }
    }
    return;
  }

  differences.push({ kind: 'changed', path, before, after });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function property(key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`;
}

function describe(difference: StateDifference): string {
  switch (difference.kind) {
    case 'added':
      return `+ ${difference.path}: ${valueOf(difference.value)}`;
    case 'removed':
      return `- ${difference.path}: ${valueOf(difference.value)}`;
    case 'changed':
      return `~ ${difference.path}: ${valueOf(difference.before)} -> ${valueOf(difference.after)}`;
  }
}

function valueOf(value: unknown): string {
  const encoded = JSON.stringify(value);
  return encoded === undefined ? String(value) : encoded;
}
