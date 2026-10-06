import type { Shape } from './types.ts';
import { type Unit, unitOf } from './types.ts';

export enum Direction {
  Up = 1,
  Down,
}

export namespace Geometry {
  export const factor = 2;
  export function double(value: number): number {
    return value * factor;
  }
}

export const calls: string[] = [];

function sealed(constructor: Function): void {
  Object.seal(constructor);
}

function logged(_target: object, key: string, descriptor: PropertyDescriptor): PropertyDescriptor {
  const original = descriptor.value as (this: unknown, ...args: unknown[]) => unknown;
  descriptor.value = function (this: unknown, ...args: unknown[]) {
    calls.push(key);
    return original.apply(this, args);
  };
  return descriptor;
}

export abstract class Measure {
  abstract area(): number;
  describe(): string {
    return `area ${this.area()}`;
  }
}

@sealed
export class Square extends Measure {
  constructor(
    private readonly side: number,
    public readonly unit: Unit = unitOf('cm'),
  ) {
    super();
  }

  @logged
  area(): number {
    return this.side ** 2;
  }
}

export function size(value: string): number;
export function size(value: readonly unknown[]): number;
export function size(value: string | readonly unknown[]): number {
  return value.length;
}

export const config = { direction: Direction.Down } satisfies { direction: Direction };

export const shape = { kind: 'square', side: 3 } as Shape;
