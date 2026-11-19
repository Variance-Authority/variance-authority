/** One immutable change to a map. Layers are applied oldest to newest. */
export interface MapLayer<K, V> {
  readonly puts: ReadonlyMap<K, V>;
  readonly deletes: ReadonlySet<K>;
}

/** What {@link prunable} hands out: a map that only loses entries. */
export interface PrunableMap<K, V> extends ReadonlyMap<K, V> {
  delete(key: K): boolean;
  clear(): void;
}

/**
 * `base` as a map that entries can be dropped from without first copying it:
 * a lazily read map stays lazy until a caller walks it.
 */
export function prunable<K, V>(base: ReadonlyMap<K, V>): PrunableMap<K, V> {
  let cleared = false;
  const dropped = new Set<K>();
  const has = (key: K): boolean => !cleared && !dropped.has(key) && base.has(key);
  function* entries(): Generator<[K, V], undefined, unknown> {
    if (cleared) return undefined;
    for (const entry of base) if (!dropped.has(entry[0])) yield entry;
    return undefined;
  }
  return Object.assign(readonlyMap<K, V>({
    size: () => cleared ? 0 : base.size - dropped.size,
    get: (key) => has(key) ? base.get(key) : undefined,
    has,
    entries,
  }), {
    delete(key: K) {
      if (!has(key)) return false;
      dropped.add(key);
      return true;
    },
    clear() { cleared = true; },
  });
}

/** What a map answers from, for {@link readonlyMap}. */
export interface MapSource<K, V> {
  size(): number;
  get(key: K): V | undefined;
  has(key: K): boolean;
  entries(): Iterable<[K, V]>;
  /** The keys alone, when they are cheaper than the entries. */
  keys?(): Iterable<K>;
}

/** A read-only map over `source`, with every method a map has. */
export function readonlyMap<K, V>(source: MapSource<K, V>): ReadonlyMap<K, V> {
  function* each<T>(from: Iterable<T>): Generator<T, undefined, unknown> {
    yield* from;
    return undefined;
  }
  function* pick<T>(take: (entry: [K, V]) => T): Generator<T, undefined, unknown> {
    for (const entry of source.entries()) yield take(entry);
    return undefined;
  }
  const map: ReadonlyMap<K, V> = {
    get size() { return source.size(); },
    get: (key) => source.get(key),
    has: (key) => source.has(key),
    entries: () => each(source.entries()),
    keys: () => source.keys === undefined ? pick(([key]) => key) : each(source.keys()),
    values: () => pick(([, value]) => value),
    forEach(callback, thisArg) {
      for (const [key, value] of source.entries()) callback.call(thisArg, value, key, map);
    },
    [Symbol.iterator]: () => each(source.entries()),
  };
  return map;
}

/** The smallest layer that turns `before` into `after`. */
export function differenceLayer<K, V>(
  before: ReadonlyMap<K, V>,
  after: ReadonlyMap<K, V>,
  equal: (left: V, right: V) => boolean = Object.is,
): MapLayer<K, V> {
  const puts = new Map<K, V>();
  const deletes = new Set<K>();
  // A map handed back as it was read changed nothing, and walking it would
  // decode every row a lazily read map holds.
  if (before === after) return { puts, deletes };
  for (const [key, value] of after) {
    if (!before.has(key) || !equal(before.get(key)!, value)) puts.set(key, value);
  }
  for (const key of before.keys()) if (!after.has(key)) deletes.add(key);
  return { puts, deletes };
}
