import type { ArgumentSnapshot } from './access.js';

const MAX_DEPTH = 5;

function unavailable(description: string): ArgumentSnapshot {
  return { kind: 'unavailable', description };
}

function snapshot(value: unknown, depth: number, seen: Set<object>): ArgumentSnapshot {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : unavailable(String(value));
  }
  if (typeof value === 'undefined') return { kind: 'undefined' };
  if (typeof value === 'bigint') return { kind: 'bigint', value: value.toString() };
  if (typeof value === 'symbol') return { kind: 'symbol', value: String(value) };
  if (typeof value === 'function') return { kind: 'function', name: value.name || 'anonymous' };
  if (value instanceof RegExp) {
    return { kind: 'regexp', source: value.source, flags: value.flags };
  }
  if (depth >= MAX_DEPTH) return unavailable('maximum argument depth reached');
  if (seen.has(value)) return unavailable('circular argument');

  seen.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => snapshot(entry, depth + 1, seen));
    }

    const output: Record<string, ArgumentSnapshot> = {};
    for (const key of Object.keys(value).sort()) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      output[key] = descriptor && 'value' in descriptor
        ? snapshot(descriptor.value, depth + 1, seen)
        : unavailable('accessor argument');
    }
    return output;
  } finally {
    seen.delete(value);
  }
}

/** Copy query arguments while their call-site values still exist. */
export function snapshotArguments(values: readonly unknown[]): readonly ArgumentSnapshot[] {
  return values.map((value) => snapshot(value, 0, new Set()));
}
