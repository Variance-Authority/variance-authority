/**
 * The functions a module's probes call, made by the root when the module
 * registers.
 *
 * The header an instrumented module carries declares `__va`, `__vaR` and
 * `__vaE`, and on the first call of any of them rebinds all three to the set
 * its root made for it: see [`index.ts`](index.ts). The probe is therefore
 * written once, here, and not once a module. That matters where a realm is
 * new for each test file, which is every runner's default: V8 keys compiled
 * code and the feedback that optimises it on a function's place in its source,
 * so a probe written into every module is a function of its own in every
 * module, parsed, compiled and run cold, every file, in every one of them. The
 * closures made here all come from one place in one source, so a realm
 * compiles the probe once and warms it once.
 *
 * What the gate reads are the closure's own slots, as they were the module's
 * variables before: no property lookup on any object.
 *
 * ## Written to be sent as text
 *
 * {@link probeSet} names nothing outside itself, so a page collector is sent
 * its source beside the engine's: see `test-selection/probes.ts`.
 */

/**
 * The probes of one module's row.
 *
 * @param root The realm's root, read on every write: see `probe-log.cts`.
 * @param gate What the fast path tests: the flags, or a row of zeros where the
 * root must hear every hit.
 * @param flags The row's flags, one byte a region, bit 1 logged outside every
 * evaluation and bit 2 inside one.
 * @param base The row's first index across the realm.
 * @param passing The bit that answers now, or zero where every hit is logged.
 * @param handing What a region hands a story, where the root keeps one.
 */
function probeSet(
  root: {
    readonly s: (() => void) | null;
    readonly v: number;
    n: number;
    readonly l: number;
    readonly L: Int32Array;
    g(entry: number): void;
    e(): void;
    x(): void;
  },
  gate: Uint8Array,
  flags: Uint8Array,
  base: number,
  passing: Uint8Array,
  handing?: (region: number, names: string, ...values: unknown[]) => void,
) {
  // Its own function, so that the gate stays small enough to inline at every
  // site: folded into it, the same logic measures slower at 16 regions and
  // under Maglev alone.
  const slow = (i: number): void => {
    if (root.s !== null) root.s();
    // The module's own region, once each way: tested against the root's
    // evaluating bit rather than `passing`, which a story tap holds at zero.
    const v = root.v;
    const way = v === 0 ? 1 : 2;
    if ((flags[0]! & way) === 0) {
      flags[0] = flags[0]! | way;
      root.g(base | v);
    }
    const flag = flags[i]!;
    const pass = passing[0]!;
    if ((flag & pass) === 0) {
      flags[i] = flag | pass;
      const n = root.n;
      if (n < root.l) {
        root.L[n] = (base + i) | v;
        root.n = n + 1;
      } else root.g((base + i) | v);
    }
  };
  return {
    f: gate,
    s: flags,
    b: base,
    p: passing,
    V: handing,
    /** A statement's probe. */
    va: (i: number): void => {
      if ((gate[i]! & passing[0]!) === 0) slow(i);
    },
    /** An expression's: the probe, then the value. */
    R: <T,>(value: T, i: number): T => {
      if ((gate[i]! & passing[0]!) === 0) slow(i);
      return value;
    },
    /** After the module's last statement: it no longer evaluates. */
    E: (): void => root.x(),
    /** The module's own probe, at the end of its prologue: it starts evaluating, and its region is logged so. */
    T: (): void => {
      root.e();
      flags[0] = flags[0]! | 2;
      root.g(base | -2147483648);
    },
  };
}

export = { probeSet };
