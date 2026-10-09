/**
 * The shapes of a concern, apart from the store so the Worker and the page can
 * name them without a database binding — the reason
 * [`review-types.ts`](./review-types.ts) is apart from `review.ts`.
 */

/**
 * Where a concern stands.
 *
 * `open` is suspected and nobody has picked it up; `investigating` is somebody
 * looking; `resolved` is answered, either way. Three because the rail counts
 * three, and none of them is a verdict on the pixels — that is a decision.
 */
export type ConcernState = 'open' | 'investigating' | 'resolved';

export const CONCERN_STATES: readonly ConcernState[] = ['open', 'investigating', 'resolved'];

/** A rectangle on the after image of the build the concern was raised in. */
export interface ConcernRegion {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One step in a concern's trail. The last one is its state. */
export interface ConcernEvent {
  readonly state: ConcernState;
  readonly by: string;
  readonly at: string;
  readonly note?: string;
  readonly hypothesis?: string;
}

/**
 * What a reviewer suspected about one render, and everything since.
 *
 * Anchored to the subject, not to the build it was raised in: `build` says where
 * it was seen, and every later build of the subject shows it. A concern never
 * moves a baseline and an approval never resolves a concern.
 */
export interface Concern {
  readonly id: number;
  readonly build: string;
  readonly subject: string;
  readonly title: string;
  /** Absent when the concern is about the whole render. */
  readonly region?: ConcernRegion;
  /**
   * What the reviewer pointed at, as they named it: `CartSummary.tsx:84`, a
   * component, `baseline`. Empty when they pointed at nothing.
   */
  readonly evidence: readonly string[];
  readonly by: string;
  readonly at: string;
  readonly state: ConcernState;
  readonly events: readonly ConcernEvent[];
}

/** How many concerns stand in each state, over the subjects one build showed. */
export type ConcernTally = Readonly<Record<ConcernState, number>>;

export interface RaiseConcern {
  readonly build: string;
  readonly subject: string;
  readonly title: string;
  readonly by: string;
  readonly note?: string;
  readonly hypothesis?: string;
  readonly region?: ConcernRegion;
  readonly evidence?: readonly string[];
  /** `open` when unset. */
  readonly state?: ConcernState;
}

export interface MoveConcern {
  readonly state: ConcernState;
  readonly by: string;
  readonly note?: string;
  readonly hypothesis?: string;
}

/** Which concerns to read. Every field narrows; none set reads the project's. */
export interface ConcernQuery {
  readonly subject?: string;
  /**
   * Every concern on a subject this build showed, whichever build raised it.
   * A join rather than a subject list: D1 binds at most 100 values a statement,
   * and a build shows thousands of subjects.
   */
  readonly seenIn?: string;
  readonly state?: ConcernState;
}
