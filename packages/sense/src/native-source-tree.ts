/** Native path graph queries; the graph and harvested source columns stay in Rust. */
// compass: variance-authority.reach.source-index

import type { EdgeKind } from '@variance-authority/core/relate';
import { native, nativeRefusal } from './addon.js';

/** A predicate evaluated against the native source columns. */
export interface NamesOperand {
  readonly kind: 'declares' | 'imports';
  readonly pattern?: string;
  readonly specifier?: string;
  readonly name?: string;
}

/** Matching declaration or import evidence; unmatched source rows stay native. */
export interface NameEvidence {
  readonly line: number;
  readonly name?: string;
  readonly from?: string;
  readonly local?: string;
  readonly through?: string;
}

export interface NamesGroup {
  readonly files: readonly { readonly file: string; readonly evidence: readonly NameEvidence[] }[];
}

export interface NamesAnswer {
  readonly unread: number;
  readonly groups: readonly NamesGroup[];
}

/** One native traversal, with chains recovered only for files a caller shows. */
export interface NativeSourceTreeWalk {
  files(): string[];
  distances(): number[];
  chain(file: string): { readonly file: string; readonly kind?: EdgeKind }[];
}

export interface NativeSourceTreeReader {
  files(): string[];
  unknownAmong(files: string[]): string[];
  walk(seeds: string[], reverse: boolean, weighted: boolean): NativeSourceTreeWalk;
  queryNames(operands: NamesOperand[]): NamesAnswer;
}

/** Open published binary tree columns without rebuilding a JavaScript graph. */
export function openSourceTree(bytes: Uint8Array): NativeSourceTreeReader {
  const scanner = native();
  if (scanner?.openSourceTree === undefined) {
    throw new Error(`the source tree is read by the native scanner, and ${nativeRefusal() ?? 'the scanner that loaded has no `openSourceTree`; build it again'}`);
  }
  return scanner.openSourceTree(bytes);
}
