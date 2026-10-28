export interface Shape {
  readonly kind: string;
  readonly side: number;
}

export type Unit = 'cm' | 'in';

export const unitOf = (unit: Unit): Unit => unit;
