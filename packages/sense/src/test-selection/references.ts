// compass: variance-authority.reach
import type { Relations } from '@variance-authority/core/relate';
import { native } from '../addon.js';
import { declaredTsconfig } from '../typescript.js';
import { listedIn } from './effects.js';

/** Where one file references what it imports, by the repository file each import lands on. */
export interface FileReferences {
  /**
   * Each reference to an imported binding: the file its import lands on, the
   * name taken (`default`, a namespace member, or `*` for a namespace used
   * whole), the 1-based line, and whether it runs when the file loads.
   */
  readonly references: readonly {
    readonly file: string;
    readonly name: string;
    readonly line: number;
    readonly load: boolean;
  }[];
  /** The files it re-exports a name from, which its importers use. */
  readonly passed: readonly string[];
  /** Every file a value import or re-export of it lands on, side effects included. */
  readonly imported: readonly string[];
  /** The files it imports with no binding, `import './x'`, which it loads for their effect. */
  readonly effects: readonly string[];
  /** A `require`, an `import()` or an `import x = require()` no name traces. */
  readonly untraced: boolean;
  /**
   * Every value name the file exports, `default` included. Absent when an
   * `export *` leaves the set to another file, the file exports nothing as a
   * module does, it publishes through CommonJS, where what an importer's
   * `default` holds is not read, or its exports were not read.
   */
  readonly exports?: readonly string[];
}

/**
 * Resolve one current-worktree file's imported references natively for distill.
 * This targeted live query reads the requested source rather than reusing the
 * published parse; source text and whole parse objects stay in Rust.
 * Nothing when the file cannot be read or parsed, or the addon is missing.
 */
export function importReferences(root: string, relations: Relations | undefined, file: string): FileReferences | undefined {
  return native()?.fileReferences?.(root, file, listedIn(relations), declaredTsconfig(root)) ?? undefined;
}
