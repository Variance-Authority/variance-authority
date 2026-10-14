/**
 * The data cache a recorded run serves pages through: none. vinext keeps every
 * ISR page in the isolate's memory by default, and a page served from there on
 * a second visit runs none of the code that made it, so the journey that asked
 * for it records nothing.
 */

export default function noCache() {
  return {
    get: async () => null,
    set: async () => {},
    revalidateTag: async () => {},
  };
}
