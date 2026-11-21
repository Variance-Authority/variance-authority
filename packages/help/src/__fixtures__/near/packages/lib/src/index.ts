/** Measures the thing. */
export function measure(): number {
  return 1;
}

export interface Frame {
  readonly at: number;
}

export type Silent = string;

export { Deeply } from './inner/deeply.js';
