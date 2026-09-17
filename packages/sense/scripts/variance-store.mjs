/**
 * What a *journey* costs at a repository's scale, if the thing stored is the
 * call edge rather than the region.
 *
 * `snapshot-scale.mjs` measures the artifact that ships: one interned set of
 * test files per region, which answers "this region changed, which tests" and
 * nothing about how a test got there. This measures the store that also holds
 * the path — a record per
 *
 *     who:         function F, and the set of branches F executed
 *     called from: the parent's variant
 *     called for:  the tests
 *
 * so that a change is answered the same way, and a journey is recoverable by
 * walking parents left and children right.
 *
 *   node scripts/variance-store.mjs shape    [modules] [tests] [funcs]
 *   node scripts/variance-store.mjs flat     [modules] [tests] [funcs]
 *   node scripts/variance-store.mjs chain    [modules] [tests] [funcs]
 *   node scripts/variance-store.mjs spine    [modules] [tests] [funcs]
 *   node scripts/variance-store.mjs residual [modules] [tests] [funcs]
 *   node scripts/variance-store.mjs query    [modules] [tests] [funcs]
 *
 * One mode per process: resident size is what is being measured and it does not
 * fall back when a previous arm lets go.
 */

import './variance-store-shape.mjs';
import './variance-store-query.mjs';
import './variance-store-classes.mjs';
import './variance-store-verify.mjs';
