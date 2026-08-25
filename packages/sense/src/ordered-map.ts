/** One immutable change to a map. Layers are applied oldest to newest. */
export interface MapLayer<K, V> {
  readonly puts: ReadonlyMap<K, V>;
  readonly deletes: ReadonlySet<K>;
}

/** A newest-first point lookup without first copying the complete map. */
export function lookupInLayers<K, V>(
  layers: readonly MapLayer<K, V>[],
  key: K,
): V | undefined {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    const layer = layers[index]!;
    if (layer.deletes.has(key)) return undefined;
    if (layer.puts.has(key)) return layer.puts.get(key);
  }
  return undefined;
}

/** Apply an ordered set of immutable changes as one complete lookup structure. */
export function materializeLayers<K, V>(layers: readonly MapLayer<K, V>[]): Map<K, V> {
  const result = new Map<K, V>();
  for (const layer of layers) {
    for (const key of layer.deletes) result.delete(key);
    for (const [key, value] of layer.puts) result.set(key, value);
  }
  return result;
}

/** A read-only map that asks immutable layers newest first and materializes only for iteration. */
export function orderedMap<K, V>(layers: readonly MapLayer<K, V>[]): ReadonlyMap<K, V> {
  let materialized: Map<K, V> | undefined;
  const complete = (): Map<K, V> => materialized ??= materializeLayers(layers);
  return {
    get size() { return complete().size; },
    get(key) { return lookupInLayers(layers, key); },
    has(key) {
      for (let index = layers.length - 1; index >= 0; index -= 1) {
        const layer = layers[index]!;
        if (layer.deletes.has(key)) return false;
        if (layer.puts.has(key)) return true;
      }
      return false;
    },
    entries: () => complete().entries(),
    keys: () => complete().keys(),
    values: () => complete().values(),
    forEach(callback, thisArg) {
      complete().forEach((value, key) => callback.call(thisArg, value, key, this));
    },
    [Symbol.iterator]: () => complete()[Symbol.iterator](),
  };
}

/** The smallest layer that turns `before` into `after`. */
export function differenceLayer<K, V>(
  before: ReadonlyMap<K, V>,
  after: ReadonlyMap<K, V>,
  equal: (left: V, right: V) => boolean = Object.is,
): MapLayer<K, V> {
  const puts = new Map<K, V>();
  const deletes = new Set<K>();
  for (const [key, value] of after) {
    if (!before.has(key) || !equal(before.get(key)!, value)) puts.set(key, value);
  }
  for (const key of before.keys()) if (!after.has(key)) deletes.add(key);
  return { puts, deletes };
}
