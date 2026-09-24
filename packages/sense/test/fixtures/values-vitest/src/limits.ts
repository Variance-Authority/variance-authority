// The bounds every control shares.
export const LIMIT = 10;
export const STEP = 2;
const DEFAULTS = { max: LIMIT };

export function clamp(value: number): number {
  return Math.min(value, LIMIT);
}

export function render(): string {
  return `up to ${DEFAULTS.max}`;
}
