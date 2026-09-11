import type { CallSiteResolver, SourceIndex } from '@variance-authority/core/attribute';
import type {
  RenderDocument,
  SemanticSnapshot,
  SubjectRef,
  Viewport,
} from '@variance-authority/core/format';

/** Structural copy of the CLI collector boundary; this surface does not import the binary. */
export interface PlannedSubject {
  readonly subject: SubjectRef;
  readonly viewport?: Viewport;
  readonly tags?: readonly string[];
}

export interface Plan {
  readonly subjects: readonly PlannedSubject[];
  readonly notObserved: readonly unknown[];
  readonly warnings: readonly string[];
}

export type Collected =
  | {
      readonly ok: true;
      readonly document: RenderDocument;
      readonly snapshot?: SemanticSnapshot;
      readonly source?: SourceIndex;
      readonly stabilization?: readonly string[];
    }
  | { readonly ok: false; readonly because: string };

export interface Collector {
  plan(): Promise<Plan>;
  collect(subject: PlannedSubject): Promise<Collected>;
  readonly callSites?: CallSiteResolver;
  close(): Promise<void>;
}

export interface CollectorContext {
  readonly config: { readonly viewport: Viewport };
  readonly plan?: Plan;
}

export type SubjectSource = (context: CollectorContext) => Promise<Collector>;
