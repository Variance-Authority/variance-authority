/** Batched questions for a graph whose storage belongs to its reader. */
// compass: variance-authority.reach.relations
import type { EdgeKind, Node, NodeId, NodeKind } from './graph.js';
import type { EdgeUse } from './narrow.js';

export interface RelationNode extends Node {
  readonly id: NodeId;
  readonly unknown?: string;
}
export interface RelationRow {
  readonly id: NodeId;
  readonly edges: readonly { readonly to: RelationNode; readonly kind: EdgeKind }[];
}
export interface RelationWalkOptions {
  readonly seeds: readonly Node[];
  readonly reverse: boolean;
  readonly through?: readonly EdgeKind[];
  readonly avoid: readonly Node[];
  readonly moved: readonly { readonly file: string; readonly names: readonly string[] }[];
  readonly shadows: boolean;
}
export interface RelationWalk {
  readonly nodes: readonly RelationNode[];
  readonly parents: readonly { readonly id: NodeId; readonly parent: number }[];
  readonly missing: readonly string[];
  readonly shadowed: readonly string[];
}
export interface RelationCarry { readonly whole: boolean; readonly names: readonly { readonly name: string; readonly origin: string }[] }
export interface RelationFrontier {
  frontier(): readonly { readonly node: RelationNode; readonly carry: RelationCarry; readonly trail: readonly RelationNode[] }[];
  advance(replies: readonly { readonly id: NodeId; readonly carry: RelationCarry }[]): void;
}
export interface RelationQuestions {
  importerFrontier(seed: NodeId, carry: RelationCarry, seedsHold: boolean, filesOnly: boolean, dependsWhole: boolean): RelationFrontier;
  overlay(added: readonly { readonly id: NodeId; readonly targets: readonly NodeId[] }[], removed: readonly { readonly id: NodeId; readonly targets: readonly NodeId[] }[], created: readonly NodeId[]): RelationQuestions;
  walkWithin(seeds: readonly NodeId[], open: readonly NodeId[]): RelationWalk;
  entries(starts: readonly NodeId[], open: readonly NodeId[], alike: readonly (readonly NodeId[])[]): readonly NodeId[];
  drift(modules: readonly { readonly file: string; readonly source: string; readonly tests: readonly string[] }[], before: readonly string[], created: readonly NodeId[], unknown: readonly string[]): { readonly rows: readonly { readonly file: string; readonly test: string }[]; readonly unread: readonly { readonly file: string; readonly test: string }[] };
  hasShadows(): boolean;
  shadows(tests: readonly string[]): readonly (readonly string[])[];
  unknown(): readonly RelationNode[];
  lookup(nodes: readonly Node[]): readonly (RelationNode | null)[];
  nodes(ids: readonly NodeId[]): readonly (RelationNode | null)[];
  list(kind?: NodeKind, dirs?: readonly string[], pattern?: string): readonly RelationNode[];
  rows(ids: readonly NodeId[], reverse: boolean): readonly RelationRow[];
  uses(edges: readonly { readonly importer: NodeId; readonly target: NodeId }[]): readonly (EdgeUse | null)[];
  walk(options: RelationWalkOptions): RelationWalk;
  before(entries: readonly string[], sensed: readonly string[]): { readonly entries: readonly string[]; readonly files: readonly string[]; readonly unread: readonly string[] };
  shadowed(tests: readonly string[]): readonly (readonly string[])[];
  declaredBehind(files: readonly string[]): readonly RelationNode[];
  beyond(packages: readonly string[], moved: readonly string[]): {
    readonly files: readonly string[];
    readonly chains: readonly { readonly file: string; readonly trail: readonly string[] }[];
    readonly traced: readonly string[];
    readonly unplaced: readonly string[];
  };
}
