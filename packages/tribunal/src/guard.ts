import { REFUSAL, RasterStoreError, messageOf } from '@variance-authority/raster';

/**
 * Every call into D1 and R2 goes through here, and every failure of one becomes
 * an operator error.
 *
 * Not a convenience. A `TypeError` from a binding that was never wired, a 500
 * from a bucket, a D1 statement refused because the schema is a version behind —
 * each of them would otherwise propagate as some other kind of exception, and
 * the one thing that must never happen is that any of them is caught somewhere
 * above and read as "no baseline".
 *
 * Its own module because [`objects.ts`](./objects.ts) needs the same guarantee
 * for the same reason, and a store importing it from the file it is a detail of
 * would make the store the place where storage errors are defined.
 */
export async function guardStore<T>(call: () => Promise<T>, where: string): Promise<T> {
  try {
    return await call();
  } catch (error) {
    throw new RasterStoreError(
      `the baseline store could not reach its database or its bucket for ${where}: ` +
        `${messageOf(error)}. ${REFUSAL}.`,
      { cause: error },
    );
  }
}
