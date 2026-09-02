import { createEyesLog, type AttentionDraft, type EyesLog } from './access.js';
import { snapshotArguments } from './arguments.js';
import { snapshotNode } from './snapshot.js';

type Query = (...arguments_: unknown[]) => unknown;

interface WatchedScreen {
  readonly originals: Map<string, PropertyDescriptor>;
  readonly logs: Set<EyesLog>;
}

const WATCHED = Symbol.for('@variance-authority/eyes/rtl');
const QUERY = /^(?:get|query|find)(?:All)?By/;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function nodesFrom(result: unknown): readonly Node[] | null {
  if (result === null) return null;
  if (typeof Node !== 'undefined' && result instanceof Node) return [result];
  if (
    Array.isArray(result) &&
    result.every((entry) => typeof Node !== 'undefined' && entry instanceof Node)
  ) {
    return result;
  }
  return null;
}

function publish(state: WatchedScreen, attention: AttentionDraft): void {
  for (const log of state.logs) log.record(attention);
}

function resolvedAttention(
  query: string,
  arguments_: readonly unknown[],
  result: unknown,
): AttentionDraft {
  const nodes = nodesFrom(result);
  if (nodes === null) {
    return {
      kind: 'rtl-query',
      query,
      arguments: snapshotArguments(arguments_),
      outcome: 'absent',
    };
  }

  return {
    kind: 'rtl-query',
    query,
    arguments: snapshotArguments(arguments_),
    outcome: 'resolved',
    targets: nodes.map(snapshotNode),
  };
}

function instrument(screen: object, state: WatchedScreen): void {
  for (const name of Object.keys(screen).filter((candidate) => QUERY.test(candidate))) {
    const descriptor = Object.getOwnPropertyDescriptor(screen, name);
    if (!descriptor || typeof descriptor.value !== 'function') continue;

    const original = descriptor.value as Query;
    state.originals.set(name, descriptor);

    const wrapped: Query = function (this: unknown, ...arguments_: unknown[]): unknown {
      let result: unknown;
      try {
        result = Reflect.apply(original, this, arguments_);
      } catch (error) {
        publish(state, {
          kind: 'rtl-query',
          query: name,
          arguments: snapshotArguments(arguments_),
          outcome: 'threw',
          error: errorMessage(error),
        });
        throw error;
      }

      if (result && typeof (result as PromiseLike<unknown>).then === 'function') {
        void (result as PromiseLike<unknown>).then(
          (value) => publish(state, resolvedAttention(name, arguments_, value)),
          (error) => publish(state, {
            kind: 'rtl-query',
            query: name,
            arguments: snapshotArguments(arguments_),
            outcome: 'threw',
            error: errorMessage(error),
          }),
        );
      } else {
        publish(state, resolvedAttention(name, arguments_, result));
      }

      return result;
    };

    Object.defineProperty(screen, name, { ...descriptor, value: wrapped });
  }
}

export interface RtlWatch {
  readonly log: EyesLog;
  close(): void;
}

/**
 * Instrument the bound queries on one RTL `screen` object in place.
 *
 * Calling this from Jest or Vitest setup reaches every later import of that
 * same object. `within()` and render-result queries are different bound objects
 * and are intentionally outside this entry point.
 */
export function watch(screen: object, log: EyesLog = createEyesLog()): RtlWatch {
  const record = screen as Record<PropertyKey, unknown>;
  let state = record[WATCHED] as WatchedScreen | undefined;

  if (state === undefined) {
    state = { originals: new Map(), logs: new Set() };
    Object.defineProperty(screen, WATCHED, { value: state, configurable: true });
    instrument(screen, state);
  }
  state.logs.add(log);

  let closed = false;
  return {
    log,
    close() {
      if (closed) return;
      closed = true;
      state!.logs.delete(log);
      if (state!.logs.size > 0) return;

      for (const [name, descriptor] of state!.originals) {
        Object.defineProperty(screen, name, descriptor);
      }
      delete record[WATCHED];
    },
  };
}
