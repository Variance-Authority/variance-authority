// compass: variance-authority.reach.crossings
/**
 * What stands for `node:zlib` and `node:module` in the page's bundle.
 *
 * The record the page holds has every run stored as it is, so the reader never
 * asks for either; an ask is a defect, and it is refused by name.
 */

function refused(): never {
  throw new Error('the page reads a record whose runs are stored raw, and was asked for Node');
}

export const constants = {};
export const zstdCompressSync = refused;
export const zstdDecompressSync = refused;
export const createRequire = (): typeof refused => refused;
