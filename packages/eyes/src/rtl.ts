import type { TapRefusal } from '@variance-authority/react';
import {
  createEyesLog,
  eyesTestAttention,
  type AttentionDraft,
  type EyesLog,
  type EyesTestAttention,
  type EyesTestIdentity,
} from './access.js';
import { snapshotArguments } from './arguments.js';
import { observeDocumentEvents, observeReactCommits } from './observe.js';
import { snapshotNode } from './snapshot.js';

type Query = (...arguments_: unknown[]) => unknown;

interface WatchedScreen {
  readonly originals: Map<string, PropertyDescriptor>;
  readonly logs: Set<EyesLog>;
  /** Undo the realm half. Query descriptors are restored separately. */
  readonly stops: (() => void)[];
  /**
   * Why no commits will arrive, replayed into every log as it joins.
   *
   * Held rather than published once: a log that subscribes after the screen was
   * instrumented would otherwise read its own empty commit record as a page that
   * rendered once and stopped.
   */
  refusal: TapRefusal | undefined;
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

/**
 * Install the realm half on the runner's own document and React.
 *
 * A query wrapper sees what the test asked for. The click that removed the
 * element and the commit that rendered it happen where the wrapper is not, so
 * this installs the same listener set and the same tap the page agent does.
 */
function observeRealm(state: WatchedScreen): void {
  const record = (attention: AttentionDraft): void => publish(state, attention);

  // A runner without a DOM still has queries worth recording; it has no document
  // to listen on and no React to commit.
  if (typeof document !== 'undefined') {
    state.stops.push(observeDocumentEvents(document, record));
  }

  // `createHook: false`. This entry point is reached by importing the same
  // `screen` the test imports, so `react-dom` has run its module body and bound
  // whatever hook it found. Installing one now would attach to an object React
  // never calls, and the log would report a page that never rendered.
  const commits = observeReactCommits(record, { createHook: false });
  state.refusal = commits.refusal;
  state.stops.push(() => commits.stop());
}

export interface RtlWatch {
  readonly log: EyesLog;
  close(): void;
}

/**
 * Instrument one RTL `screen` object in place, and the realm it queries.
 *
 * Calling this from Jest or Vitest setup reaches every later import of that
 * same object. `within()` and render-result queries are different bound objects
 * and are intentionally outside this entry point.
 *
 * The document listeners and the commit tap belong to the screen rather than to
 * a log: the first watch installs them, the last close removes them. The tap
 * attaches only to a hook that already exists, so commits require a setup file
 * that runs before `react-dom`; where there is none, every log carries the
 * refusal that says so.
 */
export function watch(screen: object, log: EyesLog = createEyesLog()): RtlWatch {
  const record = screen as Record<PropertyKey, unknown>;
  let state = record[WATCHED] as WatchedScreen | undefined;

  if (state === undefined) {
    state = { originals: new Map(), logs: new Set(), stops: [], refusal: undefined };
    Object.defineProperty(screen, WATCHED, { value: state, configurable: true });
    instrument(screen, state);
    observeRealm(state);
  }
  state.logs.add(log);
  if (state.refusal !== undefined) {
    log.record({ kind: 'react-tap-refused', reason: state.refusal });
  }

  let closed = false;
  return {
    log,
    close() {
      if (closed) return;
      closed = true;
      state!.logs.delete(log);
      if (state!.logs.size > 0) return;

      for (const stop of state!.stops) stop();
      for (const [name, descriptor] of state!.originals) {
        Object.defineProperty(screen, name, descriptor);
      }
      delete record[WATCHED];
    },
  };
}

export interface RtlTestWatch {
  readonly log: EyesLog;
  /** Stop watching and close this test's journal under the runner's identity. */
  close(because?: string): EyesTestAttention;
}

/**
 * Watch `screen` for the span of one runner-identified test.
 *
 * The pairing is the point. {@link watch} is a subscription with no notion of a
 * test, so an adopter wiring it into `beforeEach` owns three separate things —
 * a log per test, a drain that happens exactly once, and the runner's id, title
 * and file — and getting any of them wrong is silent: a shared log attributes
 * one test's queries to the next, a missed drain reports a test that saw
 * nothing, and a second drain produces a journal that starts mid-run. Here the
 * identity is supplied where the log is created and the journal is closed where
 * the watch is, so the completeness `eyesTestAttention` derives is about a span
 * that really was this test.
 *
 * `close` is idempotent and returns the same journal, because a teardown hook
 * that also runs on failure is the ordinary case and a second call must not
 * produce an empty second reading of the same test.
 */
export function watchTest(screen: object, identity: EyesTestIdentity): RtlTestWatch {
  const watching = watch(screen, createEyesLog());
  let closed: EyesTestAttention | undefined;

  return {
    log: watching.log,
    close(because) {
      if (closed !== undefined) return closed;
      // Unwatched first, then drained. The other order leaves a capture-phase
      // listener able to record into a journal that has already been handed
      // over, and that entry is then lost rather than reported as lost.
      watching.close();
      closed = eyesTestAttention(identity, watching.log.drain(), because);
      return closed;
    },
  };
}
