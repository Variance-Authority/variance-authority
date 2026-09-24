function tag(_label: string) {
  return function (value: unknown, _context: unknown) {
    return value;
  };
}

export class Decorated {
  @tag('x')
  run() {
    return 'run';
  }
}

export function later(start: number): number {
  let total = start;
  total += 1;
  total += 2;
  total += 3;
  total += 4;
  total += 5;
  total += 6;
  total += 7;
  total += 8;
  total += 9;
  total += 10;
  return total;
}
