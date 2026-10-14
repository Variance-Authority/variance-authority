/**
 * A named import whose consumer reads functions as source syntax.
 *
 * Supply the same rules, in the same order, to the build and recording driver.
 * Rules are absent by default: the instrumenter recognizes no library by name.
 * A matching function belongs to its enclosing region rather than receiving
 * probes inside its body; ordinary runtime calls inside consumed values remain
 * instrumented. Immutable local declarations are followed by scope binding.
 */
export type SourceConsumed = {
  /** The import specifier exactly as written in source. */
  readonly module: string;
  /** The name exported by that module; a local import alias still matches. */
  readonly imported: string;
  /**
   * Steps from the imported binding to the consumer's callee or template tag.
   * `member` is one property access; `call` is the result of one invocation.
   * Absent is the imported binding itself. Each path must match in full.
   */
  readonly path?: readonly ('member' | 'call')[];
} & (
  | {
    readonly syntax: 'arguments';
    /** Zero-based positions whose values are source input; absent means all, empty means none. */
    readonly arguments?: readonly number[];
  }
  | { readonly syntax: 'template'; readonly arguments?: never }
);
