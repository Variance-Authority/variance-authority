// Not exported, and named with a string literal rather than a binding. It is
// here because a reader that asks a declaration for `.id.name` crashes on it.
declare module 'somewhere' {
  export const anything: unknown;
}

export function measure(): number {
  return 1;
}

export class Reading {}

export interface Frame {
  readonly at: number;
}

export type Span = readonly [number, number];

export enum Level {
  Low = 0,
}

export namespace grouped {
  export const inside = 1;
}

export const first = 1;
export let mutable = 2;
export var older = 3;

export const [second = 0, ...rest] = [4, 5, 6];
export const { third, ...others } = { third: 7, fourth: 8 };
