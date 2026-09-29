/** What the addon says of a module's reads and of what moved in it, as columns the callers of `moduleVerdict` and `moduleReaders` take. */

// compass: variance-authority.reach

/** `Relations`, flattened to the columns the addon walks. */
export interface NativeModuleVerdict {
  readonly kind: 'none' | 'bodies' | 'values' | 'load';
  /** Top-level bindings whose value moved. */
  readonly names: string[];
  /** Exported names whose binding moved or went. */
  readonly exports: string[];
  /** Exported names the new text no longer has. */
  readonly gone: string[];
  /** Sources an import binds names from on one side only. */
  readonly imported: string[];
  /**
   * Exports an importer sees behave differently, function bodies included.
   * Absent when every export may: the load moved, or a statement that binds
   * nothing hands a moved binding on.
   */
  readonly moved?: string[];
}

export interface NativeModuleReaders {
  /** Reads inside functions: the 1-based line and the changed name the read traces to. */
  readonly reads: Array<{ readonly line: number; readonly name: string }>;
  /** The changed names the module reads while it loads. */
  readonly load: string[];
  /** Names this file exports whose value moved, with the changed name each carries. */
  readonly exported: Array<{ readonly name: string; readonly origin: string }>;
  /** A `require`, an `import()` or an `import x = require()` no name reaches. */
  readonly untraced: boolean;
  /** Every name this file imports by name. */
  readonly imports: string[];
  /** Names this file re-exports from a source, among those that moved. */
  readonly passed: Array<{ readonly name: string; readonly origin: string }>;
  /** Every name this file exports. */
  readonly interface: string[];
}
