// compass: variance-authority.harness

/**
 * A part of the page, named the way a person finds it. Each surface asks its
 * own engine for it, so one declaration holds over a document and a browser.
 * A string `name`, `text` or `label` matches whole; a pattern matches within.
 */
export type Query =
  | { readonly role: string; readonly name?: string | RegExp }
  | { readonly text: string | RegExp }
  | { readonly label: string | RegExp }
  | { readonly testId: string }
  | { readonly css: string };

/** A query asked of one surface. `visible` answers with what was found, and nothing while none of it shows. */
export interface Target<Handle = unknown> {
  visible(): Promise<Handle | undefined>;
}

/**
 * How an action learns that the app has finished answering it. Asked for
 * before the act, so nothing the act starts is missed.
 */
export interface Quiet {
  /** Resolves once the act is done and the page has been quiet since. Asked for when the act is done. */
  settled(): Promise<'quiet'>;
  /** Whether nothing has begun since the page last went quiet. */
  still(): boolean;
  /** What holds the quiet off, in words, and absent when nothing does. */
  held(): string | undefined;
  stop(): void;
}

/** Whether the app, since the action began, went somewhere that is no part of the page it was on. */
export interface Elsewhere {
  /** Where it went, in words, and absent while it is where it was. */
  left(): Promise<string | undefined>;
  stop(): void;
}

/**
 * What page-broker needs of a page, and what a test does to it. A surface for
 * a document and one for a browser page ship with the package; `native` is the
 * page itself, for an act the shared words do not cover.
 */
export interface Surface<Native = unknown, Handle = unknown> {
  readonly native: Native;
  find(query: Query): Target<Handle>;
  /** Resolves `arrived` once any target is visible, and `late` when none is within `ms`. */
  arrival(targets: readonly Target<Handle>[], ms: number): Promise<'arrived' | 'late'>;
  /** Quiet once no work the surface can see has been pending for `period` ms. */
  quiet(period: number): Quiet;
  elsewhere(): Promise<Elsewhere>;
  click(query: Query): Promise<void>;
  fill(query: Query, value: string): Promise<void>;
  press(query: Query, key: string): Promise<void>;
  check(query: Query): Promise<void>;
  select(query: Query, value: string): Promise<void>;
}
