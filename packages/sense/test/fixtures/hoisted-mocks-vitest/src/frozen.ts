import { vi } from 'vitest';
import { now } from './clock.ts';

const fixed = vi.hoisted(() => 42);
vi.mock('./clock.ts', () => ({ now: () => fixed }));

export function stamp(label: string): string {
  return `${label}@${now()}`;
}
