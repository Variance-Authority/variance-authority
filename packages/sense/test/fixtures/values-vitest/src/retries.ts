const settings: number[] = [];

function configure(value: number): void {
  settings.push(value);
}

export const RETRIES = 3;
configure(RETRIES);

export function attempts(): number {
  return 1;
}
