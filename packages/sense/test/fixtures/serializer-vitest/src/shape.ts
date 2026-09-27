export interface Shape {
  readonly sides: number;
}

export function isShape(value: unknown): value is Shape {
  return typeof value === 'object' && value !== null && 'sides' in value;
}

export function printShape(shape: Shape): string {
  if (shape.sides === 3) {
    return 'shape: triangle';
  }
  return `shape: ${shape.sides} sides`;
}
