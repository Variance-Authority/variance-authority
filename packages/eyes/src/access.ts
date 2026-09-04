import type { Commit, TapRefusal, resolveProvenance } from '@variance-authority/react';

/** A DOM target copied while its identity and React Fiber are still live. */
export interface TargetSnapshot {
  readonly nodeName: string;
  readonly id?: string;
  readonly role?: string;
  readonly testId?: string;
  readonly ariaLabel?: string;
  readonly name?: string;
  readonly type?: string;
  readonly provenance: ReturnType<typeof resolveProvenance>;
}

export type ArgumentSnapshot =
  | null
  | string
  | number
  | boolean
  | { readonly kind: 'undefined' }
  | { readonly kind: 'bigint'; readonly value: string }
  | { readonly kind: 'regexp'; readonly source: string; readonly flags: string }
  | { readonly kind: 'function'; readonly name: string }
  | { readonly kind: 'symbol'; readonly value: string }
  | { readonly kind: 'unavailable'; readonly description: string }
  | readonly ArgumentSnapshot[]
  | { readonly [key: string]: ArgumentSnapshot };

interface RtlQueryBase {
  readonly kind: 'rtl-query';
  readonly query: string;
  readonly arguments: readonly ArgumentSnapshot[];
}

export type RtlQueryAttention =
  | (RtlQueryBase & {
      readonly outcome: 'resolved';
      /** An empty array means a plural query observed no matches. */
      readonly targets: readonly TargetSnapshot[];
    })
  | (RtlQueryBase & { readonly outcome: 'absent' })
  | (RtlQueryBase & { readonly outcome: 'threw'; readonly error: string });

/** One method in the lazy Locator plan that Playwright will consume later. */
export interface LocatorStep {
  readonly member: string;
  readonly arguments: readonly ArgumentSnapshot[];
}

export interface PlannedLocatorAttention {
  readonly kind: 'playwright-locator';
  readonly operation: 'planned';
  readonly locator: readonly LocatorStep[];
}

interface ConsumedLocatorBase {
  readonly kind: 'playwright-locator';
  readonly operation: 'action' | 'read' | 'assertion';
  readonly member: string;
  readonly locator: readonly LocatorStep[];
  /** Present when the page agent completed the pre-operation read, even when empty. */
  readonly before?: readonly TargetSnapshot[];
}

export type ConsumedLocatorAttention =
  | (ConsumedLocatorBase & {
      readonly outcome: 'resolved';
      /** Present when the page agent completed the post-operation read, even when empty. */
      readonly after?: readonly TargetSnapshot[];
    })
  | (ConsumedLocatorBase & { readonly outcome: 'threw'; readonly error: string });

export interface DocumentEventAttention {
  readonly kind: 'document-event';
  readonly event: string;
  readonly trusted: boolean;
  readonly target: TargetSnapshot;
}

/** An authored test phase; Eyes records this identity and never infers it. */
export type EyesPhase = 'arrange' | 'act' | 'assert';

/** An authored AAA boundary. Eyes records it and never infers one from an API call. */
export interface PhaseAttention {
  readonly kind: 'eyes-phase';
  readonly phase: EyesPhase;
}

/** One React commit observed by the page agent installed before the application. */
export interface ReactCommitAttention {
  readonly kind: 'react-commit';
  readonly commit: Commit;
}

/**
 * The commit tap did not attach, and why.
 *
 * A journal with no commits in it says one of two things, and they are opposite:
 * the application rendered nothing, or nobody was listening. This entry is what
 * separates them, so a reader never reports a quiet page it never observed.
 */
export interface ReactTapRefusedAttention {
  readonly kind: 'react-tap-refused';
  readonly reason: TapRefusal;
}

export type AttentionDraft =
  | RtlQueryAttention
  | PlannedLocatorAttention
  | ConsumedLocatorAttention
  | DocumentEventAttention
  | PhaseAttention
  | ReactCommitAttention
  | ReactTapRefusedAttention;

/** One ordered selector, Locator, event, or authored phase observation. */
export type Attention = AttentionDraft & { readonly sequence: number };

/**
 * The ordered journal one realm writes into.
 *
 * `sequence` counts from construction and `drain` does not restart it, so the
 * numbers a holder is handed remain absolute across drains. That is what lets a
 * later reader tell a journal that recorded nothing from one whose entries were
 * already taken; a per-drain counter would make the two indistinguishable.
 */
