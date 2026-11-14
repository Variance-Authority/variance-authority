/**
 * What a watcher holds about an application nobody is testing: the executions
 * its heads reported, and what each one entered.
 *
 * A head (`@variance-authority/sense/journey`) told where a watcher listens
 * reports each request that carries no way home as an execution of its own.
 * The account is the one a test's driver takes, so nothing new crosses the
 * wire; what differs is the listener. A driver joins accounts to the case that
 * drove them. A watcher has no case, so it keeps each execution as it arrived
 * and lets a reader ask which code it entered.
 *
 * Bounded and counted like everything else here, and written nowhere: an
 * application left running answers thousands of requests, and the ones worth
 * asking about are the ones just made.
 */

import type { EnteredModule, HeadRan, WatchedExecution, WatchedRan } from './state.js';

/**
 * The account a head sends, as far as a watcher reads it.
 *
 * Spelled here rather than imported, because the head lives in
 * `@variance-authority/sense` and a watcher that depended on it would bring
 * the whole instrument into a process that only listens.
 */
export interface HeadAccount {
  readonly version: 1;
  readonly instrumentation: string;
  readonly head: string;
  readonly scope: 'journey' | 'process';
  readonly lost?: number;
  readonly opened?: number;
  readonly settled?: number;
  /** What the execution's functions were handed since the head last told it, in the story format, base64. */
  readonly story?: string;
  readonly modules: readonly {
    readonly id: string;
    readonly hits: readonly number[];
    readonly shared: readonly number[];
    readonly again?: readonly number[];
  }[];
}

const ordinals = (value: unknown): value is readonly number[] =>
  Array.isArray(value) && value.every((ordinal) => Number.isInteger(ordinal));

/** Whether a body off the wire is a head's account, in the version this watcher reads. */
export function isHeadAccount(body: unknown): body is HeadAccount {
  if (typeof body !== 'object' || body === null) return false;
  const said = body as { [Key in keyof HeadAccount]?: unknown };
  return (
    said.version === 1 &&
    typeof said.instrumentation === 'string' &&
    typeof said.head === 'string' &&
    (said.scope === 'journey' || said.scope === 'process') &&
    (said.story === undefined || typeof said.story === 'string') &&
    Array.isArray(said.modules) &&
    said.modules.every(
      (module: { id?: unknown; hits?: unknown; shared?: unknown; again?: unknown }) =>
        typeof module === 'object' &&
        module !== null &&
        typeof module.id === 'string' &&
        ordinals(module.hits) &&
        ordinals(module.shared) &&
        (module.again === undefined || ordinals(module.again)),
    )
  );
}

/** One head's modules, each with the ordinals entered so far, the stories it told, in the order told, and how many it did not keep. */
interface HeadHeld {
  readonly instrumentation: string;
  readonly modules: Map<string, Set<number>>;
  readonly stories: string[];
  bytes: number;
  untold: number;
}

type Entered = Map<string, HeadHeld>;

interface Held {
  readonly ordinal: number;
  open: number;
  readonly heads: Entered;
}

export interface Executions {
  /** Take one account a head sent about one execution. */
  readonly took: (journey: string, account: HeadAccount) => void;
  readonly snapshot: () => WatchedRan;
}

/** A watcher's memory of the executions heads reported, the newest `kept` of them. */
export function createExecutions(kept: number): Executions {
  const held = new Map<string, Held>();
  const common: Entered = new Map();
  const lost = new Map<string, number>();
  const dropped = new Set<string>();
  let arrived = 0;
  let forgotten = 0;

  const entry = (journey: string): Held | undefined => {
    const found = held.get(journey);
    if (found !== undefined) return found;
    // A long request that settles after it was dropped stays dropped: opened again it would push a newer one out.
    if (dropped.has(journey)) return undefined;
    const made: Held = { ordinal: arrived, open: 0, heads: new Map() };
    arrived += 1;
    held.set(journey, made);
    while (held.size > kept) {
      const oldest = held.keys().next();
      if (oldest.done === true) break;
      held.delete(oldest.value);
      forgotten += 1;
      dropped.add(oldest.value);
      if (dropped.size > DROPPED) dropped.delete(dropped.values().next().value!);
    }
    return made;
  };

  return {
    took: (journey, account) => {
      // A head counts what it lost since it started, so the latest count is the whole of it.
      if (account.lost !== undefined) lost.set(account.head, account.lost);
      if (account.scope === 'process') {
        for (const module of account.modules) enter(common, account, module.id, module.hits);
        return;
      }
      const one = entry(journey);
      if (one === undefined) return;
      one.open += (account.opened ?? 0) - (account.settled ?? 0);
      for (const module of account.modules) {
        // What it entered while a module evaluated is every execution's, and
        // the head says so again as the process's. What it entered again
        // afterwards is its own.
        const again = new Set(module.again);
        const shared = new Set(module.shared.filter((ordinal) => !again.has(ordinal)));
        enter(one.heads, account, module.id, module.hits.filter((ordinal) => !shared.has(ordinal)));
      }
      if (account.story !== undefined) tell(headOf(one.heads, account), account.story);
    },
    snapshot: () => ({
      executions: [...held].map(
        ([id, one]): WatchedExecution => ({ id, ordinal: one.ordinal, open: one.open > 0, heads: ran(one.heads) }),
      ),
      forgotten,
      common: ran(common),
      lost: [...lost.values()].reduce((sum, count) => sum + count, 0),
    }),
  };
}

/** How many dropped executions a watcher remembers dropping, so that a late account for one opens nothing. */
const DROPPED = 4096;

/**
 * How many times a head's story of one execution is kept: once as it settled,
 * and again for each promise it left running that ran on. The first tellings
 * hold the request; a later one past the bound is counted, not kept.
 */
export const STORIES = 8;

/** The base64 characters a head's stories of one execution are held to; a telling that would pass it is counted, not kept. */
export const STORY_BYTES = 1 << 20;

function tell(head: HeadHeld, story: string): void {
  if (head.stories.length >= STORIES || head.bytes + story.length > STORY_BYTES) {
    head.untold += 1;
    return;
  }
  head.stories.push(story);
  head.bytes += story.length;
}

function enter(into: Entered, account: HeadAccount, id: string, entered: readonly number[]): void {
  if (entered.length === 0) return;
  const head = headOf(into, account);
  let module = head.modules.get(id);
  if (module === undefined) head.modules.set(id, (module = new Set()));
  for (const ordinal of entered) module.add(ordinal);
}

function headOf(into: Entered, account: HeadAccount): HeadHeld {
  let head = into.get(account.head);
  if (head === undefined) {
    head = { instrumentation: account.instrumentation, modules: new Map(), stories: [], bytes: 0, untold: 0 };
    into.set(account.head, head);
  }
  return head;
}

function ran(heads: Entered): HeadRan[] {
  return [...heads].map(([head, one]) => ({
    head,
    instrumentation: one.instrumentation,
    modules: [...one.modules].map(
      ([id, entered]): EnteredModule => ({ id, entered: [...entered].sort((left, right) => left - right) }),
    ),
    ...(one.stories.length === 0 ? {} : { stories: [...one.stories] }),
    ...(one.untold === 0 ? {} : { untold: one.untold }),
  }));
}
