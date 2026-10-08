/**
 * The module a Jest configuration wrapped by `withTestSelection` names as its
 * `testSequencer`.
 *
 * Jest takes a sequencer as a path and constructs it in the process that loaded
 * the configuration, so what that configuration was handed is still in memory:
 * `jest-placing.ts` leaves the project's own sequencer and the placement under
 * a symbol on `globalThis`. Every method is the project's sequencer's, except
 * `shard`, which places by recorded time.
 */

/** Where the configuration leaves the sequencer; mirrors `HANDED` in `jest-placing.ts`. */
const HANDED = Symbol.for('variance-authority:jest-sequencer');

interface Shard {
  readonly shardIndex: number;
  readonly shardCount: number;
}

interface Inner {
  shard?(tests: unknown[], options: Shard): unknown;
}

interface Handed {
  readonly own: () => new (options: unknown) => Inner;
  readonly shard: (tests: { path: string }[], options: Shard, inner: Inner) => Promise<unknown[]>;
}

class PlacingSequencer {
  constructor(options: unknown) {
    const handed = (globalThis as { [HANDED]?: Handed })[HANDED];
    if (handed === undefined) {
      throw new Error(
        'variance-authority: this sequencer places a shard by recorded time, and no configuration wrapped by ' +
          '`withTestSelection` handed it one in this process',
      );
    }
    const inner = new (handed.own())(options);
    return new Proxy(inner, {
      get(target, key) {
        if (key === 'shard') return (tests: { path: string }[], shard: Shard) => handed.shard(tests, shard, target);
        const value = Reflect.get(target, key, target) as unknown;
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  }
}

export = PlacingSequencer;