export interface EyesLog {
  /** Everything recorded since construction or the previous drain. */
  readonly seen: readonly Attention[];
  record(attention: AttentionDraft): Attention;
  /** Record an authored AAA boundary without classifying surrounding evidence by guesswork. */
  phase(phase: EyesPhase): Attention;
  drain(): readonly Attention[];
}

interface EyesTestBase {
  /** Stable producer identity. Titles are not required to be unique. */
  readonly id: string;
  readonly title: string;
  readonly file?: string;
  readonly attention: readonly Attention[];
}

/** One runner-identified test journal with explicit collection completeness. */
export type EyesTestAttention =
  | (EyesTestBase & { readonly complete: true })
  | (EyesTestBase & { readonly complete: false; readonly because: string });

/** Serializable, test-scoped attention evidence for readers in another process. */
export interface EyesArchive {
  readonly eyesVersion: 1;
  readonly tests: readonly EyesTestAttention[];
}

/** A synchronous, per-realm journal. It owns ordering and no runner lifecycle. */
export function createEyesLog(): EyesLog {
  const seen: Attention[] = [];
  let sequence = 0;

  return {
    get seen() {
      return [...seen];
    },
    record(draft) {
      const attention = { ...draft, sequence } as Attention;
      sequence += 1;
      seen.push(attention);
      return attention;
    },
    phase(phase) {
      return this.record({ kind: 'eyes-phase', phase });
    },
    drain() {
      return seen.splice(0, seen.length);
    },
  };
}

/** Copy complete or explicitly partial test journals into one portable value. */
export function createEyesArchive(tests: readonly EyesTestAttention[]): EyesArchive {
  const ids = new Set<string>();
  const copied = tests.map((test) => {
    if (test.id === '' || test.title === '') throw new Error('eyes test id and title are required');
    if (ids.has(test.id)) throw new Error(`duplicate eyes test id: ${test.id}`);
    ids.add(test.id);
    if (!test.complete && test.because.trim() === '') {
      throw new Error(`partial eyes test ${test.id} requires a reason`);
    }
    for (let at = 1; at < test.attention.length; at += 1) {
      if (test.attention[at]!.sequence <= test.attention[at - 1]!.sequence) {
        throw new Error(`eyes test ${test.id} attention is not in sequence order`);
      }
    }
    return {
      ...test,
      attention: test.attention.map((entry) => ({ ...entry })),
    };
  });
  return { eyesVersion: 1, tests: copied };
}

/** How a runner names the test whose journal this is. */
export interface EyesTestIdentity {
  /** Stable producer identity. Titles are not required to be unique. */
  readonly id: string;
  readonly title: string;
  readonly file?: string;
}

/**
 * Close one test's journal, deciding completeness from the log rather than hope.
 *
 * `createEyesLog` numbers entries from construction and `drain` does not reset
 * that counter, so a sequence is a count of everything the log ever recorded and
 * not of what is in hand. A journal that starts above zero, or skips a number,
 * is therefore missing entries an earlier drain took — and those numbers are the
 * only evidence left that they existed. Marking such a journal `complete` hands
 * a reader a chronology with holes and no way to see them, which is the case the
 * partial arm exists for.
 *
 * A caller that already knows the collection was cut short — a worker that died,
 * a page whose receiver went away mid-test — says so in `because`, and that
 * reason wins: it names a cause the sequence numbers cannot.
 */
export function eyesTestAttention(
  identity: EyesTestIdentity,
  attention: readonly Attention[],
  because?: string,
): EyesTestAttention {
  const base = {
    id: identity.id,
    title: identity.title,
    ...(identity.file === undefined ? {} : { file: identity.file }),
    attention: attention.map((entry) => ({ ...entry })) as readonly Attention[],
  };
  const reason = because ?? dropped(attention);
  if (reason === undefined) return { ...base, complete: true };
  return { ...base, complete: false, because: reason };
}

/** How many entries this log recorded that are not in the journal handed over. */
function dropped(attention: readonly Attention[]): string | undefined {
  let expected = 0;
  let missing = 0;
  for (const entry of attention) {
    if (entry.sequence > expected) missing += entry.sequence - expected;
    expected = entry.sequence + 1;
  }
  if (missing === 0) return undefined;
  return (
    `${missing} attention ${missing === 1 ? 'entry was' : 'entries were'} recorded by this ` +
    'log and taken by an earlier drain'
  );
}
