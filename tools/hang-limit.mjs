/**
 * How long a test or hook may run before it is called hung, for every slice and
 * `yarn check`. It detects a hang, not a slow test (`yarn measure` gates cost):
 * on a shared machine a test takes about t × load/cores, ×4 here (#1219).
 * A test sets its own only to need more, or when a shorter one is what it asserts.
 */
export const HANG = 60_000;
