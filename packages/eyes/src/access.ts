import type { resolveProvenance } from '@variance-authority/react';

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

export type AttentionDraft =
  | RtlQueryAttention
  | PlannedLocatorAttention
  | ConsumedLocatorAttention
  | DocumentEventAttention;

export type Attention = AttentionDraft & { readonly sequence: number };

export interface EyesLog {
  /** Everything recorded since construction or the previous drain. */
  readonly seen: readonly Attention[];
  record(attention: AttentionDraft): Attention;
  drain(): readonly Attention[];
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
    drain() {
      return seen.splice(0, seen.length);
    },
  };
}
